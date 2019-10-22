import * as path from 'path';
import {
    CompletionItem,
    Connection,
    createConnection,
    Diagnostic,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesParams,
    Hover,
    InitializeParams,
    Location,
    ProposedFeatures,
    Range,
    ServerCapabilities,
    TextDocument,
    TextDocumentPositionParams,
    TextDocuments,
} from 'vscode-languageserver';
import Uri from 'vscode-uri';

import { BsConfig } from './BsConfig';
import { diagnosticMessages } from './DiagnosticMessages';
import { ProgramBuilder } from './ProgramBuilder';
import util from './util';

export class LanguageServer {
    constructor() {

    }
    private connection: Connection;

    public workspaces = [] as Workspace[];

    /**
     * These workspaces are created on the fly whenever a file is opened that is not included
     * in any of the workspace projects.
     * Basically these are single-file workspaces to at least get parsing for standalone files.
     * Also, they should only be created when the file is opened, and destroyed when the file is closed.
     */
    public standaloneFileWorkspaces = {} as { [filePathAbsolute: string]: Workspace };

    private hasConfigurationCapability = false;

    /**
     * Indicates whether the client supports workspace folders
     */
    private clientHasWorkspaceFolderCapability = false;

    /**
     * Create a simple text document manager.
     * The text document manager supports full document sync only
     */
    private documents = new TextDocuments();

    private createConnection() {
        return createConnection(ProposedFeatures.all);
    }

