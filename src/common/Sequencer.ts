import type { CancellationToken } from 'vscode-languageserver-protocol';
import { util } from '../util';
import { EventEmitter } from 'eventemitter3';

/**
 * Supports running a series of actions in sequence, either synchronously or asynchronously
 */
export class Sequencer {
    constructor(
        private options: {
            name: string;
            async?: boolean;
            cancellationToken?: CancellationToken;
        }
    ) {

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

    /**
     * Actually run the sequence
     */
    public run() {
        if (this.options?.async) {
            return this.runAsync();
        } else {
            return this.runSync();
        }
    }

    private async runAsync() {
        try {
            for (const action of this.actions) {
                //register a very short timeout between every action so we don't hog the CPU
                await util.sleep(1);

                //if the cancellation token has asked us to cancel, then stop processing now
                if (this.options.cancellationToken?.isCancellationRequested) {
                    return this.handleCancel();
                }
                action.func(...action.args);
            }
            this.emitter.emit('success');
        } finally {
            this.emitter.emit('complete');
            this.dispose();
        }
    }

    private runSync() {
        try {
            for (const action of this.actions) {
                //if the cancellation token has asked us to cancel, then stop processing now
                if (this.options.cancellationToken.isCancellationRequested) {
                    return this.handleCancel();
                }
                action.func(...action.args);
            }
            this.emitter.emit('success');
        } finally {
            this.emitter.emit('complete');
            this.dispose();
        }
    }

    private handleCancel() {
        console.log(`Cancelling sequence ${this.options.name}`);
        this.emitter.emit('cancel');
    }

    private dispose() {
        this.emitter.removeAllListeners();
    }
}
