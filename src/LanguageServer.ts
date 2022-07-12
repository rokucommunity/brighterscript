import 'array-flat-polyfill';
import * as fastGlob from 'fast-glob';
import * as path from 'path';
import { rokuDeploy, util as rokuDeployUtil } from 'roku-deploy';
import type {
    CompletionItem,
    Connection,
    DidChangeWatchedFilesParams,
    Hover,
    InitializeParams,
    ServerCapabilities,
    TextDocumentPositionParams,
    ExecuteCommandParams,
    WorkspaceSymbolParams,
    SymbolInformation,
    DocumentSymbolParams,
    ReferenceParams,
    SignatureHelp,
    SignatureHelpParams,
    CodeActionParams,
    SemanticTokensOptions,
    SemanticTokens,
    SemanticTokensParams,
    TextDocumentChangeEvent
} from 'vscode-languageserver/node';
import {
    SemanticTokensRequest,
    createConnection,
    DidChangeConfigurationNotification,
    FileChangeType,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    CodeActionKind
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { BsConfig } from './BsConfig';
import { Deferred } from './deferred';
import { DiagnosticMessages } from './DiagnosticMessages';
import { ProgramBuilder } from './ProgramBuilder';
import { standardizePath as s, util } from './util';
import { Logger } from './Logger';
import { Throttler } from './Throttler';
import { KeyedThrottler } from './KeyedThrottler';
import { DiagnosticCollection } from './DiagnosticCollection';
import { isBrsFile } from './astUtils/reflection';
import { encodeSemanticTokens, semanticTokensLegend } from './SemanticTokenUtils';

export class LanguageServer {
    private connection = undefined as Connection;

    public projects = [] as Project[];

    /**
     * The number of milliseconds that should be used for language server typing debouncing
     */
    private debounceTimeout = 150;

    /**
     * These projects are created on the fly whenever a file is opened that is not included
     * in any of the workspace-based projects.
     * Basically these are single-file projects to at least get parsing for standalone files.
     * Also, they should only be created when the file is opened, and destroyed when the file is closed.
     */
    public standaloneFileProjects = {} as Record<string, Project>;

    private hasConfigurationCapability = false;

    /**
     * Indicates whether the client supports workspace folders
     */
    private clientHasWorkspaceFolderCapability = false;

    /**
     * Create a simple text document manager.
     * The text document manager supports full document sync only
     */
    private documents = new TextDocuments(TextDocument);

    private createConnection() {
        return createConnection(ProposedFeatures.all);
    }

    private loggerSubscription: () => void;

    private keyedThrottler = new KeyedThrottler(this.debounceTimeout);

    public validateThrottler = new Throttler(0);

    private sendDiagnosticsThrottler = new Throttler(0);

    private boundValidateAll = this.validateAll.bind(this);

    private validateAllThrottled() {
        return this.validateThrottler.run(this.boundValidateAll);
    }

    //run the server
    public run() {
        // Create a connection for the server. The connection uses Node's IPC as a transport.
        // Also include all preview / proposed LSP features.
        this.connection = this.createConnection();

        //listen to all of the output log events and pipe them into the debug channel in the extension
        this.loggerSubscription = Logger.subscribe((text) => {
            this.connection.tracer.log(text);
        });

        this.connection.onInitialize(this.onInitialize.bind(this));

        this.connection.onInitialized(this.onInitialized.bind(this)); //eslint-disable-line

        this.connection.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this)); //eslint-disable-line

        this.connection.onDidChangeWatchedFiles(this.onDidChangeWatchedFiles.bind(this)); //eslint-disable-line

        // The content of a text document has changed. This event is emitted
        // when the text document is first opened, when its content has changed,
        // or when document is closed without saving (original contents are sent as a change)
        //
        this.documents.onDidChangeContent(this.validateTextDocument.bind(this));

        //whenever a document gets closed
        this.documents.onDidClose(this.onDocumentClose.bind(this));

        // This handler provides the initial list of the completion items.
        this.connection.onCompletion(this.onCompletion.bind(this));

        // This handler resolves additional information for the item selected in
        // the completion list.
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));

        this.connection.onHover(this.onHover.bind(this));

        this.connection.onExecuteCommand(this.onExecuteCommand.bind(this));

        this.connection.onDefinition(this.onDefinition.bind(this));

        this.connection.onDocumentSymbol(this.onDocumentSymbol.bind(this));

        this.connection.onWorkspaceSymbol(this.onWorkspaceSymbol.bind(this));

        this.connection.onSignatureHelp(this.onSignatureHelp.bind(this));

        this.connection.onReferences(this.onReferences.bind(this));

        this.connection.onCodeAction(this.onCodeAction.bind(this));

        //TODO switch to a more specific connection function call once they actually add it
        this.connection.onRequest(SemanticTokensRequest.method, this.onFullSemanticTokens.bind(this));

        /*
        this.connection.onDidOpenTextDocument((params) => {
             // A text document got opened in VSCode.
             // params.uri uniquely identifies the document. For documents stored on disk this is a file URI.
             // params.text the initial full content of the document.
            this.connection.console.log(`${params.textDocument.uri} opened.`);
        });
        this.connection.onDidChangeTextDocument((params) => {
             // The content of a text document did change in VSCode.
             // params.uri uniquely identifies the document.
             // params.contentChanges describe the content changes to the document.
            this.connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
        });
        this.connection.onDidCloseTextDocument((params) => {
             // A text document got closed in VSCode.
             // params.uri uniquely identifies the document.
            this.connection.console.log(`${params.textDocument.uri} closed.`);
        });
        */

        // listen for open, change and close text document events
        this.documents.listen(this.connection);

        // Listen on the connection
        this.connection.listen();
    }

    /**
     * Called when the client starts initialization
     * @param params
     */
    @AddStackToErrorMessage
    public onInitialize(params: InitializeParams) {
        let clientCapabilities = params.capabilities;

        // Does the client support the `workspace/configuration` request?
        // If not, we will fall back using global settings
        this.hasConfigurationCapability = !!(clientCapabilities.workspace && !!clientCapabilities.workspace.configuration);
        this.clientHasWorkspaceFolderCapability = !!(clientCapabilities.workspace && !!clientCapabilities.workspace.workspaceFolders);

        //return the capabilities of the server
        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Full,
                // Tell the client that the server supports code completion
                completionProvider: {
                    resolveProvider: true,
                    //anytime the user types a period, auto-show the completion results
                    triggerCharacters: ['.'],
                    allCommitCharacters: ['.', '@']
                },
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
                semanticTokensProvider: {
                    legend: semanticTokensLegend,
                    full: true
                } as SemanticTokensOptions,
                referencesProvider: true,
                codeActionProvider: {
                    codeActionKinds: [CodeActionKind.Refactor]
                },
                signatureHelpProvider: {
                    triggerCharacters: ['(', ',']
                },
                definitionProvider: true,
                hoverProvider: true,
                executeCommandProvider: {
                    commands: [
                        CustomCommands.TranspileFile
                    ]
                }
            } as ServerCapabilities
        };
    }

    private initialProjectsCreated: Promise<any>;

    /**
     * Ask the client for the list of `files.exclude` patterns. Useful when determining if we should process a file
     */
    private async getWorkspaceExcludeGlobs(workspaceFolder: string) {
        //get any `files.exclude` globs to use to filter
        let config = await this.connection.workspace.getConfiguration({
            scopeUri: workspaceFolder,
            section: 'files'
        }) as {
            exclude: Record<string, boolean>;
        };
        return Object
            .keys(config?.exclude ?? {})
            .filter(x => config?.exclude?.[x])
            //vscode files.exclude patterns support ignoring folders without needing to add `**/*`. So for our purposes, we need to
            //append **/* to everything without a file extension or magic at the end
            .map(pattern => [
                //send the pattern as-is (this handles weird cases and exact file matches)
                pattern,
                //treat the pattern as a directory (no harm in doing this because if it's a file, the pattern will just never match anything)
                `${pattern}/**/*`
            ])
            .flat(1)
            .concat([
                //always ignore projects from node_modules
                '**/node_modules/**/*'
            ]);
    }

    /**
     * Scan the workspace for all `bsconfig.json` files. If at least one is found, then only folders who have bsconfig.json are returned.
     * If none are found, then the workspaceFolder itself is treated as a project
     */
    private async getProjectPaths(workspaceFolder: string) {
        const excludes = (await this.getWorkspaceExcludeGlobs(workspaceFolder)).map(x => s`!${x}`);
        const files = await rokuDeploy.getFilePaths([
            '**/bsconfig.json',
            //exclude all files found in `files.exclude`
            ...excludes
        ], workspaceFolder);
        //if we found at least one bsconfig.json, then ALL projects must have a bsconfig.json.
        if (files.length > 0) {
            return files.map(file => s`${path.dirname(file.src)}`);
        }

        //look for roku project folders
        const rokuLikeDirs = (await Promise.all(
            //find all folders containing a `manifest` file
            (await rokuDeploy.getFilePaths([
                '**/manifest',
                ...excludes

                //is there at least one .bs|.brs file under the `/source` folder?
            ], workspaceFolder)).map(async manifestEntry => {
                const manifestDir = path.dirname(manifestEntry.src);
                const files = await rokuDeploy.getFilePaths([
                    'source/**/*.{brs,bs}',
                    ...excludes
                ], manifestDir);
                if (files.length > 0) {
                    return manifestDir;
                }
            })
            //throw out nulls
        )).filter(x => !!x);
        if (rokuLikeDirs.length > 0) {
            return rokuLikeDirs;
        }

        //treat the workspace folder as a brightscript project itself
        return [workspaceFolder];
    }

    /**
     * Find all folders with bsconfig.json files in them, and treat each as a project.
     * Treat workspaces that don't have a bsconfig.json as a project.
     * Handle situations where bsconfig.json files were added or removed (to elevate/lower workspaceFolder projects accordingly)
     * Leave existing projects alone if they are not affected by these changes
     */
    private async syncProjects() {
        const workspacePaths = await this.getWorkspacePaths();
        let projectPaths = (await Promise.all(
            workspacePaths.map(async workspacePath => {
                const projectPaths = await this.getProjectPaths(workspacePath);
                return projectPaths.map(projectPath => ({
                    projectPath: projectPath,
                    workspacePath: workspacePath
                }));
            })
        )).flat(1);

        //delete projects not represented in the list
        for (const project of this.getProjects()) {
            if (!projectPaths.find(x => x.projectPath === project.projectPath)) {
                this.removeProject(project);
            }
        }

        //exclude paths to projects we already have
        projectPaths = projectPaths.filter(x => {
            //only keep this project path if there's not a project with that path
            return !this.projects.find(project => project.projectPath === x.projectPath);
        });

        //dedupe by project path
        projectPaths = [
            ...projectPaths.reduce(
                (acc, x) => acc.set(x.projectPath, x),
                new Map<string, typeof projectPaths[0]>()
            ).values()
        ];

        //create missing projects
        await Promise.all(
            projectPaths.map(x => this.createProject(x.projectPath, x.workspacePath))
        );
        //flush diagnostics
        await this.sendDiagnostics();
    }

    /**
     * Get all workspace paths from the client
     */
    private async getWorkspacePaths() {
        let workspaceFolders = await this.connection.workspace.getWorkspaceFolders() ?? [];
        return workspaceFolders.map((x) => {
            return util.uriToPath(x.uri);
        });
    }

    /**
     * Called when the client has finished initializing
     * @param params
     */
    @AddStackToErrorMessage
    private async onInitialized() {
        let projectCreatedDeferred = new Deferred();
        this.initialProjectsCreated = projectCreatedDeferred.promise;

        try {
            if (this.hasConfigurationCapability) {
                // Register for all configuration changes.
                await this.connection.client.register(
                    DidChangeConfigurationNotification.type,
                    undefined
                );
            }

            await this.syncProjects();

            if (this.clientHasWorkspaceFolderCapability) {
                this.connection.workspace.onDidChangeWorkspaceFolders(async (evt) => {
                    await this.syncProjects();
                });
            }
            await this.waitAllProjectFirstRuns(false);
            projectCreatedDeferred.resolve();
        } catch (e: any) {
            this.sendCriticalFailure(
                `Critical failure during BrighterScript language server startup.
                Please file a github issue and include the contents of the 'BrighterScript Language Server' output channel.

                Error message: ${e.message}`
            );
            throw e;
        }
    }

    /**
     * Send a critical failure notification to the client, which should show a notification of some kind
     */
    private sendCriticalFailure(message: string) {
        this.connection.sendNotification('critical-failure', message);
    }

    /**
     * Wait for all programs' first run to complete
     */
    private async waitAllProjectFirstRuns(waitForFirstProject = true) {
        if (waitForFirstProject) {
            await this.initialProjectsCreated;
        }

        let status: string;
        for (let project of this.getProjects()) {
            try {
                await project.firstRunPromise;
            } catch (e: any) {
                status = 'critical-error';
                //the first run failed...that won't change unless we reload the workspace, so replace with resolved promise
                //so we don't show this error again
                project.firstRunPromise = Promise.resolve();
                this.sendCriticalFailure(`BrighterScript language server failed to start: \n${e.message}`);
            }
        }
        this.connection.sendNotification('build-status', status ? status : 'success');
    }

    /**
     * Event handler for when the program wants to load file contents.
     * anytime the program wants to load a file, check with our in-memory document cache first
     */
    private documentFileResolver(srcPath: string) {
        let pathUri = URI.file(srcPath).toString();
        let document = this.documents.get(pathUri);
        if (document) {
            return document.getText();
        }
    }

    private async getConfigFilePath(workspacePath: string) {
        let scopeUri: string;
        if (workspacePath.startsWith('file:')) {
            scopeUri = URI.parse(workspacePath).toString();
        } else {
            scopeUri = URI.file(workspacePath).toString();
        }
        //look for config group called "brightscript"
        let config = await this.connection.workspace.getConfiguration({
            scopeUri: scopeUri,
            section: 'brightscript'
        });
        let configFilePath: string;

        //if there's a setting, we need to find the file or show error if it can't be found
        if (config?.configFile) {
            configFilePath = path.resolve(workspacePath, config.configFile);
            if (await util.pathExists(configFilePath)) {
                return configFilePath;
            } else {
                this.sendCriticalFailure(`Cannot find config file specified in user / workspace settings at '${configFilePath}'`);
            }
        }

        //default to config file path found in the root of the workspace
        configFilePath = path.resolve(workspacePath, 'bsconfig.json');
        if (await util.pathExists(configFilePath)) {
            return configFilePath;
        }

        //look for the deprecated `brsconfig.json` file
        configFilePath = path.resolve(workspacePath, 'brsconfig.json');
        if (await util.pathExists(configFilePath)) {
            return configFilePath;
        }

        //no config file could be found
        return undefined;
    }

    private async createProject(projectPath: string, workspacePath = projectPath) {
        workspacePath ??= projectPath;
        let project = this.projects.find((x) => x.projectPath === projectPath);
        //skip this project if we already have it
        if (project) {
            return;
        }

        let builder = new ProgramBuilder();

        //flush diagnostics every time the program finishes validating
        builder.plugins.add({
            name: 'bsc-language-server',
            afterProgramValidate: () => {
                void this.sendDiagnostics();
            }
        });

        //prevent clearing the console on run...this isn't the CLI so we want to keep a full log of everything
        builder.allowConsoleClearing = false;

        //look for files in our in-memory cache before going to the file system
        builder.addFileResolver(this.documentFileResolver.bind(this));

        let configFilePath = await this.getConfigFilePath(projectPath);

        let cwd = projectPath;

        //if the config file exists, use it and its folder as cwd
        if (configFilePath && await util.pathExists(configFilePath)) {
            cwd = path.dirname(configFilePath);
        } else {
            //config file doesn't exist...let `brighterscript` resolve the default way
            configFilePath = undefined;
        }

        let firstRunPromise = builder.run({
            cwd: cwd,
            project: configFilePath,
            watch: false,
            createPackage: false,
            deploy: false,
            copyToStaging: false,
            showDiagnosticsInConsole: false
        });
        firstRunPromise.catch((err) => {
            console.error(err);
        });

        let newProject: Project = {
            builder: builder,
            firstRunPromise: firstRunPromise,
            projectPath: projectPath,
            workspacePath: workspacePath,
            isFirstRunComplete: false,
            isFirstRunSuccessful: false,
            configFilePath: configFilePath,
            isStandaloneFileProject: false
        };

        this.projects.push(newProject);

        await firstRunPromise.then(() => {
            newProject.isFirstRunComplete = true;
            newProject.isFirstRunSuccessful = true;
        }).catch(() => {
            newProject.isFirstRunComplete = true;
            newProject.isFirstRunSuccessful = false;
        }).then(() => {
            //if we found a deprecated brsconfig.json, add a diagnostic warning the user
            if (configFilePath && path.basename(configFilePath) === 'brsconfig.json') {
                builder.addDiagnostic(configFilePath, {
                    ...DiagnosticMessages.brsConfigJsonIsDeprecated(),
                    range: util.createRange(0, 0, 0, 0)
                });
                return this.sendDiagnostics();
            }
        });
    }

    private async createStandaloneFileProject(srcPath: string) {
        //skip this workspace if we already have it
        if (this.standaloneFileProjects[srcPath]) {
            return this.standaloneFileProjects[srcPath];
        }

        let builder = new ProgramBuilder();

        //prevent clearing the console on run...this isn't the CLI so we want to keep a full log of everything
        builder.allowConsoleClearing = false;

        //look for files in our in-memory cache before going to the file system
        builder.addFileResolver(this.documentFileResolver.bind(this));

        //get the path to the directory where this file resides
        let cwd = path.dirname(srcPath);

        //get the closest config file and use most of the settings from that
        let configFilePath = await util.findClosestConfigFile(srcPath);
        let project: BsConfig = {};
        if (configFilePath) {
            project = util.normalizeAndResolveConfig({ project: configFilePath });
        }
        //override the rootDir and files array
        project.rootDir = cwd;
        project.files = [{
            src: srcPath,
            dest: path.basename(srcPath)
        }];

        let firstRunPromise = builder.run({
            ...project,
            cwd: cwd,
            project: configFilePath,
            watch: false,
            createPackage: false,
            deploy: false,
            copyToStaging: false,
            diagnosticFilters: [
                //hide the "file not referenced by any other file" error..that's expected in a standalone file.
                1013
            ]
        }).catch((err) => {
            console.error(err);
        });

        let newProject: Project = {
            builder: builder,
            firstRunPromise: firstRunPromise,
            projectPath: srcPath,
            workspacePath: srcPath,
            isFirstRunComplete: false,
            isFirstRunSuccessful: false,
            configFilePath: configFilePath,
            isStandaloneFileProject: true
        };

        this.standaloneFileProjects[srcPath] = newProject;

        await firstRunPromise.then(() => {
            newProject.isFirstRunComplete = true;
            newProject.isFirstRunSuccessful = true;
        }).catch(() => {
            newProject.isFirstRunComplete = true;
            newProject.isFirstRunSuccessful = false;
        });
        return newProject;
    }

    private getProjects() {
        let projects = this.projects.slice();
        for (let key in this.standaloneFileProjects) {
            projects.push(this.standaloneFileProjects[key]);
        }
        return projects;
    }

    /**
     * Provide a list of completion items based on the current cursor position
     * @param textDocumentPosition
     */
    @AddStackToErrorMessage
    private async onCompletion(params: TextDocumentPositionParams) {
        //ensure programs are initialized
        await this.waitAllProjectFirstRuns();

        let filePath = util.uriToPath(params.textDocument.uri);

        //wait until the file has settled
        await this.keyedThrottler.onIdleOnce(filePath, true);

        let completions = this
            .getProjects()
            .flatMap(workspace => workspace.builder.program.getCompletions(filePath, params.position));

        for (let completion of completions) {
            completion.commitCharacters = ['.'];
        }

        return completions;
    }

    /**
     * Provide a full completion item from the selection
     * @param item
     */
    @AddStackToErrorMessage
    private onCompletionResolve(item: CompletionItem): CompletionItem {
        if (item.data === 1) {
            item.detail = 'TypeScript details';
            item.documentation = 'TypeScript documentation';
        } else if (item.data === 2) {
            item.detail = 'JavaScript details';
            item.documentation = 'JavaScript documentation';
        }
        return item;
    }

    @AddStackToErrorMessage
    private async onCodeAction(params: CodeActionParams) {
        //ensure programs are initialized
        await this.waitAllProjectFirstRuns();

        let srcPath = util.uriToPath(params.textDocument.uri);

        //wait until the file has settled
        await this.keyedThrottler.onIdleOnce(srcPath, true);

        const codeActions = this
            .getProjects()
            //skip programs that don't have this file
            .filter(x => x.builder?.program?.hasFile(srcPath))
            .flatMap(workspace => workspace.builder.program.getCodeActions(srcPath, params.range));

        //clone the diagnostics for each code action, since certain diagnostics can have circular reference properties that kill the language server if serialized
        for (const codeAction of codeActions) {
            if (codeAction.diagnostics) {
                codeAction.diagnostics = codeAction.diagnostics.map(x => util.toDiagnostic(x, params.textDocument.uri));
            }
        }
        return codeActions;
    }

    /**
     * Remove a project from the language server
     */
    private removeProject(project: Project) {
        const idx = this.projects.indexOf(project);
        if (idx > -1) {
            this.projects.splice(idx, 1);
        }
        project?.builder?.dispose();
    }

    /**
     * Reload each of the specified workspaces
     */
    private async reloadProjects(projects: Project[]) {
        await Promise.all(
            projects.map(async (project) => {
                //ensure the workspace has finished starting up
                try {
                    await project.firstRunPromise;
                } catch (e) { }

                //handle standard workspace
                if (project.isStandaloneFileProject === false) {
                    this.removeProject(project);

                    //create a new workspace/brs program
                    await this.createProject(project.projectPath, project.workspacePath);

                    //handle temp workspace
                } else {
                    project.builder.dispose();
                    delete this.standaloneFileProjects[project.projectPath];
                    await this.createStandaloneFileProject(project.projectPath);
                }
            })
        );
        if (projects.length > 0) {
            //wait for all of the programs to finish starting up
            await this.waitAllProjectFirstRuns();

            // valdiate all workspaces
            this.validateAllThrottled(); //eslint-disable-line
        }
    }

    private getRootDir(workspace: Project) {
        let options = workspace?.builder?.program?.options;
        return options?.rootDir ?? options?.cwd;
    }

    /**
     * Sometimes users will alter their bsconfig files array, and will include standalone files.
     * If this is the case, those standalone workspaces should be removed because the file was
     * included in an actual program now.
     *
     * Sometimes files that used to be included are now excluded, so those open files need to be re-processed as standalone
     */
    private async synchronizeStandaloneProjects() {

        //remove standalone workspaces that are now included in projects
        for (let standaloneFilePath in this.standaloneFileProjects) {
            let standaloneProject = this.standaloneFileProjects[standaloneFilePath];
            for (let project of this.projects) {
                await standaloneProject.firstRunPromise;

                let dest = rokuDeploy.getDestPath(
                    standaloneFilePath,
                    project?.builder?.program?.options?.files ?? [],
                    this.getRootDir(project)
                );
                //destroy this standalone workspace because the file has now been included in an actual workspace,
                //or if the workspace wants the file
                if (project?.builder?.program?.hasFile(standaloneFilePath) || dest) {
                    standaloneProject.builder.dispose();
                    delete this.standaloneFileProjects[standaloneFilePath];
                }
            }
        }

        //create standalone projects for open files that no longer have a project
        let textDocuments = this.documents.all();
        outer: for (let textDocument of textDocuments) {
            let filePath = URI.parse(textDocument.uri).fsPath;
            for (let project of this.getProjects()) {
                let dest = rokuDeploy.getDestPath(
                    filePath,
                    project?.builder?.program?.options?.files ?? [],
                    this.getRootDir(project)
                );
                //if this project has the file, or it wants the file, do NOT make a standaloneProject for this file
                if (project?.builder?.program?.hasFile(filePath) || dest) {
                    continue outer;
                }
            }
            //if we got here, no workspace has this file, so make a standalone file workspace
            let project = await this.createStandaloneFileProject(filePath);
            await project.firstRunPromise;
        }
    }

    @AddStackToErrorMessage
    private async onDidChangeConfiguration() {
        if (this.hasConfigurationCapability) {
            //if the user changes any config value, just mass-reload all projects
            await this.reloadProjects(this.getProjects());
            // Reset all cached document settings
        } else {
            // this.globalSettings = <ExampleSettings>(
            //     (change.settings.languageServerExample || this.defaultSettings)
            // );
        }
    }

    /**
     * Called when watched files changed (add/change/delete).
     * The CLIENT is in charge of what files to watch, so all client
     * implementations should ensure that all valid project
     * file types are watched (.brs,.bs,.xml,manifest, and any json/text/image files)
     * @param params
     */
    @AddStackToErrorMessage
    private async onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        //ensure programs are initialized
        await this.waitAllProjectFirstRuns();

        this.connection.sendNotification('build-status', 'building');

        let projects = this.getProjects();

        //convert all file paths to absolute paths
        let changes = params.changes.map(x => {
            return {
                type: x.type,
                srcPath: s`${URI.parse(x.uri).fsPath}`
            };
        });

        let keys = changes.map(x => x.srcPath);

        //filter the list of changes to only the ones that made it through the debounce unscathed
        changes = changes.filter(x => keys.includes(x.srcPath));

        //if we have changes to work with
        if (changes.length > 0) {

            //if any bsconfig files were added or deleted, re-sync all projects instead of the more specific approach below
            if (changes.find(x => (x.type === FileChangeType.Created || x.type === FileChangeType.Deleted) && path.basename(x.srcPath).toLowerCase() === 'bsconfig.json')) {
                return this.syncProjects();
            }

            //reload any workspace whose bsconfig.json file has changed
            {
                let projectsToReload = [] as Project[];
                //get the file paths as a string array
                let filePaths = changes.map((x) => x.srcPath);

                for (let project of projects) {
                    if (project.configFilePath && filePaths.includes(project.configFilePath)) {
                        projectsToReload.push(project);
                    }
                }
                if (projectsToReload.length > 0) {
                    //vsc can generate a ton of these changes, for vsc system files, so we need to bail if there's no work to do on any of our actual project files
                    //reload any projects that need to be reloaded
                    await this.reloadProjects(projectsToReload);
                }

                //reassign `projects` to the non-reloaded projects
                projects = projects.filter(x => !projectsToReload.includes(x));
            }

            //convert created folders into a list of files of their contents
            const directoryChanges = changes
                //get only creation items
                .filter(change => change.type === FileChangeType.Created)
                //keep only the directories
                .filter(change => util.isDirectorySync(change.srcPath));

            //remove the created directories from the changes array (we will add back each of their files next)
            changes = changes.filter(x => !directoryChanges.includes(x));

            //look up every file in each of the newly added directories
            const newFileChanges = directoryChanges
                //take just the path
                .map(x => x.srcPath)
                //exclude the roku deploy staging folder
                .filter(dirPath => !dirPath.includes('.roku-deploy-staging'))
                //get the files for each folder recursively
                .flatMap(dirPath => {
                    //look up all files
                    let files = fastGlob.sync('**/*', {
                        absolute: true,
                        cwd: rokuDeployUtil.toForwardSlashes(dirPath)
                    });
                    return files.map(x => {
                        return {
                            type: FileChangeType.Created,
                            srcPath: s`${x}`
                        };
                    });
                });

            //add the new file changes to the changes array.
            changes.push(...newFileChanges as any);

            //give every workspace the chance to handle file changes
            await Promise.all(
                projects.map((project) => this.handleFileChanges(project, changes))
            );
        }
        this.connection.sendNotification('build-status', 'success');
    }

    /**
     * This only operates on files that match the specified files globs, so it is safe to throw
     * any file changes you receive with no unexpected side-effects
     * @param changes
     */
    public async handleFileChanges(project: Project, changes: { type: FileChangeType; srcPath: string }[]) {
        //this loop assumes paths are both file paths and folder paths, which eliminates the need to detect.
        //All functions below can handle being given a file path AND a folder path, and will only operate on the one they are looking for
        let consumeCount = 0;
        await Promise.all(changes.map(async (change) => {
            await this.keyedThrottler.run(change.srcPath, async () => {
                consumeCount += await this.handleFileChange(project, change) ? 1 : 0;
            });
        }));

        if (consumeCount > 0) {
            await this.validateAllThrottled();
        }
    }

    /**
     * This only operates on files that match the specified files globs, so it is safe to throw
     * any file changes you receive with no unexpected side-effects
     * @param changes
     */
    private async handleFileChange(project: Project, change: { type: FileChangeType; srcPath: string }) {
        const { program, options, rootDir } = project.builder;

        //deleted
        if (change.type === FileChangeType.Deleted) {
            //try to act on this path as a directory
            project.builder.removeFilesInFolder(change.srcPath);

            //if this is a file loaded in the program, remove it
            if (program.hasFile(change.srcPath)) {
                program.removeFile(change.srcPath);
                return true;
            } else {
                return false;
            }

            //created
        } else if (change.type === FileChangeType.Created) {
            // thanks to `onDidChangeWatchedFiles`, we can safely assume that all "Created" changes are file paths, (not directories)

            //get the dest path for this file.
            let destPath = rokuDeploy.getDestPath(change.srcPath, options.files, rootDir);

            //if we got a dest path, then the program wants this file
            if (destPath) {
                program.setFile(
                    {
                        src: change.srcPath,
                        dest: rokuDeploy.getDestPath(change.srcPath, options.files, rootDir)
                    },
                    await project.builder.getFileContents(change.srcPath)
                );
                return true;
            } else {
                //no dest path means the program doesn't want this file
                return false;
            }

            //changed
        } else if (program.hasFile(change.srcPath)) {
            //sometimes "changed" events are emitted on files that were actually deleted,
            //so determine file existance and act accordingly
            if (await util.pathExists(change.srcPath)) {
                program.setFile(
                    {
                        src: change.srcPath,
                        dest: rokuDeploy.getDestPath(change.srcPath, options.files, rootDir)
                    },
                    await project.builder.getFileContents(change.srcPath)
                );
            } else {
                program.removeFile(change.srcPath);
            }
            return true;
        }
    }

    @AddStackToErrorMessage
    private async onHover(params: TextDocumentPositionParams) {
        //ensure programs are initialized
        await this.waitAllProjectFirstRuns();

        const srcPath = util.uriToPath(params.textDocument.uri);
        let projects = this.getProjects();
        let hovers = await Promise.all(
            Array.prototype.concat.call([],
                projects.map(async (x) => x.builder.program.getHover(srcPath, params.position))
            )
        ) as Hover[];

        //return the first non-falsey hover. TODO is there a way to handle multiple hover results?
        let hover = hovers.filter((x) => !!x)[0];
        return hover;
    }

    @AddStackToErrorMessage
    private async onDocumentClose(event: TextDocumentChangeEvent<TextDocument>): Promise<void> {
        const { document } = event;
        let filePath = URI.parse(document.uri).fsPath;
        let standaloneFileProject = this.standaloneFileProjects[filePath];
        //if this was a temp file, close it
        if (standaloneFileProject) {
            await standaloneFileProject.firstRunPromise;
            standaloneFileProject.builder.dispose();
            delete this.standaloneFileProjects[filePath];
            await this.sendDiagnostics();
        }
    }

    @AddStackToErrorMessage
    private async validateTextDocument(event: TextDocumentChangeEvent<TextDocument>): Promise<void> {
        const { document } = event;
        //ensure programs are initialized
        await this.waitAllProjectFirstRuns();

        let filePath = URI.parse(document.uri).fsPath;

        try {

            //throttle file processing. first call is run immediately, and then the last call is processed.
            await this.keyedThrottler.run(filePath, () => {

                this.connection.sendNotification('build-status', 'building');

                let documentText = document.getText();
                for (const project of this.getProjects()) {
                    //only add or replace existing files. All of the files in the project should
                    //have already been loaded by other means
                    if (project.builder.program.hasFile(filePath)) {
                        let rootDir = project.builder.program.options.rootDir ?? project.builder.program.options.cwd;
                        let dest = rokuDeploy.getDestPath(filePath, project.builder.program.options.files, rootDir);
                        project.builder.program.setFile({
                            src: filePath,
                            dest: dest
                        }, documentText);
                    }
                }
            });
            // validate all projects
            await this.validateAllThrottled();
        } catch (e: any) {
            this.sendCriticalFailure(`Critical error parsing / validating ${filePath}: ${e.message}`);
        }
    }

    private async validateAll() {
        try {
            //synchronize parsing for open files that were included/excluded from projects
            await this.synchronizeStandaloneProjects();

            let projects = this.getProjects();

            //validate all programs
            await Promise.all(
                projects.map((x) => x.builder.program.validate())
            );
        } catch (e: any) {
            this.connection.console.error(e);
            this.sendCriticalFailure(`Critical error validating project: ${e.message}${e.stack ?? ''}`);
        }

        this.connection.sendNotification('build-status', 'success');
    }

    @AddStackToErrorMessage
    public async onWorkspaceSymbol(params: WorkspaceSymbolParams) {
        await this.waitAllProjectFirstRuns();

        const results = util.flatMap(
            await Promise.all(this.getProjects().map(project => {
                return project.builder.program.getWorkspaceSymbols();
            })),
            c => c
        );

        // Remove duplicates
        const allSymbols = Object.values(results.reduce((map, symbol) => {
            const key = symbol.location.uri + symbol.name;
            map[key] = symbol;
            return map;
        }, {}));
        return allSymbols as SymbolInformation[];
    }

    @AddStackToErrorMessage
    public async onDocumentSymbol(params: DocumentSymbolParams) {
        await this.waitAllProjectFirstRuns();

        await this.keyedThrottler.onIdleOnce(util.uriToPath(params.textDocument.uri), true);

        const srcPath = util.uriToPath(params.textDocument.uri);
        for (const project of this.getProjects()) {
            const file = project.builder.program.getFile(srcPath);
            if (isBrsFile(file)) {
                return file.getDocumentSymbols();
            }
        }
    }

    @AddStackToErrorMessage
    private async onDefinition(params: TextDocumentPositionParams) {
        await this.waitAllProjectFirstRuns();

        const srcPath = util.uriToPath(params.textDocument.uri);

        const results = util.flatMap(
            await Promise.all(this.getProjects().map(project => {
                return project.builder.program.getDefinition(srcPath, params.position);
            })),
            c => c
        );
        return results;
    }

    @AddStackToErrorMessage
    private async onSignatureHelp(params: SignatureHelpParams) {
        await this.waitAllProjectFirstRuns();

        const filepath = util.uriToPath(params.textDocument.uri);
        await this.keyedThrottler.onIdleOnce(filepath, true);

        try {
            const signatures = util.flatMap(
                await Promise.all(this.getProjects().map(project => project.builder.program.getSignatureHelp(filepath, params.position)
                )),
                c => c
            );

            const activeSignature = signatures.length > 0 ? 0 : null;

            const activeParameter = activeSignature >= 0 ? signatures[activeSignature]?.index : null;

            let results: SignatureHelp = {
                signatures: signatures.map((s) => s.signature),
                activeSignature: activeSignature,
                activeParameter: activeParameter
            };
            return results;
        } catch (e: any) {
            this.connection.console.error(`error in onSignatureHelp: ${e.stack ?? e.message ?? e}`);
            return {
                signatures: [],
                activeSignature: 0,
                activeParameter: 0
            };
        }
    }

    @AddStackToErrorMessage
    private async onReferences(params: ReferenceParams) {
        await this.waitAllProjectFirstRuns();

        const position = params.position;
        const srcPath = util.uriToPath(params.textDocument.uri);

        const results = util.flatMap(
            await Promise.all(this.getProjects().map(project => {
                return project.builder.program.getReferences(srcPath, position);
            })),
            c => c
        );
        return results.filter((r) => r);
    }

    @AddStackToErrorMessage
    private async onFullSemanticTokens(params: SemanticTokensParams) {
        await this.waitAllProjectFirstRuns();
        await this.keyedThrottler.onIdleOnce(util.uriToPath(params.textDocument.uri), true);

        const srcPath = util.uriToPath(params.textDocument.uri);
        for (const project of this.projects) {
            //find the first program that has this file, since it would be incredibly inefficient to generate semantic tokens for the same file multiple times.
            if (project.builder.program.hasFile(srcPath)) {
                let semanticTokens = project.builder.program.getSemanticTokens(srcPath);
                return {
                    data: encodeSemanticTokens(semanticTokens)
                } as SemanticTokens;
            }
        }
    }

    private diagnosticCollection = new DiagnosticCollection();

    private async sendDiagnostics() {
        await this.sendDiagnosticsThrottler.run(async () => {
            //wait for all programs to finish running. This ensures the `Program` exists.
            await Promise.all(
                this.projects.map(x => x.firstRunPromise)
            );

            //Get only the changes to diagnostics since the last time we sent them to the client
            const patch = this.diagnosticCollection.getPatch(this.projects);

            for (let filePath in patch) {
                const uri = URI.file(filePath).toString();
                const diagnostics = patch[filePath].map(d => util.toDiagnostic(d, uri));

                this.connection.sendDiagnostics({
                    uri: uri,
                    diagnostics: diagnostics
                });
            }
        });
    }

    @AddStackToErrorMessage
    public async onExecuteCommand(params: ExecuteCommandParams) {
        await this.waitAllProjectFirstRuns();
        if (params.command === CustomCommands.TranspileFile) {
            const result = await this.transpileFile(params.arguments[0]);
            //back-compat: include `pathAbsolute` property so older vscode versions still work
            (result as any).pathAbsolute = result.srcPath;
            return result;
        }
    }

    private async transpileFile(srcPath: string) {
        //wait all program first runs
        await this.waitAllProjectFirstRuns();
        //find the first project that has this file
        for (let project of this.getProjects()) {
            if (project.builder.program.hasFile(srcPath)) {
                return project.builder.program.getTranspiledFileContents(srcPath);
            }
        }
    }

    public dispose() {
        this.loggerSubscription?.();
        this.validateThrottler.dispose();
    }
}

