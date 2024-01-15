import * as EventEmitter from 'eventemitter3';
import type { MaybePromise } from './LspProject';

/**
 * Maintains a queued/buffered list of file operations. These operations don't actually do anything on their own.
 * You need to call the .apply() function and provide an action to operate on them.
 */
export class DocumentManager {

    constructor(
        private options: { delay: number }) {
    }

    private queue = new Map<string, DocumentAction>();

    private timeoutHandle: NodeJS.Timeout;
    private throttle() {
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
        }
        this.timeoutHandle = setTimeout(() => {
            this.flush();
        }, this.options.delay);
    }

    /**
     * Add/set the contents of a file
     * @param document
     */
    public set(srcPath: string, fileContents: string) {
        if (this.queue.has(srcPath)) {
            this.queue.delete(srcPath);
        }
        this.queue.set(srcPath, {
            type: 'set',
            srcPath: srcPath,
            fileContents: fileContents
        });
        this.throttle();
    }

    /**
     * Delete a file
     * @param document
     */
    public delete(srcPath: string) {
        this.queue.delete(srcPath);
        this.queue.set(srcPath, { type: 'delete', srcPath: srcPath });
    }

    /**
     * Are there any pending documents that need to be flushed
     */
    public get hasPendingChanges() {
        return this.queue.size > 0;
    }

    private flush() {
        const event: FlushEvent = {
            actions: [...this.queue.values()]
        };
        this.queue.clear();

        this.emitSync('flush', event);
    }

    /**
     * Returns a promise that resolves when there are no pending files. Will immediately resolve if there are no files,
     * and will wait until files are flushed if there are files.
     */
    public async onSettle() {
        if (this.queue.size > 0) {
            await this.once('flush');
            return this.onSettle();
        }
    }

    public once(eventName: 'flush'): Promise<FlushEvent>;
    public once(eventName: string): Promise<any> {
        return new Promise((resolve) => {
            const off = this.on(eventName as any, (data) => {
                off();
                resolve(data);
            });
        });
    }

    public on(eventName: 'flush', handler: (data: any) => MaybePromise<void>);
    public on(eventName: string, handler: (...args: any[]) => MaybePromise<void>) {
        this.emitter.on(eventName, handler as any);
        return () => {
            this.emitter.removeListener(eventName, handler as any);
        };
    }

    private emitSync(eventName: 'flush', data: FlushEvent);
    private emitSync(eventName: string, data?) {
        this.emitter.emit(eventName, data);
    }

    private emitter = new EventEmitter();

    public dispose() {
        this.queue = new Map();
        this.emitter.removeAllListeners();
    }
}

export interface SetDocumentAction {
    type: 'set';
    srcPath: string;
    fileContents: string;
}
export interface DeleteDocumentAction {
    type: 'delete';
    srcPath: string;
}

export type DocumentAction = SetDocumentAction | DeleteDocumentAction;

export interface FlushEvent {
    actions: DocumentAction[];
}
