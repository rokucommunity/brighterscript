import * as EventEmitter from 'eventemitter3';
import { Worker } from 'worker_threads';
import type { WorkerMessage } from './MessageHandler';
import { MessageHandler } from './MessageHandler';
import util from '../../util';
import type { LspDiagnostic, ActivateResponse, ProjectConfig } from '../LspProject';
import { type LspProject } from '../LspProject';
import { isMainThread, parentPort } from 'worker_threads';
import { WorkerThreadProjectRunner } from './WorkerThreadProjectRunner';
import { WorkerPool } from './WorkerPool';
import type { Hover, MaybePromise, SemanticToken } from '../../interfaces';
import type { DocumentAction, DocumentActionWithStatus } from '../DocumentManager';
import { Deferred } from '../../deferred';
import type { FileTranspileResult, SignatureInfoObj } from '../../Program';
import type { Position, Range, Location, DocumentSymbol, WorkspaceSymbol, CodeAction, CompletionList } from 'vscode-languageserver-protocol';
import type { Logger } from '../../logging';
import { createLogger } from '../../logging';
import { Trace } from '../../common/Decorators';

export const workerPool = new WorkerPool(() => {
    return new Worker(
        __filename,
        {
            //wire up ts-node if we're running in ts-node
            execArgv: /\.ts$/i.test(__filename)
                ? ['--require', 'ts-node/register']
                /* istanbul ignore next */
                : undefined
        }
    );
});

//if this script is running in a Worker, start the project runner
/* istanbul ignore next */
if (!isMainThread) {
    const runner = new WorkerThreadProjectRunner();
    runner.run(parentPort);
}

@Trace()
export class WorkerThreadProject implements LspProject {
    public constructor(
        options?: {
            logger?: Logger;
        }
    ) {
        this.logger = options?.logger ?? createLogger();
    }

    public async activate(options: ProjectConfig) {
        this.activateOptions = options;
        this.projectPath = options.projectPath ? util.standardizePath(options.projectPath) : options.projectPath;
        this.workspaceFolder = options.workspaceFolder ? util.standardizePath(options.workspaceFolder) : options.workspaceFolder;
        this.projectNumber = options.projectNumber;
        this.bsconfigPath = options.bsconfigPath ? util.standardizePath(options.bsconfigPath) : options.bsconfigPath;

        // start a new worker thread or get an unused existing thread
        this.worker = workerPool.getWorker();
        this.messageHandler = new MessageHandler<LspProject>({
            name: 'MainThread',
            port: this.worker,
            onRequest: this.processRequest.bind(this),
            onUpdate: this.processUpdate.bind(this)
        });
        this.disposables.push(this.messageHandler);

        const activateResponse = await this.messageHandler.sendRequest<ActivateResponse>('activate', { data: [options] });
        this.bsconfigPath = activateResponse.data.bsconfigPath;
        this.rootDir = activateResponse.data.rootDir;
        this.filePatterns = activateResponse.data.filePatterns;
        this.logger.logLevel = activateResponse.data.logLevel;

        this.activationDeferred.resolve();
        return activateResponse.data;
    }

    public logger: Logger;

    private activationDeferred = new Deferred();

    /**
     * Options used to activate this project
     */
    public activateOptions: ProjectConfig;

    /**
     * The root directory of the project
     */
    public rootDir: string;

    /**
     * The file patterns from bsconfig.json that were used to find all files for this project
     */
    public filePatterns: string[];

    /**
     * Path to a bsconfig.json file that will be used for this project
     */
    public bsconfigPath?: string;

    /**
     * The worker thread where the actual project will execute
     */
    private worker: Worker;

    /**
     * The path to where the project resides
     */
    public projectPath: string;

    /**
     * A unique number for this project, generated during this current language server session. Mostly used so we can identify which project is doing logging
     */
    public projectNumber: number;

    /**
     * The path to the workspace where this project resides. A workspace can have multiple projects (by adding a bsconfig.json to each folder).
     * Defaults to `.projectPath` if not set
     */
    public workspaceFolder: string;

    /**
     * Promise that resolves when the project finishes activating
     * @returns a promise that resolves when the project finishes activating
     */
    public whenActivated() {
        return this.activationDeferred.promise;
    }


    /**
     * Validate the project. This will trigger a full validation on any scopes that were changed since the last validation,
     * and will also eventually emit a new 'diagnostics' event that includes all diagnostics for the project
     */
    public async validate() {
        const response = await this.messageHandler.sendRequest<void>('validate');
        return response.data;
    }

