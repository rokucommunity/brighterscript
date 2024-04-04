import { EventEmitter } from 'eventemitter3';

/**
 * Tracks the busy/idle status of various sync or async tasks
 * Reports the overall status to the client
 */
export class BusyStatusTracker {
    /**
     * @readonly
     */
    public activeRuns = new Set<{
        label?: string;
        startTime?: Date;
    }>();

    private scopedRuns = new Map<any, any>();

    /**
     * Start a new piece of work
     */
    public run<T, R = T | Promise<T>>(callback: (finalize?: FinalizeBuildStatusRun) => R, label?: string): R {
        const run = {
            label: label,
            startTime: new Date()
        };
        this.activeRuns.add(run);

        if (this.activeRuns.size === 1) {
            this.emit('change', BusyStatus.busy);
        }

        let isFinalized = false;
        const finalizeRun = () => {
            if (isFinalized === false) {
                isFinalized = true;
                this.activeRuns.delete(run);
                if (this.activeRuns.size <= 0) {
                    this.emit('change', BusyStatus.idle);
                }
            }
        };

        let result: R | PromiseLike<R>;
        //call the callback function
        try {
            result = callback(finalizeRun);
            //if the result is a promise, don't finalize until it completes
            if (typeof (result as any)?.then === 'function') {
                return Promise.resolve(result).finally(finalizeRun).then(() => result) as any;
            } else {
                finalizeRun();
                return result;
            }
        } catch (e) {
            finalizeRun();
            throw e;
        }
    }

    private emitter = new EventEmitter<string, BusyStatus>();

    public on(eventName: 'change', handler: (status: BusyStatus) => void) {
        this.emitter.on(eventName, handler);
        return () => {
            this.emitter.off(eventName, handler);
        };
    }

    private emit(eventName: 'change', value: BusyStatus) {
        this.emitter.emit(eventName, value);
    }

    public destroy() {
        this.emitter.removeAllListeners();
    }

    /**
     * The current status of the busy tracker.
     * @readonly
     */
    public get status() {
        return this.activeRuns.size === 0 ? BusyStatus.idle : BusyStatus.busy;
    }
}

export type FinalizeBuildStatusRun = (status?: BusyStatus) => void;

export enum BusyStatus {
    busy = 'busy',
    idle = 'idle'
}
