import * as EventEmitter from 'eventemitter3';
import { Worker } from 'worker_threads';
import type { WorkerMessage } from './MessageHandler';
import { MessageHandler } from './MessageHandler';
import util from '../../util';
import type { LspDiagnostic } from '../LspProject';
import { type ActivateOptions, type LspProject } from '../LspProject';
import { isMainThread, parentPort, workerData } from 'worker_threads';
import { WorkerThreadProjectRunner } from './WorkerThreadProjectRunner';
import type { Project } from '../Project';

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

        //start the worker thread
        this.worker = new Worker(
            __filename,
            {
                ...options,
                //wire up ts-node if we're running in ts-node
                execArgv: /\.ts$/i.test(__filename) ? ['--require', 'ts-node/register'] : undefined
            }
        );
        this.messageHandler = new MessageHandler({
            port: this.worker,
            onRequest: this.processRequest.bind(this),
            onUpdate: this.processUpdate.bind(this)
        });

        await this.messageHandler.sendRequest('activate');
    }

    public async getDiagnostics() {
        const diagnostics = await this.messageHandler.sendRequest<LspDiagnostic[]>('getDiagnostics');
        return diagnostics.data;
    }

    public dispose() {
        //terminate the worker thread. we don't need to wait for it since this is immediate
        this.worker.terminate();
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