export interface Project {
    firstRunPromise: Promise<any>;
    builder: ProgramBuilder;
    /**
     * The path to where the project resides
     */
    projectPath: string;
    /**
     * The path to the workspace where this project resides. A workspace can have multiple projects (by adding a bsconfig.json to each folder).
     */
    workspacePath: string;
    isFirstRunComplete: boolean;
    isFirstRunSuccessful: boolean;
    configFilePath?: string;
    isStandaloneFileProject: boolean;
}

export enum CustomCommands {
    TranspileFile = 'TranspileFile'
}

/**
 * Wraps a method. If there's an error (either sync or via a promise),
 * this appends the error's stack trace at the end of the error message so that the connection will
 */
function AddStackToErrorMessage(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    let originalMethod = descriptor.value;

    //wrapping the original method
    descriptor.value = function value(...args: any[]) {
        try {
            let result = originalMethod.apply(this, args);
            //if the result looks like a promise, log if there's a rejection
            if (result?.then) {
                return Promise.resolve(result).catch((e: Error) => {
                    if (e?.stack) {
                        e.message = e.stack;
                    }
                    return Promise.reject(e);
                });
            } else {
                return result;
            }
        } catch (e: any) {
            if (e?.stack) {
                e.message = e.stack;
            }
            throw e;
        }
    };
}
