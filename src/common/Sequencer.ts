import type { CancellationToken } from 'vscode-languageserver-protocol';
import { util } from '../util';
import { EventEmitter } from 'eventemitter3';

/**
 * Supports running a series of actions in sequence, either synchronously or asynchronously
 */
export class Sequencer {
    constructor(
        private options?: {
            name?: string;
            cancellationToken?: CancellationToken;
            /**
             * The number of operations to run before registering a nexttick
             */
            minSyncDuration?: number;
        }
    ) {

    }

    private get minSyncDuration() {
        return this.options?.minSyncDuration ?? 150;
    }

    // eslint-disable-next-line @typescript-eslint/ban-types
    private actions: Array<{ args: any[]; func: Function }> = [];

    public forEach<T>(items: T[], func: (item: T) => any) {
        for (const item of items) {
            this.actions.push({
                args: [item],
                func: func
            });
        }
        return this;
    }

    private emitter = new EventEmitter();

    public onCancel(callback: () => void) {
        this.emitter.on('cancel', callback);
        return this;
    }

    public onComplete(callback: () => void) {
        this.emitter.on('complete', callback);
        return this;
    }

    public onSuccess(callback: () => void) {
        this.emitter.on('success', callback);
        return this;
    }

    public once(func: () => any) {
        this.actions.push({
            args: [],
            func: func
        });
        return this;
    }

    public async run() {
        try {
            let start = Date.now();
            for (const action of this.actions) {
                //register a very short timeout between every action so we don't hog the CPU
                if (Date.now() - start > this.minSyncDuration) {
                    await util.sleep(1);
                    start = Date.now();
                }

                //if the cancellation token has asked us to cancel, then stop processing now
                if (this.options?.cancellationToken?.isCancellationRequested) {
                    return this.handleCancel();
                }
                await Promise.resolve(
                    action.func(...action.args)
                );
            }
            this.emitter.emit('success');
        } catch (e) {
            this.handleCancel();
            throw e;
        } finally {
            this.emitter.emit('complete');
            this.dispose();
        }
    }

    public runSync() {
        try {
            for (const action of this.actions) {
                //if the cancellation token has asked us to cancel, then stop processing now
                if (this.options?.cancellationToken?.isCancellationRequested) {
                    return this.handleCancel();
                }
                const result = action.func(...action.args);
                if (typeof result?.then === 'function') {
                    throw new Error(`Action returned a promise which is unsupported when running 'runSync'`);
                }
            }
            this.emitter.emit('success');
        } catch (e) {
            this.handleCancel();
            throw e;
        } finally {
            this.emitter.emit('complete');
            this.dispose();
        }
    }

    private handleCancel() {
        console.log(`Cancelling sequence ${this.options?.name}`);
        this.emitter.emit('cancel');
    }

    private dispose() {
        this.emitter.removeAllListeners();
    }
}