    /**
     * Cancel any active validation that's running
     */
    public async cancelValidate() {
        const response = await this.messageHandler.sendRequest<void>('cancelValidate');
        return response.data;
    }

    public async getDiagnostics() {
        const response = await this.messageHandler.sendRequest<LspDiagnostic[]>('getDiagnostics');
        return response.data;
    }

    /**
     * Apply a series of file changes to the project. This is safe to call any time. Changes will be queued and flushed at the correct times
     * during the program's lifecycle flow
     */
    public async applyFileChanges(documentActions: DocumentAction[]): Promise<DocumentActionWithStatus[]> {
        const response = await this.messageHandler.sendRequest<DocumentActionWithStatus[]>('applyFileChanges', {
            data: [documentActions]
        });
        return response.data;
    }

    /**
     * Send a request with the standard structure
     * @param name the name of the request
     * @param data the array of data to send
     * @returns the response from the request
     */
    private async sendStandardRequest<T>(name: string, ...data: any[]) {
        const response = await this.messageHandler.sendRequest<T>(name as any, {
            data: data
        });
        return response.data;
    }

    /**
     * Get the full list of semantic tokens for the given file path
     */
    public async getSemanticTokens(options: { srcPath: string }) {
        return this.sendStandardRequest<SemanticToken[]>('getSemanticTokens', options);
    }

    public async transpileFile(options: { srcPath: string }) {
        return this.sendStandardRequest<FileTranspileResult>('transpileFile', options);
    }

    public async getHover(options: { srcPath: string; position: Position }): Promise<Hover[]> {
        return this.sendStandardRequest<Hover[]>('getHover', options);
    }

    public async getDefinition(options: { srcPath: string; position: Position }): Promise<Location[]> {
        return this.sendStandardRequest<Location[]>('getDefinition', options);
    }

    public async getSignatureHelp(options: { srcPath: string; position: Position }): Promise<SignatureInfoObj[]> {
        return this.sendStandardRequest<SignatureInfoObj[]>('getSignatureHelp', options);
    }

    public async getDocumentSymbol(options: { srcPath: string }): Promise<DocumentSymbol[]> {
        return this.sendStandardRequest<DocumentSymbol[]>('getDocumentSymbol', options);
    }

    public async getWorkspaceSymbol(): Promise<WorkspaceSymbol[]> {
        return this.sendStandardRequest<WorkspaceSymbol[]>('getWorkspaceSymbol');
    }

    public async getReferences(options: { srcPath: string; position: Position }): Promise<Location[]> {
        return this.sendStandardRequest<Location[]>('getReferences', options);
    }

    public async getCodeActions(options: { srcPath: string; range: Range }): Promise<CodeAction[]> {
        return this.sendStandardRequest<CodeAction[]>('getCodeActions', options);
    }

    public async getCompletions(options: { srcPath: string; position: Position }): Promise<CompletionList> {
        return this.sendStandardRequest<CompletionList>('getCompletions', options);
    }

    /**
     * Handles request/response/update messages from the worker thread
     */
    private messageHandler: MessageHandler<LspProject>;

    private processRequest(request: WorkerMessage) {

    }

    private processUpdate(update: WorkerMessage) {
        //for now, all updates are treated like "events"
        this.emit(update.name as any, update.data);
    }

    public on(eventName: 'critical-failure', handler: (data: { message: string }) => void);
    public on(eventName: 'diagnostics', handler: (data: { diagnostics: LspDiagnostic[] }) => MaybePromise<void>);
    public on(eventName: 'all', handler: (eventName: string, data: any) => MaybePromise<void>);
    public on(eventName: string, handler: (...args: any[]) => MaybePromise<void>) {
        this.emitter.on(eventName, handler as any);
        return () => {
            this.emitter.removeListener(eventName, handler as any);
        };
    }

    private emit(eventName: 'critical-failure', data: { message: string });
    private emit(eventName: 'diagnostics', data: { diagnostics: LspDiagnostic[] });
    private async emit(eventName: string, data?) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
        //emit the 'all' event
        this.emitter.emit('all', eventName, data);
    }
    private emitter = new EventEmitter();

    public disposables: LspProject['disposables'] = [];

    public dispose() {
        for (let disposable of this.disposables ?? []) {
            disposable?.dispose?.();
        }
        this.disposables = [];

        //move the worker back to the pool so it can be used again
        if (this.worker) {
            workerPool.releaseWorker(this.worker);
        }
        this.emitter?.removeAllListeners();
    }
}
