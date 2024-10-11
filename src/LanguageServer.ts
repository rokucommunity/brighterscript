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
import { DiagnosticCollection } from './DiagnosticCollection';
import { encodeSemanticTokens, semanticTokensLegend } from './SemanticTokenUtils';
import { LogLevel, createLogger, logger, setLspLoggerProps } from './logging';
import ignore from 'ignore';
import * as micromatch from 'micromatch';
import type { LspProject, LspDiagnostic } from './lsp/LspProject';
import { PathFilterer } from './lsp/PathFilterer';
import type { WorkspaceConfig } from './lsp/ProjectManager';
import { ProjectManager } from './lsp/ProjectManager';
import * as fsExtra from 'fs-extra';
import type { MaybePromise } from './interfaces';
import { workerPool } from './lsp/worker/WorkerThreadProject';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import isEqual = require('lodash.isequal');

export class LanguageServer {
    /**
     * The default threading setting for the language server. Can be overridden by per-workspace settings
     */
    public static enableThreadingDefault = true;
    /**
     * The language server protocol connection, used to send and receive all requests and responses
     */
    private connection = undefined as Connection;

    /**
     * Manages all projects for this language server
     */
    private projectManager: ProjectManager;

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

    /**
     * Used to filter paths based on include/exclude lists (like .gitignore or vscode's `files.exclude`).
     * This is used to prevent the language server from being overwhelmed by files we don't actually want to handle
     */
    private pathFilterer: PathFilterer;

    public logger = createLogger({
        logLevel: LogLevel.log
    });

