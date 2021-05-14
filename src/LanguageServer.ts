import 'array-flat-polyfill';
import * as glob from 'glob';
import * as path from 'path';
import * as rokuDeploy from 'roku-deploy';
import type {
    CompletionItem,
    Connection,
    DidChangeWatchedFilesParams,
    Hover,
    InitializeParams,
    ServerCapabilities,
    TextDocumentPositionParams,
    Position,
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
    SemanticTokensParams
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

    public workspaces = [] as Workspace[];

    /**
     * The number of milliseconds that should be used for language server typing debouncing
     */
    private debounceTimeout = 150;

    /**
     * These workspaces are created on the fly whenever a file is opened that is not included
     * in any of the workspace projects.
     * Basically these are single-file workspaces to at least get parsing for standalone files.
     * Also, they should only be created when the file is opened, and destroyed when the file is closed.
     */
    public standaloneFileWorkspaces = {} as Record<string, Workspace>;

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

    private loggerSubscription;

    private keyedThrottler = new KeyedThrottler(this.debounceTimeout);

    public validateThrottler = new Throttler(0);
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
        this.documents.onDidChangeContent(async (change) => {
            await this.validateTextDocument(change.document);
        });

        //whenever a document gets closed
        this.documents.onDidClose(async (change) => {
            await this.onDocumentClose(change.document);
        });

        // This handler provides the initial list of the completion items.
        this.connection.onCompletion(async (params: TextDocumentPositionParams) => {
            return this.onCompletion(params.textDocument.uri, params.position);
        });

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

    private initialWorkspacesCreated: Promise<any>;

    /**
     * Called when the client has finished initializing
     * @param params
     */
    @AddStackToErrorMessage
    private async onInitialized() {
        let workspaceCreatedDeferred = new Deferred();
        this.initialWorkspacesCreated = workspaceCreatedDeferred.promise;

        try {
            if (this.hasConfigurationCapability) {
                // Register for all configuration changes.
                await this.connection.client.register(
                    DidChangeConfigurationNotification.type,
                    undefined
                );
            }

            //ask the client for all workspace folders
            let workspaceFolders = await this.connection.workspace.getWorkspaceFolders() ?? [];
            let workspacePaths = workspaceFolders.map((x) => {
                return util.uriToPath(x.uri);
            });
            await this.createWorkspaces(workspacePaths);
            if (this.clientHasWorkspaceFolderCapability) {
                this.connection.workspace.onDidChangeWorkspaceFolders(async (evt) => {
                    //remove programs for removed workspace folders
                    for (let removed of evt.removed) {
                        let workspacePath = util.uriToPath(removed.uri);
                        let workspace = this.workspaces.find((x) => x.workspacePath === workspacePath);
                        if (workspace) {
                            workspace.builder.dispose();
                            this.workspaces.splice(this.workspaces.indexOf(workspace), 1);
                        }
                    }
                    //create programs for new workspace folders
                    await this.createWorkspaces(evt.added.map((x) => util.uriToPath(x.uri)));
                });
            }
            await this.waitAllProgramFirstRuns(false);
            workspaceCreatedDeferred.resolve();
            await this.sendDiagnostics();
        } catch (e) {
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
    private async waitAllProgramFirstRuns(waitForFirstWorkSpace = true) {
        if (waitForFirstWorkSpace) {
            await this.initialWorkspacesCreated;
        }

        let status;
        let workspaces = this.getWorkspaces();
        for (let workspace of workspaces) {
            try {
                await workspace.firstRunPromise;
            } catch (e) {
                status = 'critical-error';
                //the first run failed...that won't change unless we reload the workspace, so replace with resolved promise
                //so we don't show this error again
                workspace.firstRunPromise = Promise.resolve();
                this.sendCriticalFailure(`BrighterScript language server failed to start: \n${e.message}`);
            }
        }
        this.connection.sendNotification('build-status', status ? status : 'success');
    }

    /**
     * Create project for each new workspace. If the workspace is already known,
     * it is skipped.
     * @param workspaceFolders
     */
    private async createWorkspaces(workspacePaths: string[]) {
        return Promise.all(
            workspacePaths.map(async (workspacePath) => this.createWorkspace(workspacePath))
        );
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
                this.sendCriticalFailure(`Cannot find config file specified in user/workspace settings at '${configFilePath}'`);
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

    private async createWorkspace(workspacePath: string) {
        let workspace = this.workspaces.find((x) => x.workspacePath === workspacePath);
        //skip this workspace if we already have it
        if (workspace) {
            return;
        }

        let builder = new ProgramBuilder();

        //prevent clearing the console on run...this isn't the CLI so we want to keep a full log of everything
        builder.allowConsoleClearing = false;

        //look for files in our in-memory cache before going to the file system
        builder.addFileResolver(this.documentFileResolver.bind(this));

        let configFilePath = await this.getConfigFilePath(workspacePath);

        let cwd = workspacePath;

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

        let newWorkspace: Workspace = {
            builder: builder,
            firstRunPromise: firstRunPromise,
            workspacePath: workspacePath,
            isFirstRunComplete: false,
            isFirstRunSuccessful: false,
            configFilePath: configFilePath,
            isStandaloneFileWorkspace: false
        };

        this.workspaces.push(newWorkspace);

        await firstRunPromise.then(() => {
            newWorkspace.isFirstRunComplete = true;
            newWorkspace.isFirstRunSuccessful = true;
        }).catch(() => {
            newWorkspace.isFirstRunComplete = true;
            newWorkspace.isFirstRunSuccessful = false;
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

    /**
     * @param srcPath The absolute path to the source file on disk
     */
    private async createStandaloneFileWorkspace(srcPath: string) {
        //skip this workspace if we already have it
        if (this.standaloneFileWorkspaces[srcPath]) {
            return this.standaloneFileWorkspaces[srcPath];
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

        let newWorkspace: Workspace = {
            builder: builder,
            firstRunPromise: firstRunPromise,
            workspacePath: srcPath,
            isFirstRunComplete: false,
            isFirstRunSuccessful: false,
            configFilePath: configFilePath,
            isStandaloneFileWorkspace: true
        };

        this.standaloneFileWorkspaces[srcPath] = newWorkspace;

        await firstRunPromise.then(() => {
            newWorkspace.isFirstRunComplete = true;
            newWorkspace.isFirstRunSuccessful = true;
        }).catch(() => {
            newWorkspace.isFirstRunComplete = true;
            newWorkspace.isFirstRunSuccessful = false;
        });
        return newWorkspace;
    }

    private getWorkspaces() {
        let workspaces = this.workspaces.slice();
        for (let key in this.standaloneFileWorkspaces) {
            workspaces.push(this.standaloneFileWorkspaces[key]);
        }
        return workspaces;
    }

    /**
     * Provide a list of completion items based on the current cursor position
     * @param textDocumentPosition
     */
    @AddStackToErrorMessage
    private async onCompletion(uri: string, position: Position) {
        //ensure programs are initialized
        await this.waitAllProgramFirstRuns();

        let filePath = util.uriToPath(uri);

        //wait until the file has settled
        await this.keyedThrottler.onIdleOnce(filePath, true);

        let completions = this
            .getWorkspaces()
            .flatMap(workspace => workspace.builder.program.getCompletions(filePath, position));

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
        await this.waitAllProgramFirstRuns();

        let srcPath = util.uriToPath(params.textDocument.uri);

        //wait until the file has settled
        await this.keyedThrottler.onIdleOnce(srcPath, true);

        const codeActions = this
            .getWorkspaces()
            //skip programs that don't have this file
            .filter(x => x.builder?.program?.hasFile(srcPath))
            .flatMap(workspace => workspace.builder.program.getCodeActions(srcPath, params.range));

        //clone the diagnostics for each code action, since certain diagnostics can have circular reference properties that kill the language server if serialized
        for (const codeAction of codeActions) {
            if (codeAction.diagnostics) {
                codeAction.diagnostics = codeAction.diagnostics.map(x => util.toDiagnostic(x));
            }
        }
        return codeActions;
    }

    /**
     * Reload all specified workspaces, or all workspaces if no workspaces are specified
     */
    private async reloadWorkspaces(workspaces?: Workspace[]) {
        workspaces = workspaces ? workspaces : this.getWorkspaces();
        await Promise.all(
            workspaces.map(async (workspace) => {
                //ensure the workspace has finished starting up
                try {
                    await workspace.firstRunPromise;
                } catch (e) { }

                //handle standard workspace
                if (workspace.isStandaloneFileWorkspace === false) {
                    let idx = this.workspaces.indexOf(workspace);
                    if (idx > -1) {
                        //remove this workspace
                        this.workspaces.splice(idx, 1);
                        //dispose this workspace's resources
                        workspace.builder.dispose();
                    }

                    //create a new workspace/brs program
                    await this.createWorkspace(workspace.workspacePath);

                    //handle temp workspace
                } else {
                    workspace.builder.dispose();
                    delete this.standaloneFileWorkspaces[workspace.workspacePath];
                    await this.createStandaloneFileWorkspace(workspace.workspacePath);
                }
            })
        );
        if (workspaces.length > 0) {
            //wait for all of the programs to finish starting up
            await this.waitAllProgramFirstRuns();

            // valdiate all workspaces
            this.validateAllThrottled(); //eslint-disable-line
        }
    }

    private getRootDir(workspace: Workspace) {
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
    private async synchronizeStandaloneWorkspaces() {

        //remove standalone workspaces that are now included in projects
        for (let standaloneFilePath in this.standaloneFileWorkspaces) {
            let standaloneWorkspace = this.standaloneFileWorkspaces[standaloneFilePath];
            for (let workspace of this.workspaces) {
                await standaloneWorkspace.firstRunPromise;

                let dest = rokuDeploy.getDestPath(
                    standaloneFilePath,
                    workspace?.builder?.program?.options?.files ?? [],
                    this.getRootDir(workspace)
                );
                //destroy this standalone workspace because the file has now been included in an actual workspace,
                //or if the workspace wants the file
                if (workspace?.builder?.program?.hasFile(standaloneFilePath) || dest) {
                    standaloneWorkspace.builder.dispose();
                    delete this.standaloneFileWorkspaces[standaloneFilePath];
                }
            }
        }

        //create standalone workspaces for open files that no longer have a project
        let textDocuments = this.documents.all();
        outer: for (let textDocument of textDocuments) {
            let filePath = URI.parse(textDocument.uri).fsPath;
            let workspaces = this.getWorkspaces();
            for (let workspace of workspaces) {
                let dest = rokuDeploy.getDestPath(
                    filePath,
                    workspace?.builder?.program?.options?.files ?? [],
                    this.getRootDir(workspace)
                );
                //if this workspace has the file, or it wants the file, do NOT make a standalone workspace for this file
                if (workspace?.builder?.program?.hasFile(filePath) || dest) {
                    continue outer;
                }
            }
            //if we got here, no workspace has this file, so make a standalone file workspace
            let workspace = await this.createStandaloneFileWorkspace(filePath);
            await workspace.firstRunPromise;
        }
    }

    @AddStackToErrorMessage
    private async onDidChangeConfiguration() {
        if (this.hasConfigurationCapability) {
            await this.reloadWorkspaces();
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
        await this.waitAllProgramFirstRuns();

        this.connection.sendNotification('build-status', 'building');

        let workspaces = this.getWorkspaces();

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

            //reload any workspace whose bsconfig.json file has changed
            {
                let workspacesToReload = [] as Workspace[];
                //get the file paths as a string array
                let filePaths = changes.map((x) => x.srcPath);

                for (let workspace of workspaces) {
                    if (workspace.configFilePath && filePaths.includes(workspace.configFilePath)) {
                        workspacesToReload.push(workspace);
                    }
                }
                if (workspacesToReload.length > 0) {
                    //vsc can generate a ton of these changes, for vsc system files, so we need to bail if there's no work to do on any of our actual workspace files
                    //reload any workspaces that need to be reloaded
                    await this.reloadWorkspaces(workspacesToReload);
                }

                //set the list of workspaces to non-reloaded workspaces
                workspaces = workspaces.filter(x => !workspacesToReload.includes(x));
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
                    //create a glob pattern to match all files
                    let pattern = rokuDeploy.util.toForwardSlashes(`${dirPath}/**/*`);
                    let files = glob.sync(pattern, {
                        absolute: true
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
                workspaces.map((workspace) => this.handleFileChanges(workspace, changes))
            );
        }
        this.connection.sendNotification('build-status', 'success');
    }

    /**
     * This only operates on files that match the specified files globs, so it is safe to throw
     * any file changes you receive with no unexpected side-effects
     * @param changes
     */
    public async handleFileChanges(workspace: Workspace, changes: { type: FileChangeType; srcPath: string }[]) {
        //this loop assumes paths are both file paths and folder paths, which eliminates the need to detect.
        //All functions below can handle being given a file path AND a folder path, and will only operate on the one they are looking for
        let consumeCount = 0;
        await Promise.all(changes.map(async (change) => {
            await this.keyedThrottler.run(change.srcPath, async () => {
                consumeCount += await this.handleFileChange(workspace, change) ? 1 : 0;
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
    private async handleFileChange(workspace: Workspace, change: { type: FileChangeType; srcPath: string }) {
        const program = workspace.builder.program;
        const options = workspace.builder.options;
        const rootDir = workspace.builder.rootDir;

        //deleted
        if (change.type === FileChangeType.Deleted) {
            //try to act on this path as a directory
            workspace.builder.program.removeFilesInFolder(change.srcPath);

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
                    await workspace.builder.getFileContents(change.srcPath)
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
                    await workspace.builder.getFileContents(change.srcPath)
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
        await this.waitAllProgramFirstRuns();

        let srcPath = util.uriToPath(params.textDocument.uri);
        let workspaces = this.getWorkspaces();
        let hovers = await Promise.all(
            Array.prototype.concat.call([],
                workspaces.map(async (x) => x.builder.program.getHover(srcPath, params.position))
            )
        ) as Hover[];

        //return the first non-falsey hover. TODO is there a way to handle multiple hover results?
        let hover = hovers.filter((x) => !!x)[0];

        //TODO improve this to support more than just .brs files
        if (hover?.contents) {
            //create fenced code block to get colorization
            hover.contents = {
                //TODO - make the program.getHover call figure out what language this is for
                language: 'brightscript',
                value: hover.contents as string
            };
        }
        return hover;
    }

    @AddStackToErrorMessage
    private async onDocumentClose(textDocument: TextDocument): Promise<void> {
        let filePath = URI.parse(textDocument.uri).fsPath;
        let standaloneFileWorkspace = this.standaloneFileWorkspaces[filePath];
        //if this was a temp file, close it
        if (standaloneFileWorkspace) {
            await standaloneFileWorkspace.firstRunPromise;
            standaloneFileWorkspace.builder.dispose();
            delete this.standaloneFileWorkspaces[filePath];
            await this.sendDiagnostics();
        }
    }

    @AddStackToErrorMessage
    private async validateTextDocument(textDocument: TextDocument): Promise<void> {
        //ensure programs are initialized
        await this.waitAllProgramFirstRuns();

        let filePath = URI.parse(textDocument.uri).fsPath;

        try {

            //throttle file processing. first call is run immediately, and then the last call is processed.
            await this.keyedThrottler.run(filePath, () => {

                this.connection.sendNotification('build-status', 'building');

                let documentText = textDocument.getText();
                for (const workspace of this.getWorkspaces()) {
                    //only add or replace existing files. All of the files in the project should
                    //have already been loaded by other means
                    if (workspace.builder.program.hasFile(filePath)) {
                        let rootDir = workspace.builder.program.options.rootDir ?? workspace.builder.program.options.cwd;
                        let dest = rokuDeploy.getDestPath(filePath, workspace.builder.program.options.files, rootDir);
                        workspace.builder.program.setFile({
                            src: filePath,
                            dest: dest
                        }, documentText);
                    }
                }
            });
            // validate all workspaces
            await this.validateAllThrottled();
        } catch (e) {
            this.sendCriticalFailure(`Critical error parsing/ validating ${filePath}: ${e.message}`);
        }
    }

    private async validateAll() {
        try {
            //synchronize parsing for open files that were included/excluded from projects
            await this.synchronizeStandaloneWorkspaces();

            let workspaces = this.getWorkspaces();

            //validate all programs
            await Promise.all(
                workspaces.map((x) => x.builder.program.validate())
            );

            await this.sendDiagnostics();
        } catch (e) {
            this.connection.console.error(e);
            this.sendCriticalFailure(`Critical error validating workspace: ${e.message}${e.stack ?? ''}`);
        }

        this.connection.sendNotification('build-status', 'success');
    }

    @AddStackToErrorMessage
    public async onWorkspaceSymbol(params: WorkspaceSymbolParams) {
        await this.waitAllProgramFirstRuns();

        const results = util.flatMap(
            await Promise.all(this.getWorkspaces().map(workspace => {
                return workspace.builder.program.getWorkspaceSymbols();
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
        await this.waitAllProgramFirstRuns();

        await this.keyedThrottler.onIdleOnce(util.uriToPath(params.textDocument.uri), true);

        const srcPath = util.uriToPath(params.textDocument.uri);
        for (const workspace of this.getWorkspaces()) {
            const file = workspace.builder.program.getFile(srcPath);
            if (isBrsFile(file)) {
                return file.getDocumentSymbols();
            }
        }
    }

    @AddStackToErrorMessage
    private async onDefinition(params: TextDocumentPositionParams) {
        await this.waitAllProgramFirstRuns();

        const srcPath = util.uriToPath(params.textDocument.uri);

        const results = util.flatMap(
            await Promise.all(this.getWorkspaces().map(workspace => {
                return workspace.builder.program.getDefinition(srcPath, params.position);
            })),
            c => c
        );
        return results;
    }

    @AddStackToErrorMessage
    private async onSignatureHelp(params: SignatureHelpParams) {
        await this.waitAllProgramFirstRuns();

        const filepath = util.uriToPath(params.textDocument.uri);
        await this.keyedThrottler.onIdleOnce(filepath, true);

        try {
            const signatures = util.flatMap(
                await Promise.all(this.getWorkspaces().map(workspace => workspace.builder.program.getSignatureHelp(filepath, params.position)
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
        } catch (e) {
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
        await this.waitAllProgramFirstRuns();

        const position = params.position;
        const srcPath = util.uriToPath(params.textDocument.uri);

        const results = util.flatMap(
            await Promise.all(this.getWorkspaces().map(workspace => {
                return workspace.builder.program.getReferences(srcPath, position);
            })),
            c => c
        );
        return results.filter((r) => r);
    }

    @AddStackToErrorMessage
    private async onFullSemanticTokens(params: SemanticTokensParams) {
        await this.waitAllProgramFirstRuns();
        await this.keyedThrottler.onIdleOnce(util.uriToPath(params.textDocument.uri), true);

        const srcPath = util.uriToPath(params.textDocument.uri);
        for (const workspace of this.workspaces) {
            //find the first program that has this file, since it would be incredibly inefficient to generate semantic tokens for the same file multiple times.
            if (workspace.builder.program.hasFile(srcPath)) {
                let semanticTokens = workspace.builder.program.getSemanticTokens(srcPath);
                return {
                    data: encodeSemanticTokens(semanticTokens)
                } as SemanticTokens;
            }
        }
    }

    private diagnosticCollection = new DiagnosticCollection();

    private async sendDiagnostics() {
        //Get only the changes to diagnostics since the last time we sent them to the client
        const patch = await this.diagnosticCollection.getPatch(this.workspaces);

        for (let filePath in patch) {
            const diagnostics = patch[filePath].map(d => util.toDiagnostic(d));

            this.connection.sendDiagnostics({
                uri: URI.file(filePath).toString(),
                diagnostics: diagnostics
            });
        }
    }

    @AddStackToErrorMessage
    public async onExecuteCommand(params: ExecuteCommandParams) {
        await this.waitAllProgramFirstRuns();
        if (params.command === CustomCommands.TranspileFile) {
            return this.transpileFile(params.arguments[0]);
        }
    }

    /**
     * @param srcPath The absolute path to the source file on disk
     */
    private async transpileFile(srcPath: string) {
        //wait all program first runs
        await this.waitAllProgramFirstRuns();
        let workspaces = this.getWorkspaces();
        //find the first workspace that has this file
        for (let workspace of workspaces) {
            if (workspace.builder.program.hasFile(srcPath)) {
                return workspace.builder.program.getTranspiledFileContents(srcPath);
            }
        }
    }

    public dispose() {
        this.loggerSubscription?.();
        this.validateThrottler.dispose();
    }
}

export interface Workspace {
    firstRunPromise: Promise<any>;
    builder: ProgramBuilder;
    workspacePath: string;
    isFirstRunComplete: boolean;
    isFirstRunSuccessful: boolean;
    configFilePath?: string;
    isStandaloneFileWorkspace: boolean;
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
        } catch (e) {
            if (e?.stack) {
                e.message = e.stack;
            }
            throw e;
        }
    };
}
