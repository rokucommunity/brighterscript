import * as EventEmitter from 'eventemitter3';
import { Worker } from 'worker_threads';
import type { WorkerMessage } from './MessageHandler';
import { MessageHandler } from './MessageHandler';
import util from '../../util';
import type { LspDiagnostic } from '../LspProject';
import { type ActivateOptions, type LspProject } from '../LspProject';
import { isMainThread, parentPort } from 'worker_threads';
import { WorkerThreadProjectRunner } from './WorkerThreadProjectRunner';
import type { Project } from '../Project';
import { WorkerPool } from './WorkerPool';

export const workerPool = new WorkerPool(() => {
    return new Worker(
        __filename,
        {
            //wire up ts-node if we're running in ts-node
            execArgv: /\.ts$/i.test(__filename) ? ['--require', 'ts-node/register'] : undefined
        }
    );
});

//if this script us running in a Worker, run
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
        this.messageHandler = new MessageHandler({
            name: 'MainThread',
            port: this.worker,
            onRequest: this.processRequest.bind(this),
            onUpdate: this.processUpdate.bind(this)
        });
        await this.messageHandler.sendRequest('activate', { data: [options] });
    }

    public async getDiagnostics() {
        const diagnostics = await this.messageHandler.sendRequest<LspDiagnostic[]>('getDiagnostics');
        return diagnostics.data;
    }

    public dispose() {
        //restore the worker back to the worker pool so it can be used again
        if (this.worker) {
            workerPool.releaseWorker(this.worker);
        }
        this.messageHandler.dispose();
        this.emitter.removeAllListeners();
    }

    /**
     * Handles request/response/update messages from the worker thread
     */
    private messageHandler: MessageHandler;

    private processRequest(request: WorkerMessage) {

    }

    private processUpdate(update: WorkerMessage) {

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

    public on(eventName: 'critical-failure', handler: (data: { project: Project; message: string }) => void);
    public on(eventName: 'flush-diagnostics', handler: (data: { project: Project }) => void);
    public on(eventName: string, handler: (payload: any) => void) {
        this.emitter.on(eventName, handler);
        return () => {
            this.emitter.removeListener(eventName, handler);
        };
    }

    private emit(eventName: 'critical-failure', data: { project: Project; message: string });
    private emit(eventName: 'flush-diagnostics', data: { project: Project });
    private async emit(eventName: string, data?) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
    }
    private emitter = new EventEmitter();
}
