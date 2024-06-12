import * as EventEmitter from 'eventemitter3';
import type { MaybePromise } from '../interfaces';
import util from '../util';

/**
 * Maintains a queued/buffered list of file operations. These operations don't actually do anything on their own.
 * You need to call the .apply() function and provide an action to operate on them.
 */
export class DocumentManager {

    constructor(
        private options: {
            delay: number;
            flushHandler?: (event: FlushEvent) => Promise<void>;
        }) {
    }

    private queue = new Map<string, DocumentAction>();

    private timeoutHandle: NodeJS.Timeout;
    private throttle() {
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
        }
        this.timeoutHandle = setTimeout(() => {
            void this.flush();
        }, this.options.delay);
    }

    /**
     * Add/set the contents of a file
     */
    public set(options: { srcPath: string; fileContents?: string; allowStandaloneProject?: boolean }) {
        const srcPath = util.standardizePath(options.srcPath);
        if (this.queue.has(srcPath)) {
            this.queue.delete(srcPath);
        }
        this.queue.set(srcPath, {
            type: 'set',
            srcPath: srcPath,
            fileContents: options.fileContents,
            allowStandaloneProject: options.allowStandaloneProject ?? false
        });
        //schedule a future flush
        this.throttle();
    }

    /**
     * Delete a file or directory. If a directory is provided, all pending changes within that directory will be discarded
     * and only the delete action will be queued
     */
    public delete(srcPath: string) {
        srcPath = util.standardizePath(srcPath);
        //remove any pending action with this exact path
        this.queue.delete(srcPath);
        //we can't tell if this a directory, so just remove all pending changes for files that start with this path
        for (const key of this.queue.keys()) {
            if (key.startsWith(srcPath)) {
                this.queue.delete(key);
            }
        }
        //register this delete
        this.queue.set(srcPath, { type: 'delete', srcPath: srcPath });

        //schedule a future flush
        this.throttle();
    }

    private isFlushRunning = false;

    private async flush() {
        //if we're already running a flush, don't run another
        if (this.isFlushRunning) {
            return;
        }

        this.isFlushRunning = true;
        while (this.queue.size > 0) {
            try {
                const event: FlushEvent = {
                    actions: [...this.queue.values()]
                };
                await this.options.flushHandler?.(event);
                this.queue.clear();
            } catch (e) {
                console.error(e);
            }
        }
        this.emitSync('flush');
        this.isFlushRunning = false;
    }

    /**
     * Is the manager settled (i.e. no pending files, all files have been fully flushed)
     */
    public get isIdle() {
        return this.queue.size === 0 && this.isFlushRunning === false;
    }

    /**
     * Returns a promise that resolves when there are no pending files and no active flushes are running. Will immediately resolve if there are no files,
     * and will wait until files are flushed if there are files.
     */
    public async onIdle() {
        if (!this.isIdle) {
            await this.once('flush');
            return this.onIdle();
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

    private emitSync(eventName: 'flush');
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
    srcPath: string;
    type: 'set';
    allowStandaloneProject?: boolean;
    fileContents: string;
}
export interface DeleteDocumentAction {
    srcPath: string;
    type: 'delete';
    allowStandaloneProject?: boolean;
}

export type DocumentAction = SetDocumentAction | DeleteDocumentAction;
export type DocumentActionWithStatus = DocumentAction & { id: number; status: 'accepted' | 'rejected' };

export interface FlushEvent {
    actions: DocumentAction[];
}