    constructor() {
        setLspLoggerProps();
        //replace the workerPool logger with our own so logging info can be synced
        workerPool.logger = this.logger.createLogger();

        this.pathFilterer = new PathFilterer({ logger: this.logger });

        this.projectManager = new ProjectManager({
            pathFilterer: this.pathFilterer,
            logger: this.logger.createLogger()
        });

        //anytime a project emits a collection of diagnostics, send them to the client
        this.projectManager.on('diagnostics', (event) => {
            this.logger.debug(`Received ${event.diagnostics.length} diagnostics from project ${event.project.projectNumber}`);
            this.sendDiagnostics(event).catch(logAndIgnoreError);
        });

        // Send all open document changes whenever a project is activated. This is necessary because at project startup, the project loads files from disk
        // and may not have the latest unsaved file changes. Any existing projects that already use these files will just ignore the changes
        // because the file contents haven't changed.

        this.projectManager.on('project-activate', (event) => {
            //keep logLevel in sync with the most verbose log level found across all projects
            this.syncLogLevel().catch(logAndIgnoreError);

            //resend all open document changes
            const documents = [...this.documents.all()];
            if (documents.length > 0) {
                this.logger.log(`Project ${event.project?.projectNumber} loaded or changed. Resending all open document changes.`, documents.map(x => x.uri));
                for (const document of this.documents.all()) {
                    this.onTextDocumentDidChangeContent({
                        document: document
                    }).catch(logAndIgnoreError);
                }
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

        //disable logger colors when running in LSP mode
        logger.enableColor = false;

        //listen to all of the output log events and pipe them into the debug channel in the extension
        this.loggerSubscription = logger.subscribe((message) => {
            this.connection.tracer.log(message.argsText);
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
        this.logger.log('onInitialized');

        //cache a copy of all workspace configurations to use for comparison later
        this.workspaceConfigsCache = new Map(
            (await this.getWorkspaceConfigs()).map(x => [x.workspaceFolder, x])
        );

        //set our logger to the most verbose logLevel found across any project
        await this.syncLogLevel();

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

            //populate the path filterer with the client's include/exclude lists
            await this.rebuildPathFilterer();

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
     * Set our logLevel to the most verbose log level found across all projects and workspaces
     */
    private async syncLogLevel() {
        /**
         * helper to get the logLevel from a list of items and return the item and level (if found), or undefined if not
         */
        const getLogLevel = async<T>(
            items: T[],
            fetcher: (item: T) => MaybePromise<LogLevel | string>
        ): Promise<{ logLevel: LogLevel; logLevelText: string; item: T }> => {
            const logLevels = await Promise.all(
                items.map(async (item) => {
                    let value = await fetcher(item);
                    //force string values to lower case (so we can support things like 'log' or 'Log' or 'LOG')
                    if (typeof value === 'string') {
                        value = value.toLowerCase();
                    }
                    const logLevelNumeric = this.logger.getLogLevelNumeric(value as any);

                    if (typeof logLevelNumeric === 'number') {
                        return logLevelNumeric;
                    } else {
                        return -1;
                    }
                })
            );
            let idx = logLevels.findIndex(x => x > -1);
            if (idx > -1) {
                const mostVerboseLogLevel = Math.max(...logLevels);
                return {
                    logLevel: mostVerboseLogLevel,
                    logLevelText: this.logger.getLogLevelText(mostVerboseLogLevel),
                    //find the first item having the most verbose logLevel
                    item: items[logLevels.findIndex(x => x === mostVerboseLogLevel)]
                };
            }
        };

        const workspaces = await this.getWorkspaceConfigs();

        let workspaceResult = await getLogLevel(workspaces, workspace => workspace?.languageServer?.logLevel);

        if (workspaceResult) {
            this.logger.info(`Setting global logLevel to '${workspaceResult.logLevelText}' based on configuration from workspace '${workspaceResult?.item?.workspaceFolder}'`);
            this.logger.logLevel = workspaceResult.logLevel;
            return;
        }

        let projectResult = await getLogLevel(this.projectManager.projects, (project) => project.logger.logLevel);
        if (projectResult) {
            this.logger.info(`Setting global logLevel to '${projectResult.logLevelText}' based on project #${projectResult?.item?.projectNumber}`);
            this.logger.logLevel = projectResult.logLevel;
            return;
        }

        //use a default level if no other level was found
        this.logger.logLevel = LogLevel.log;
    }

    @AddStackToErrorMessage
    private async onTextDocumentDidChangeContent(event: TextDocumentChangeEvent<TextDocument>) {
        this.logger.debug('onTextDocumentDidChangeContent', event.document.uri);

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
        const workspacePaths = (await this.connection.workspace.getWorkspaceFolders()).map(x => util.uriToPath(x.uri));

        let changes = params.changes
            .map(x => ({
                srcPath: util.uriToPath(x.uri),
                type: x.type,
                //if this is an open document, allow this file to be loaded in a standalone project (if applicable)
                allowStandaloneProject: this.documents.get(x.uri) !== undefined
            }))
            //exclude all explicit top-level workspace folder paths (to fix a weird macos fs watcher bug that emits events for the workspace folder itself)
            .filter(x => !workspacePaths.includes(x.srcPath));

        this.logger.debug('onDidChangeWatchedFiles', changes);

        //if the client changed any files containing include/exclude patterns, rebuild the path filterer before processing these changes
        if (
            micromatch.some(changes.map(x => x.srcPath), [
                '**/.gitignore',
                '**/.vscode/settings.json',
                '**/*bsconfig*.json'
            ], {
                dot: true
            })
        ) {
            await this.rebuildPathFilterer();
        }

        //handle the file changes
        await this.projectManager.handleFileChanges(changes);
    }

    @AddStackToErrorMessage
    private async onDocumentClose(event: TextDocumentChangeEvent<TextDocument>): Promise<void> {
        this.logger.debug('onDocumentClose', event.document.uri);

        await this.projectManager.handleFileClose({
            srcPath: util.uriToPath(event.document.uri)
        });
    }

    /**
     * Provide a list of completion items based on the current cursor position
     */
    @AddStackToErrorMessage
    public async onCompletion(params: CompletionParams, cancellationToken: CancellationToken, workDoneProgress: WorkDoneProgressReporter, resultProgress: ResultProgressReporter<CompletionItem[]>): Promise<CompletionList> {
        this.logger.debug('onCompletion', params, cancellationToken);

        const srcPath = util.uriToPath(params.textDocument.uri);
        const completions = await this.projectManager.getCompletions({
            srcPath: srcPath,
            position: params.position,
            cancellationToken: cancellationToken
        });
        return completions;
    }

    /**
     * Get a list of workspaces, and their configurations.
     * Get only the settings for the workspace that are relevant to the language server. We do this so we can cache this object for use in change detection in the future.
     */
    private async getWorkspaceConfigs(): Promise<WorkspaceConfigWithExtras[]> {
        //get all workspace folders (we'll use these to get settings)
        let workspaces = await Promise.all(
            (await this.connection.workspace.getWorkspaceFolders() ?? []).map(async (x) => {
                const workspaceFolder = util.uriToPath(x.uri);
                const brightscriptConfig = await this.getClientConfiguration<BrightScriptClientConfiguration>(x.uri, 'brightscript');
                return {
                    workspaceFolder: workspaceFolder,
                    excludePatterns: await this.getWorkspaceExcludeGlobs(workspaceFolder),
                    bsconfigPath: brightscriptConfig.configFile,
                    languageServer: {
                        enableThreading: brightscriptConfig.languageServer?.enableThreading ?? LanguageServer.enableThreadingDefault,
                        logLevel: brightscriptConfig?.languageServer?.logLevel
                    }

                } as WorkspaceConfigWithExtras;
            })
        );
        return workspaces;
    }

    private workspaceConfigsCache = new Map<string, WorkspaceConfigWithExtras>();

    @AddStackToErrorMessage
    public async onDidChangeConfiguration(args: DidChangeConfigurationParams) {
        this.logger.log('onDidChangeConfiguration', 'Reloading all projects');

        const configs = new Map(
            (await this.getWorkspaceConfigs()).map(x => [x.workspaceFolder, x])
        );
        //find any changed configs. This includes newly created workspaces, deleted workspaces, etc.
        //TODO: enhance this to only reload specific projects, depending on the change
        if (!isEqual(configs, this.workspaceConfigsCache)) {
            //now that we've processed any config diffs, update the cached copy of them
            this.workspaceConfigsCache = configs;

            //if configuration changed, rebuild the path filterer
            await this.rebuildPathFilterer();

            //if the user changes any user/workspace config settings, just mass-reload all projects
            await this.syncProjects(true);
        }
    }


    @AddStackToErrorMessage
    public async onHover(params: TextDocumentPositionParams) {
        this.logger.debug('onHover', params);

        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getHover({ srcPath: srcPath, position: params.position });
        return result;
    }

    @AddStackToErrorMessage
    public async onWorkspaceSymbol(params: WorkspaceSymbolParams) {
        this.logger.debug('onWorkspaceSymbol', params);

        const result = await this.projectManager.getWorkspaceSymbol();
        return result;
    }

    @AddStackToErrorMessage
    public async onDocumentSymbol(params: DocumentSymbolParams) {
        this.logger.debug('onDocumentSymbol', params);

        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getDocumentSymbol({ srcPath: srcPath });
        return result;
    }

    @AddStackToErrorMessage
    public async onDefinition(params: TextDocumentPositionParams) {
        this.logger.debug('onDefinition', params);

        const srcPath = util.uriToPath(params.textDocument.uri);

        const result = this.projectManager.getDefinition({ srcPath: srcPath, position: params.position });
        return result;
    }

    @AddStackToErrorMessage
    public async onSignatureHelp(params: SignatureHelpParams) {
        this.logger.debug('onSignatureHelp', params);

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
        this.logger.debug('onReferences', params);

        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getReferences({ srcPath: srcPath, position: params.position });
        return result ?? [];
    }


    @AddStackToErrorMessage
    private async onFullSemanticTokens(params: SemanticTokensParams) {
        this.logger.debug('onFullSemanticTokens', params);

        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getSemanticTokens({ srcPath: srcPath });

        return {
            data: encodeSemanticTokens(result)
        } as SemanticTokens;
    }

    @AddStackToErrorMessage
    public async onCodeAction(params: CodeActionParams) {
        this.logger.debug('onCodeAction', params);

        const srcPath = util.uriToPath(params.textDocument.uri);
        const result = await this.projectManager.getCodeActions({ srcPath: srcPath, range: params.range });
        return result;
    }


    @AddStackToErrorMessage
    public async onExecuteCommand(params: ExecuteCommandParams) {
        this.logger.debug('onExecuteCommand', params);

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

        this.connection.sendNotification(NotificationName.busyStatus, {
            status: this.projectManager.busyStatusTracker.status,
            timestamp: Date.now(),
            index: this.busyStatusIndex,
            activeRuns: [...this.projectManager.busyStatusTracker.activeRuns]
        })?.catch(logAndIgnoreError);
    }
    private busyStatusIndex = -1;

    /**
     * Populate the path filterer with the client's include/exclude lists and the projects include lists
     * @returns the instance of the path filterer
     */
    private async rebuildPathFilterer() {
        this.pathFilterer.clear();
        const workspaceConfigs = await this.getWorkspaceConfigs();
        await Promise.all(workspaceConfigs.map(async (workspaceConfig) => {
            const rootDir = util.uriToPath(workspaceConfig.workspaceFolder);

            //always exclude everything from these common folders
            this.pathFilterer.registerExcludeList(rootDir, [
                '**/node_modules/**/*',
                '**/.git/**/*',
                'out/**/*',
                '**/.roku-deploy-staging/**/*'
            ]);
            //get any `files.exclude` patterns from the client from this workspace
            this.pathFilterer.registerExcludeList(rootDir, workspaceConfig.excludePatterns);

            //get any .gitignore patterns from the client from this workspace
            const gitignorePath = path.resolve(rootDir, '.gitignore');
            if (await fsExtra.pathExists(gitignorePath)) {
                const matcher = ignore({ ignoreCase: true }).add(
                    fsExtra.readFileSync(gitignorePath).toString()
                );
                this.pathFilterer.registerExcludeMatcher((p: string) => {
                    const relPath = path.relative(rootDir, p);
                    if (ignore.isPathValid(relPath)) {
                        return matcher.test(relPath).ignored;
                    } else {
                        //we do not have a valid relative path, so we cannot determine if it is ignored...thus it is NOT ignored
                        return false;
                    }
                });
            }
        }));
        this.logger.log('pathFilterer successfully reconstructed');

        return this.pathFilterer;
    }

    /**
     * Ask the client for the list of `files.exclude` patterns. Useful when determining if we should process a file
     */
    private async getWorkspaceExcludeGlobs(workspaceFolder: string): Promise<string[]> {
        const config = await this.getClientConfiguration<{ exclude: string[] }>(workspaceFolder, 'files');
        const result = Object
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
            .flat(1);
        return result;
    }

    /**
     * Ask the project manager to sync all projects found within the list of workspaces
     * @param forceReload if true, all projects are discarded and recreated from scratch
     */
    private async syncProjects(forceReload = false) {
        const workspaces = await this.getWorkspaceConfigs();

        await this.projectManager.syncProjects(workspaces, forceReload);

        //set our logLevel to the most verbose log level found across all projects and workspaces
        await this.syncLogLevel();
    }

    /**
     * Given a workspaceFolder path, get the specified configuration from the client (if applicable).
     * Be sure to use optional chaining to traverse the result in case that configuration doesn't exist or the client doesn't support `getConfiguration`
     * @param workspaceFolder the folder for the workspace in the client
     */
    private async getClientConfiguration<T extends Record<string, any>>(workspaceFolder: string, section: string): Promise<T> {
        const scopeUri = util.pathToUri(workspaceFolder);
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
        this.connection.sendNotification('critical-failure', message).catch(logAndIgnoreError);
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
        logLevel: LogLevel | string;
    };
}

function logAndIgnoreError(error: Error) {
    if (error?.stack) {
        error.message = error.stack;
    }
    console.error(error);
}

export type WorkspaceConfigWithExtras = WorkspaceConfig & {
    bsconfigPath: string;
    languageServer: {
        enableThreading: boolean;
        logLevel: LogLevel | string | undefined;
    };
};