    //run the server
    public run() {
        // Create a connection for the server. The connection uses Node's IPC as a transport.
        // Also include all preview / proposed LSP features.
        this.connection = this.createConnection();

        this.connection.onInitialize(this.onInitialize.bind(this));

        this.connection.onInitialized(this.onInitialized.bind(this));

        this.connection.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this));

        this.connection.onDidChangeWatchedFiles(this.onDidChangeWatchedFiles.bind(this));

        // The content of a text document has changed. This event is emitted
        // when the text document is first opened, when its content has changed,
        // or when document is closed without saving (original contents are sent as a change)
        //
        this.documents.onDidChangeContent(async (change) => {
            await this.validateTextDocument(change.document);
        });
        //whenever a document gets opened
        this.documents.onDidClose(async (change) => {
            await this.onDocumentClose(change.document);
        });

        // This handler provides the initial list of the completion items.
        this.connection.onCompletion(this.onCompletion.bind(this));

        // This handler resolves additional information for the item selected in
        // the completion list.
        this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));

        this.connection.onDefinition(this.onDefinition.bind(this));

        this.connection.onHover(this.onHover.bind(this));

        /*
        this.connection.onDidOpenTextDocument((params) => {
             // A text document got opened in VSCode.
             // params.uri uniquely identifies the document. For documents store on disk this is a file URI.
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
    public async onInitialize(params: InitializeParams) {
        let clientCapabilities = params.capabilities;

        // Does the client support the `workspace/configuration` request?
        // If not, we will fall back using global settings
        this.hasConfigurationCapability = !!(clientCapabilities.workspace && !!clientCapabilities.workspace.configuration);
        this.clientHasWorkspaceFolderCapability = !!(clientCapabilities.workspace && !!clientCapabilities.workspace.workspaceFolders);

        //return the capabilities of the server
        return {
            capabilities: {
                textDocumentSync: this.documents.syncKind,
                // Tell the client that the server supports code completion
                completionProvider: {
                    resolveProvider: true
                },
                definitionProvider: true,
                hoverProvider: true
            } as ServerCapabilities
        };
    }

    /**
     * Called when the client has finished initializing
     * @param params
     */
    private async onInitialized() {
        try {
            if (this.hasConfigurationCapability) {
                // Register for all configuration changes.
                await this.connection.client.register(
                    DidChangeConfigurationNotification.type,
                    undefined
                );
            }

            //ask the client for all workspace folders
            let workspaceFolders = await this.connection.workspace.getWorkspaceFolders();
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
            await this.waitAllProgramFirstRuns();
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
    private async waitAllProgramFirstRuns() {
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
        return await Promise.all(
            workspacePaths.map((workspacePath) => this.createWorkspace(workspacePath))
        );
    }

    /**
     * Event handler for when the program wants to load file contents.
     * anytime the program wants to load a file, check with our in-memory document cache first
     */
    private documentFileResolver(pathAbsolute) {
        let pathUri = Uri.file(pathAbsolute).toString();
        let document = this.documents.get(pathUri);
        if (document) {
            return document.getText();
        }
    }

    private async getConfigFilePath(workspacePath: string) {
        let scopeUri: string;
        if (workspacePath.indexOf('file:') === 0) {
            scopeUri = Uri.parse(workspacePath).toString();
        } else {
            scopeUri = Uri.file(workspacePath).toString();
        }
        //look for config group called "brightscript"
        let config = await this.connection.workspace.getConfiguration({
            scopeUri: scopeUri,
            section: 'brightscript'
        });
        let configFilePath: string;

        //if there's a setting, we need to find the file or show error if it can't be found
        if (config && config.configFile) {
            configFilePath = path.resolve(workspacePath, config.configFile);
            if (await util.fileExists(configFilePath)) {
                return configFilePath;
            } else {
                this.sendCriticalFailure(`Cannot find config file specified in user/workspace settings at '${configFilePath}'`);
            }
        }

        //default to config file path found in the root of the workspace
        configFilePath = path.resolve(workspacePath, 'bsconfig.json');
        if (await util.fileExists(configFilePath)) {
            return configFilePath;
        }

        //look for the depricated `brsconfig.json` file
        configFilePath = path.resolve(workspacePath, 'brsconfig.json');
        if (await util.fileExists(configFilePath)) {
            return configFilePath;
        }

        //no config file could be found
        return null;
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
        builder.addFileResolver((pathAbsolute) => {
            return this.documentFileResolver(pathAbsolute);
        });

        let configFilePath = await this.getConfigFilePath(workspacePath);

        let cwd = workspacePath;

        //if the config file exists, use it and its folder as cwd
        if (await util.fileExists(configFilePath)) {
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
            deploy: false
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
        }).finally(() => {
            //if we found a depricated brsconfig.json, add a diagnostic warning the user
            if (configFilePath && path.basename(configFilePath) === 'brsconfig.json') {
                builder.addDiagnostic(configFilePath, {
                    location: Range.create(0, 0, 0, 0),
                    severity: 'warning',
                    ...diagnosticMessages.BrsConfigJson_is_depricated_1020(),
                });
                return this.sendDiagnostics();
            }
        });
    }

    private async createStandaloneFileWorkspace(filePathAbsolute: string) {
        //skip this workspace if we already have it
        if (this.standaloneFileWorkspaces[filePathAbsolute]) {
            return;
        }

        //if a file called `brsconfig.json` exists, add a diagnostic (because that's the old name...everyone should move to the new name)
        let builder = new ProgramBuilder();

        //prevent clearing the console on run...this isn't the CLI so we want to keep a full log of everything
        builder.allowConsoleClearing = false;

        //look for files in our in-memory cache before going to the file system
        builder.addFileResolver((pathAbsolute) => {
            return this.documentFileResolver(pathAbsolute);
        });

        //get the path to the directory where this file resides
        let cwd = path.dirname(filePathAbsolute);

        //get the closest config file and use most of the settings from that
        let configFilePath = await util.findClosestConfigFile(filePathAbsolute);
        let project: BsConfig = {};
        if (configFilePath) {
            project = await util.normalizeAndResolveConfig({ project: configFilePath });
            //override the rootDir and files array
            project.rootDir = cwd;
            project.files = [
                filePathAbsolute
            ];
        }

        let firstRunPromise = builder.run({
            ...project,
            cwd: cwd,
            project: configFilePath,
            watch: false,
            createPackage: false,
            deploy: false
        }).catch((err) => {
            console.error(err);
        });

        let newWorkspace: Workspace = {
            builder: builder,
            firstRunPromise: firstRunPromise,
            workspacePath: filePathAbsolute,
            isFirstRunComplete: false,
            isFirstRunSuccessful: false,
            configFilePath: configFilePath,
            isStandaloneFileWorkspace: true
        };

        this.standaloneFileWorkspaces[filePathAbsolute] = newWorkspace;

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
    private async onCompletion(textDocumentPosition: TextDocumentPositionParams) {
        //ensure programs are initialized
        await this.waitAllProgramFirstRuns();

        let filePath = util.uriToPath(textDocumentPosition.textDocument.uri);

        let workspaceCompletionPromises = [] as Array<Promise<CompletionItem[]>>;
        let workspaces = this.getWorkspaces();
        //get completions from every workspace
        for (let workspace of workspaces) {
            //if this workspace has the file in question, get its completions
            if (workspace.builder.program.hasFile(filePath)) {
                workspaceCompletionPromises.push(
                    workspace.builder.program.getCompletions(filePath, textDocumentPosition.position)
                );
            }
        }

        //wait for all promises to resolve, and then flatten them into a single array
        let completions = [].concat(...await Promise.all(workspaceCompletionPromises));

        let result = [] as CompletionItem[];
        for (let completion of completions) {
            if (completion) {
                result.push(completion);
            }
        }
        return result;
    }

    /**
     * Provide a full completion item from the selection
     * @param item
     */
    private onCompletionResolve(item: CompletionItem): CompletionItem {
        if (item.data === 1) {
            (item.detail = 'TypeScript details'),
                (item.documentation = 'TypeScript documentation');
        } else if (item.data === 2) {
            (item.detail = 'JavaScript details'),
                (item.documentation = 'JavaScript documentation');
        }
        return item;
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
        //wait for all of the programs to finish starting up
        await this.waitAllProgramFirstRuns();

        //remove any standalone file workspaces in case they have now been included in an actual project
        await this.synchronizeStandaloneWorkspaces();

        //validate each workspace
        await Promise.all(
            this.workspaces.map((x) => {
                //only validate workspaces with a working builder (i.e. no critical runtime errors)
                if (x.isFirstRunComplete && x.isFirstRunSuccessful) {
                    return x.builder.program.validate();
                }
            })
        );

        //send all diagnostics
        await this.sendDiagnostics();
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

                //destroy this standalone workspace because the file has now been included in an actual workspace
                if (workspace.builder && workspace.builder.program && workspace.builder.program.hasFile(standaloneFilePath)) {
                    standaloneWorkspace.builder.dispose();
                    delete this.standaloneFileWorkspaces[standaloneFilePath];
                }
            }
        }

        //create standalone workspaces for open files that no longer have a project
        let textDocuments = this.documents.all();
        outer: for (let textDocument of textDocuments) {
            let filePath = Uri.parse(textDocument.uri).fsPath;
            let workspaces = this.getWorkspaces();
            for (let workspace of workspaces) {
                if (workspace.builder && workspace.builder.program && workspace.builder.program.hasFile(filePath)) {
                    continue outer;
                }
            }
            //if we got here, no workspace has this file, so make a standalone file workspace
            let workspace = await this.createStandaloneFileWorkspace(filePath);
            await workspace.firstRunPromise;
        }
    }
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
    private async onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        //ensure programs are initialized
        await this.waitAllProgramFirstRuns();

        this.connection.sendNotification('build-status', 'building');

        let workspaces = this.getWorkspaces();

        //reload any workspace whose bsconfig.json file has changed
        {
            let workspacesToReload = [] as Workspace[];
            let filePaths = params.changes.map((x) => util.uriToPath(x.uri));
            for (let workspace of workspaces) {
                if (filePaths.indexOf(workspace.configFilePath) > -1) {
                    workspacesToReload.push(workspace);
                }
            }
            await this.reloadWorkspaces(workspacesToReload);
        }

        //give every workspace the chance to handle file changes
        await Promise.all(
            workspaces.map((x) => x.builder.handleFileChanges(params.changes))
        );

        //revalidate every program
        await Promise.all(
            workspaces.map((x) => x.builder.program.validate())
        );

        //send all diagnostics to the client
        await this.sendDiagnostics();
        this.connection.sendNotification('build-status', 'success');
    }

    private async onHover(params: TextDocumentPositionParams) {
        //ensure programs are initialized
        await this.waitAllProgramFirstRuns();

        let pathAbsolute = util.uriToPath(params.textDocument.uri);
        let workspaces = this.getWorkspaces();
        let hovers = Array.prototype.concat.call([],
            workspaces.map((x) => x.builder.program.getHover(pathAbsolute, params.position))
        ) as Hover[];

        //return the first non-falsey hover. TODO is there a way to handle multiple hover results?
        let hover = hovers.filter((x) => !!x)[0];

        //TODO improve this to support more than just .brs files
        if (hover && hover.contents) {
            //create fenced code block to get colorization
            hover.contents = {
                //TODO - make the program.getHover call figure out what language this is for
                language: 'brightscript',
                value: hover.contents as string
            };
        }
        return hover;
    }

    private async onDocumentClose(textDocument: TextDocument): Promise<void> {
        let filePath = Uri.parse(textDocument.uri).fsPath;
        let standaloneFileWorkspace = this.standaloneFileWorkspaces[filePath];
        //if this was a temp file, close it
        if (standaloneFileWorkspace) {
            await standaloneFileWorkspace.firstRunPromise;
            standaloneFileWorkspace.builder.dispose();
            delete this.standaloneFileWorkspaces[filePath];
            await this.sendDiagnostics();
        }
    }

    private async validateTextDocument(textDocument: TextDocument): Promise<void> {
        this.connection.sendNotification('build-status', 'building');

        //ensure programs are initialized
        await this.waitAllProgramFirstRuns();

        let filePath = Uri.parse(textDocument.uri).fsPath;
        let documentText = textDocument.getText();
        let workspaces = this.getWorkspaces();
        try {
            await Promise.all(
                workspaces.map((x) => {
                    //only add or replace existing files. All of the files in the project should
                    //have already been loaded by other means
                    if (x.builder.program.hasFile(filePath)) {
                        return x.builder.program.addOrReplaceFile(filePath, documentText);
                    }
                })
            );

            //synchronze parsing for open files that were included/excluded from projects
            await this.synchronizeStandaloneWorkspaces();

            //validate all programs
            await Promise.all(
                workspaces.map((x) => x.builder.program.validate())
            );
        } catch (e) {
            this.sendCriticalFailure(`Critical error parsing/validating ${filePath}: ${e.message}`);
        }
        await this.sendDiagnostics();
        this.connection.sendNotification('build-status', 'success');
    }

    private async onDefinition(params: TextDocumentPositionParams): Promise<Location[]> {
        //WARNING: This only works for a few small xml cases because the vscode-brightscript-language extension
        //already implemented this feature, and I haven't had time to port all of that functionality over to
        //this codebase
        //TODO implement for brs/bs also
        await this.waitAllProgramFirstRuns();
        let results = [] as Location[];

        let pathAbsolute = util.uriToPath(params.textDocument.uri);
        let workspaces = this.getWorkspaces();
        for (let workspace of workspaces) {
            results = results.concat(
                ...workspace.builder.program.getDefinition(pathAbsolute, params.position)
            );
        }
        return results;
    }

    /**
     * The list of all issues, indexed by file. This allows us to keep track of which buckets of
     * diagnostics to send and which to skip because nothing has changed
     */
    private latestDiagnosticsByFile = {} as { [key: string]: Diagnostic[] };
    private async sendDiagnostics() {
        //compute the new list of diagnostics for whole project
        let issuesByFile = {} as { [key: string]: Diagnostic[] };
        let workspaces = this.getWorkspaces();

        //make a bucket for every file in every project
        for (let workspace of workspaces) {
            //Ensure the program was constructued. This prevents race conditions where certain diagnostics are being sent before the program was created.
            await workspace.firstRunPromise;
            //if there is no program, skip this workspace (hopefully diagnostics were added to the builder itself
            if (workspace.builder && workspace.builder.program) {
                for (let filePath in workspace.builder.program.files) {
                    issuesByFile[filePath] = [];
                }
            }
        }

        let diagnostics = Array.prototype.concat.apply([],
            workspaces.map((x) => x.builder.getDiagnostics())
        );

        for (let diagnostic of diagnostics) {
            //certain diagnostics are attached to non-tracked files, so create those buckets dynamically
            if (!issuesByFile[diagnostic.file.pathAbsolute]) {
                issuesByFile[diagnostic.file.pathAbsolute] = [];
            }
            issuesByFile[diagnostic.file.pathAbsolute].push({
                severity: util.severityToDiagnostic(diagnostic.severity),
                range: diagnostic.location,
                message: diagnostic.message,
                code: diagnostic.code,
                source: 'brs'
            });
        }

        //send all diagnostics
        for (let filePath in issuesByFile) {
            //TODO filter by only the files that have changed
            this.connection.sendDiagnostics({
                uri: Uri.file(filePath).toString(),
                diagnostics: issuesByFile[filePath]
            });
        }

        //clear any diagnostics for files that are no longer present
        let currentFilePaths = Object.keys(issuesByFile);
        for (let filePath in this.latestDiagnosticsByFile) {
            if (currentFilePaths.indexOf(filePath) === -1) {
                this.connection.sendDiagnostics({
                    uri: Uri.file(filePath).toString(),
                    diagnostics: []
                });
            }
        }

        //save the new list of diagnostics
        this.latestDiagnosticsByFile = issuesByFile;
    }
}

interface Workspace {
    firstRunPromise: Promise<any>;
    builder: ProgramBuilder;
    workspacePath: string;
    isFirstRunComplete: boolean;
    isFirstRunSuccessful: boolean;
    configFilePath?: string;
    isStandaloneFileWorkspace: boolean;
}
