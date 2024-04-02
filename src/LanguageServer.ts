import * as path from 'path';
import 'array-flat-polyfill';
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
    CodeActionKind
} from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { util } from './util';
import { Logger } from './Logger';
import { DiagnosticCollection } from './DiagnosticCollection';
import { encodeSemanticTokens, semanticTokensLegend } from './SemanticTokenUtils';
import type { WorkspaceConfig } from './lsp/ProjectManager';
import { ProjectManager } from './lsp/ProjectManager';
import type { LspDiagnostic, LspProject } from './lsp/LspProject';
import type { Project } from './lsp/Project';

export class LanguageServer {

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
    protected standaloneFileProjects = {} as Record<string, Project>;

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

    //run the server
    public run() {
        this.projectManager = new ProjectManager();

        //anytime a project emits a collection of diagnostics, send them to the client
        this.projectManager.on('diagnostics', (event) => {
            void this.sendDiagnostics(event);
        });

        // Send all open document changes whenever a project reloads. This is necessary because the project loads files from disk
        // and may not have the latest unsaved file changes. Any existing projects that already use these files will just ignore the changes
        // because the file contents haven't changed.
        this.projectManager.on('project-reload', (event) => {
            for (const document of this.documents.all()) {
                void this.onTextDocumentDidChangeContent({
                    document: document
                });
            }
        });

        this.projectManager.busyStatusTracker.on('change', (event) => {
            this.sendBusyStatus();
        });
    }

    //run the server
    public run() {
        // Create a connection for the server. The connection uses Node's IPC as a transport.
        this.connection = this.establishConnection();

        //listen to all of the output log events and pipe them into the debug channel in the extension
        this.loggerSubscription = Logger.subscribe((text) => {
            this.connection.tracer.log(text);
        });

        //bind all our on* methods that share the same name from connection
        for (const name of Object.getOwnPropertyNames(LanguageServer.prototype)) {
            if (/on+/.test(name) && typeof this.connection?.[name] === 'function') {
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

    @AddStackToErrorMessage
    private async onTextDocumentDidChangeContent(event: TextDocumentChangeEvent<TextDocument>) {
        await this.projectManager.handleFileChanges([{
            srcPath: URI.parse(event.document.uri).fsPath,
            type: FileChangeType.Changed,
            fileContents: event.document.getText(),
            allowStandaloneProject: true
        }]);
    }

    /**
     * Called when watched files changed (add/change/delete).
     * The CLIENT is in charge of what files to watch, so all client
     * implementations should ensure that all valid project
     * file types are watched (.brs,.bs,.xml,manifest, and any json/text/image files)
     */
    @AddStackToErrorMessage
    public async onDidChangeWatchedFiles(params: DidChangeWatchedFilesParams) {
        await this.projectManager.handleFileChanges(
            params.changes.map(x => ({
                srcPath: util.uriToPath(x.uri),
                type: x.type,
                //if this is an open document, allow this file to be loaded in a standalone project (if applicable)
                allowStandaloneProject: this.documents.get(x.uri) !== undefined
            }))
        );
    }

    @AddStackToErrorMessage
    private async onDocumentClose(event: TextDocumentChangeEvent<TextDocument>): Promise<void> {
        await this.projectManager.handleFileClose({
            srcPath: util.uriToPath(event.document.uri)
        });
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
    public async onDidChangeConfiguration(args: DidChangeConfigurationParams) {
        //if the user changes any user/workspace config settings, just mass-reload all projects
        await this.syncProjects(true);
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
        if (result) {
        return result;
        } else {
            return {
                signatures: [],
                activeSignature: null,
                activeParameter: null
            };
        }

    }

    @AddStackToErrorMessage
    public async onReferences(params: ReferenceParams) {
        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getReferences({ srcPath: srcPath, position: params.position });
        return result ?? [];
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
        if (params.command === CustomCommands.TranspileFile) {
            const args = {
                srcPath: params.arguments[0] as string
            };
            const result = await this.projectManager.transpileFile(args);
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
        return this.connection;
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
                    enableThreading: config.languageServer?.enableThreading ?? true

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
     * Send diagnostics to the client
     */
    private async sendDiagnostics(options: { project: LspProject; diagnostics: LspDiagnostic[] }) {
        const patch = this.diagnosticCollection.getPatch(options.project.projectNumber, options.diagnostics);

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

    protected dispose() {
        this.loggerSubscription?.();
        this.projectManager?.dispose?.();
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
export type OnHandler<T> = {
    [K in keyof Handler<T>]: Handler<T>[K] extends (arg: infer U) => void ? U : never;
};

interface BrightScriptClientConfiguration {
    configFile: string;
    languageServer: {
        enableThreading: boolean;
    };
}
