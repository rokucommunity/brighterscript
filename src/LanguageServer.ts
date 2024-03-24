import 'array-flat-polyfill';
import * as fastGlob from 'fast-glob';
import * as path from 'path';
import { rokuDeploy, util as rokuDeployUtil } from 'roku-deploy';
import type {
    CompletionItem,
    Connection,
    DidChangeWatchedFilesParams,
    InitializeParams,
    ServerCapabilities,
    TextDocumentPositionParams,
    ExecuteCommandParams,
    WorkspaceSymbolParams,
    DocumentSymbolParams,
    ReferenceParams,
    SignatureHelpParams,
    CodeActionParams,
    SemanticTokens,
    SemanticTokensParams,
    TextDocumentChangeEvent,
    HandlerResult,
    InitializeError,
    InitializeResult,
    CompletionParams,
    ResultProgressReporter,
    WorkDoneProgressReporter,
    SemanticTokensOptions,
    Location,
    CompletionList,
    CancellationToken,
    DidChangeConfigurationParams,
    DidChangeConfigurationRegistrationOptions
} from 'vscode-languageserver/node';
import {
    SemanticTokensRequest,
    createConnection,
    DidChangeConfigurationNotification,
    FileChangeType,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    CodeActionKind,
    DidChangeWatchedFilesNotification,
    WatchKind
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { BsConfig } from './BsConfig';
import { ProgramBuilder } from './ProgramBuilder';
import { standardizePath as s, util } from './util';
import { Logger } from './Logger';
import { Throttler } from './Throttler';
import { DiagnosticCollection } from './DiagnosticCollection';
import { encodeSemanticTokens, semanticTokensLegend } from './SemanticTokenUtils';
import type { WorkspaceConfig } from './lsp/ProjectManager';
import { ProjectManager } from './lsp/ProjectManager';
import type { LspDiagnostic, LspProject } from './lsp/LspProject';
import type { Project } from './lsp/Project';

export class LanguageServer implements OnHandler<Connection> {

    /**
     * The language server protocol connection, used to send and receive all requests and responses
     */
    private connection = undefined as Connection;

    /**
     * Manages all projects for this language server
     */
    private projectManager: ProjectManager;

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

    private loggerSubscription: () => void;

    public validateThrottler = new Throttler(0);

    private boundValidateAll = this.validateAll.bind(this);

    private validateAllThrottled() {
        return this.validateThrottler.run(this.boundValidateAll);
    }

    //run the server
    public run() {
        this.projectManager = new ProjectManager();

        //anytime a project emits a collection of diagnostics, send them to the client
        this.projectManager.on('diagnostics', (event) => {
            void this.sendDiagnostics(event);
        });

        this.projectManager.busyStatusTracker.on('change', (event) => {
            this.sendBusyStatus();
        });

        //allow the lsp to provide file contents
        //TODO handle this...
        // this.projectManager.addFileResolver(this.documentFileResolver.bind(this));

        // Create a connection for the server. The connection uses Node's IPC as a transport.
        this.establishConnection();

        //listen to all of the output log events and pipe them into the debug channel in the extension
        this.loggerSubscription = Logger.subscribe((text) => {
            this.connection.tracer.log(text);
        });

        //bind all our on* methods that share the same name from connection
        for (const name of Object.getOwnPropertyNames(LanguageServer.prototype)) {
            if (/on+/.test(name) && typeof this.connection[name] === 'function') {
                this.connection[name](this[name].bind(this));
            }
        }

        //Register semantic token requests. TODO switch to a more specific connection function call once they actually add it
        this.connection.onRequest(SemanticTokensRequest.method, this.onFullSemanticTokens.bind(this));

        // The content of a text document has changed. This event is emitted
        // when the text document is first opened, when its content has changed,
        // or when document is closed without saving (original contents are sent as a change)
        //
        this.documents.onDidChangeContent(this.onTextDocumentDidChangeContent.bind(this));

        //whenever a document gets closed
        this.documents.onDidClose(this.onDocumentClose.bind(this));

        // listen for open, change and close text document events
        this.documents.listen(this.connection);

        // Listen on the connection
        this.connection.listen();
    }

    /**
     * Called when the client starts initialization
     */
    @AddStackToErrorMessage
    public onInitialize(params: InitializeParams): HandlerResult<InitializeResult, InitializeError> {
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
                    resolveProvider: false,
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

    /**
     * Called when the client has finished initializing
     */
    @AddStackToErrorMessage
    public async onInitialized() {
        try {
            if (this.hasConfigurationCapability) {
                // register for when the user changes workspace or user settings
                await this.connection.client.register(
                    DidChangeConfigurationNotification.type,
                    {
                        //we only care about when these settings sections change
                        section: [
                            'brightscript',
                            'files'
                        ]
                    } as DidChangeConfigurationRegistrationOptions
                );
            }

            await this.syncProjects();

            if (this.clientHasWorkspaceFolderCapability) {
                //if the client changes their workspaces, we need to get our projects in sync
                this.connection.workspace.onDidChangeWorkspaceFolders(async (evt) => {
                    await this.syncProjects();
                });
            }
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
     * Provide a list of completion items based on the current cursor position
     */
    @AddStackToErrorMessage
    public async onCompletion(params: CompletionParams, token: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress: ResultProgressReporter<CompletionItem[]>): Promise<CompletionList> {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const completions = await this.projectManager.getCompletions({ srcPath: srcPath, position: params.position });
        return completions;
    }

    @AddStackToErrorMessage
    protected async onDidChangeConfiguration(args: DidChangeConfigurationParams) {
        //if the user changes any user/workspace config settings, just mass-reload all projects
        await this.syncProjects(true);
    }

    /**
     * Called when watched files changed (add/change/delete).
     * The CLIENT is in charge of what files to watch, so all client
     * implementations should ensure that all valid project
     * file types are watched (.brs,.bs,.xml,manifest, and any json/text/image files)
     */
    @AddStackToErrorMessage
    protected async onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        await this.projectManager.handleFileChanges(
            params.changes.map(x => ({
                srcPath: util.uriToPath(x.uri),
                type: x.type
            }))
        );
        return;

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
    }

    @AddStackToErrorMessage
    public async onHover(params: TextDocumentPositionParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getHover({ srcPath: srcPath, position: params.position });
        return result;
    }

    @AddStackToErrorMessage
    public async onWorkspaceSymbol(params: WorkspaceSymbolParams) {
        const result = await this.projectManager.getWorkspaceSymbol();
        return result;
    }

    @AddStackToErrorMessage
    public async onDocumentSymbol(params: DocumentSymbolParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getDocumentSymbol({ srcPath: srcPath });
        return result;
    }

    @AddStackToErrorMessage
    public async onDefinition(params: TextDocumentPositionParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);

        const result = this.projectManager.getDefinition({ srcPath: srcPath, position: params.position });
        return result;
    }

    @AddStackToErrorMessage
    public async onSignatureHelp(params: SignatureHelpParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getSignatureHelp({ srcPath: srcPath, position: params.position });
        return result;
    }

    @AddStackToErrorMessage
    public async onReferences(params: ReferenceParams): Promise<Location[]> {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getReferences({ srcPath: srcPath, position: params.position });
        return result;
    }


    @AddStackToErrorMessage
    private async onFullSemanticTokens(params: SemanticTokensParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getSemanticTokens({ srcPath: srcPath });

        return {
            data: encodeSemanticTokens(result)
        } as SemanticTokens;
    }

    @AddStackToErrorMessage
    public async onCodeAction(params: CodeActionParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getCodeActions({ srcPath: srcPath, range: params.range });
        return result;
    }


    @AddStackToErrorMessage
    public async onExecuteCommand(params: ExecuteCommandParams) {
        await this.waitAllProjectFirstRuns();
        if (params.command === CustomCommands.TranspileFile) {
            const result = await this.projectManager.transpileFile(params.arguments[0]);
            //back-compat: include `pathAbsolute` property so older vscode versions still work
            (result as any).pathAbsolute = result.srcPath;
            return result;
        }
    }

    /**
     * Establish a connection to the client if not already connected
     */
    private establishConnection() {
        if (!this.connection) {
            this.connection = createConnection(ProposedFeatures.all);
        }
    }

    /**
     * Send a new busy status notification to the client based on the current busy status
     */
    private sendBusyStatus() {
        this.busyStatusIndex = ++this.busyStatusIndex <= 0 ? 0 : this.busyStatusIndex;

        void this.connection.sendNotification(NotificationName.busyStatus, {
            status: this.projectManager.busyStatusTracker.status,
            timestamp: Date.now(),
            index: this.busyStatusIndex,
            activeRuns: [...this.projectManager.busyStatusTracker.activeRuns]
        });
    }
    private busyStatusIndex = -1;

    /**
     * Ask the client for the list of `files.exclude` patterns. Useful when determining if we should process a file
     */
    private async getWorkspaceExcludeGlobs(workspaceFolder: string): Promise<string[]> {
        const config = await this.getClientConfiguration<{ exclude: string[] }>(workspaceFolder, 'files');
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
     * Find all folders with bsconfig.json files in them, and treat each as a project.
     * Treat workspaces that don't have a bsconfig.json as a project.
     * Handle situations where bsconfig.json files were added or removed (to elevate/lower workspaceFolder projects accordingly)
     * Leave existing projects alone if they are not affected by these changes
     * @param forceReload if true, all projects are discarded and recreated from scratch
     */
    private async syncProjects(forceReload = false) {
        // get all workspace paths from the client
        let workspaces = await Promise.all(
            (await this.connection.workspace.getWorkspaceFolders() ?? []).map(async (x) => {
                const workspaceFolder = util.uriToPath(x.uri);
                const config = await this.getClientConfiguration<BrightScriptClientConfiguration>(x.uri, 'brightscript');
                return {
                    workspaceFolder: workspaceFolder,
                    excludePatterns: await this.getWorkspaceExcludeGlobs(workspaceFolder),
                    bsconfigPath: config.configFile,
                    //TODO we need to solidify the actual name of this flag in user/workspace settings
                    threadingEnabled: config.languageServer.enableThreading

                } as WorkspaceConfig;
            })
        );

        await this.projectManager.syncProjects(workspaces, forceReload);
    }

    /**
     * Given a workspaceFolder path, get the specified configuration from the client (if applicable).
     * Be sure to use optional chaining to traverse the result in case that configuration doesn't exist or the client doesn't support `getConfiguration`
     * @param workspaceFolder the folder for the workspace in the client
     */
    private async getClientConfiguration<T extends Record<string, any>>(workspaceFolder: string, section: string): Promise<T> {
        let scopeUri: string;
        if (workspaceFolder.startsWith('file:')) {
            scopeUri = URI.parse(workspaceFolder).toString();
        } else {
            scopeUri = URI.file(workspaceFolder).toString();
        }
        let config = {};

        //if the client supports configuration, look for config group called "brightscript"
        if (this.hasConfigurationCapability) {
            config = await this.connection.workspace.getConfiguration({
                scopeUri: scopeUri,
                section: section
            });
        }
        return config as T;
    }

    /**
     * Send a critical failure notification to the client, which should show a notification of some kind
     */
    private sendCriticalFailure(message: string) {
        void this.connection.sendNotification('critical-failure', message);
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
            projectNumber: this.projectCounter++,
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
                    await this.createProject(project.projectPath, project.workspacePath, project.projectNumber);

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

    /**
     * This only operates on files that match the specified files globs, so it is safe to throw
     * any file changes you receive with no unexpected side-effects
     */
    public async handleFileChanges(project: Project, changes: { type: FileChangeType; srcPath: string }[]) {
        //this loop assumes paths are both file paths and folder paths, which eliminates the need to detect.
        //All functions below can handle being given a file path AND a folder path, and will only operate on the one they are looking for
        let consumeCount = 0;
        await Promise.all(changes.map(async (change) => {
            consumeCount += await this.handleFileChange(project, change) ? 1 : 0;
        }));

        if (consumeCount > 0) {
            await this.validateAllThrottled();
        }
    }

    /**
     * This only operates on files that match the specified files globs, so it is safe to throw
     * any file changes you receive with no unexpected side-effects
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
    private async onTextDocumentDidChangeContent(event: TextDocumentChangeEvent<TextDocument>) {
        await this.projectManager.handleFileChanges([{
            srcPath: URI.parse(event.document.uri).fsPath,
            type: FileChangeType.Changed,
            fileContents: event.document.getText()
        }]);
    }

    private async validateAll() {
        try {
            //synchronize parsing for open files that were included/excluded from projects
            await this.synchronizeStandaloneProjects();

            let projects = this.getProjects();

            //validate all programs
            await Promise.all(
                projects.map((project) => {
                    project.builder.program.validate();
                    return project;
                })
            );
        } catch (e: any) {
            this.connection.console.error(e);
            await this.sendCriticalFailure(`Critical error validating project: ${e.message}${e.stack ?? ''}`);
        }
    }

    private onValidateSettled() {
        return Promise.all([
            //wait for the validator to start running (or timeout if it never did)
            this.validateThrottler.onRunOnce(100),
            //wait for the validator to stop running (or resolve immediately if it's already idle)
            this.validateThrottler.onIdleOnce(true)
        ]);
    }

    /**
     * Send diagnostics to the client
     */
    private async sendDiagnostics(options: { project: LspProject; diagnostics: LspDiagnostic[] }) {
        const patch = this.diagnosticCollection.getPatch(options.project, options.diagnostics);

        await Promise.all(Object.keys(patch).map(async (srcPath) => {
            const uri = URI.file(srcPath).toString();
            const diagnostics = patch[srcPath].map(d => util.toDiagnostic(d, uri));

            await this.connection.sendDiagnostics({
                uri: uri,
                diagnostics: diagnostics
            });
        }));
    }
    private diagnosticCollection = new DiagnosticCollection();

    private getProjects() {
        //TODO delete this because projectManager handles all this stuff now
        return [];
    }

    public dispose() {
        this.loggerSubscription?.();
        this.validateThrottler.dispose();
    }
}

export enum CustomCommands {
    TranspileFile = 'TranspileFile'
}

export enum NotificationName {
    busyStatus = 'busyStatus'
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

type Handler<T> = {
    [K in keyof T as K extends `on${string}` ? K : never]:
    T[K] extends (arg: infer U) => void ? (arg: U) => void : never;
};
// Extracts the argument type from the function and constructs the desired interface
type OnHandler<T> = {
    [K in keyof Handler<T>]: Handler<T>[K] extends (arg: infer U) => void ? U : never;
};

interface BrightScriptClientConfiguration {
    configFile: string;
    languageServer: {
        enableThreading: boolean;
    };
}
