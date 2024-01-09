import * as EventEmitter from 'eventemitter3';
import { Worker } from 'worker_threads';
import type { WorkerMessage } from './MessageHandler';
import { MessageHandler } from './MessageHandler';
import util from '../../util';
import type { LspDiagnostic, MaybePromise } from '../LspProject';
import { type ActivateOptions, type LspProject } from '../LspProject';
import { isMainThread, parentPort } from 'worker_threads';
import { WorkerThreadProjectRunner } from './WorkerThreadProjectRunner';
import { WorkerPool } from './WorkerPool';
import type { SemanticToken } from '../../interfaces';
import type { BsConfig } from '../../BsConfig';

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

//if this script us running in a Worker, run
/* istanbul ignore next */
if (!isMainThread) {
    const runner = new WorkerThreadProjectRunner();
    runner.run(parentPort);
}

export class WorkerThreadProject implements LspProject {

    public async activate(options: ActivateOptions) {
        this.projectPath = options.projectPath;
        this.workspaceFolder = options.workspaceFolder;
        this.projectNumber = options.projectNumber;
        this.configFilePath = options.configFilePath;

        // start a new worker thread or get an unused existing thread
        this.worker = workerPool.getWorker();
        this.messageHandler = new MessageHandler<LspProject>({
            name: 'MainThread',
            port: this.worker,
            onRequest: this.processRequest.bind(this),
            onUpdate: this.processUpdate.bind(this)
        });

        await this.messageHandler.sendRequest('activate', { data: [options] });

        //populate a few properties with data from the thread so we can use them for some synchronous checks
        this.filePaths = await this.getFilePaths();
        this.options = await this.getOptions();
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
     * A local copy of all the file paths loaded in this program. This needs to stay in sync with any files we add/delete in the worker thread,
     * so we can keep doing in-process `.hasFile()` checks
     */
    private filePaths: string[];

    public async getDiagnostics() {
        const response = await this.messageHandler.sendRequest<LspDiagnostic[]>('getDiagnostics');
        return response.data;
    }

    /**
     * Does this project have the specified file. Should only be called after `.activate()` has finished/
     */
    public hasFile(srcPath: string) {
        return this.filePaths.includes(srcPath);
    }

    /**
     * Set new contents for a file. This is safe to call any time. Changes will be queued and flushed at the correct times
     * during the program's lifecycle flow
     * @param srcPath absolute source path of the file
     * @param fileContents the text contents of the file
     */
    public async setFile(srcPath: string, fileContents: string) {
        const response = await this.messageHandler.sendRequest<void>('setFile', {
            data: [srcPath, fileContents]
        });
        return response.data;
    }

    /**
     * Remove the in-memory file at the specified path. This is typically called when the user (or file system watcher) triggers a file delete
     * @param srcPath absolute path to the file
     */
    public async removeFile(srcPath: string) {
        const response = await this.messageHandler.sendRequest<void>('removeFile', {
            data: [srcPath]
        });
        return response.data;
    }

    /**
     * Get the list of all file paths that are currently loaded in the project
     */
    public async getFilePaths() {
        return (await this.messageHandler.sendRequest<string[]>('getFilePaths')).data;
    }

    /**
     * Get the bsconfig options from the program. Should only be called after `.activate()` has completed.
     */
    public async getOptions() {
        return (await this.messageHandler.sendRequest<BsConfig>('getOptions')).data;
    }

    /**
     * A local reference to the bsconfig this project was built with. Should only be accessed after `.activate()` has completed.
     */
    private options: BsConfig;

    public get rootDir() {
        return this.options.rootDir;
    }

    /**
     * Get the full list of semantic tokens for the given file path
     * @param srcPath absolute path to the source file
     */
    public async getSemanticTokens(srcPath: string) {
        const response = await this.messageHandler.sendRequest<SemanticToken[]>('getSemanticTokens');
        return response.data;
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
     * Path to a bsconfig.json file that will be used for this project
     */
    public configFilePath?: string;

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

    public dispose() {
        //move the worker back to the pool so it can be used again
        if (this.worker) {
            workerPool.releaseWorker(this.worker);
        }
        this.messageHandler.dispose();
        this.emitter.removeAllListeners();
    }
}
