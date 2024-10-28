import { EventEmitter } from 'eventemitter3';
import { Deferred } from './deferred';

interface RunInfo<T> {
    label: string;
    startTime: Date;
    scope?: T;
    deferred?: Deferred;
}

/**
 * Tracks the busy/idle status of various sync or async tasks
 * Reports the overall status to the client
 */
export class BusyStatusTracker<T = any> {
    /**
     * @readonly
     */
    public activeRuns: Array<RunInfo<T>> = [];

    /**
     * Begin a busy task. It's expected you will call `endScopeRun` when the task is complete.
     * @param scope an object used for reference as to what is doing the work. Can be used to bulk-cancel all runs for a given scope.
     * @param label  label for the run. This is required for the `endScopedRun` method to know what to end.
     */
    public beginScopedRun(scope: T, label: string) {
        const deferred = new Deferred();

        const runInfo = {
            label: label,
            startTime: new Date(),
            deferred: deferred,
            scope: scope
        };

        void this._run(runInfo, () => {
            //don't mark the busy run as completed until the deferred is resolved
            return deferred.promise;
        });
    }

    /**
     * End the earliest run for the given scope and label
     * @param scope an object used for reference as to what is doing the work. Can be used to bulk-cancel all runs for a given scope.
     * @param label label for the run
     */
    public endScopedRun(scope: T, label: string) {
        const earliestRunIndex = this.activeRuns.findIndex(x => x.scope === scope && x.label === label);
        if (earliestRunIndex === -1) {
            return;
        }
        const earliestRun = this.activeRuns[earliestRunIndex];
        this.activeRuns.splice(earliestRunIndex, 1);
        earliestRun.deferred.resolve();
        return earliestRun.deferred.promise;
    }

    /**
     * End all runs for a given scope. This is typically used when the scope is destroyed, and we want to make sure all runs are cleaned up.
     * @param scope an object used for reference as to what is doing the work.
     */
    public endAllRunsForScope(scope: T) {
        for (let i = this.activeRuns.length - 1; i >= 0; i--) {
            const activeRun = this.activeRuns[i];
            if (activeRun.scope === scope) {
                //delete the active run
                this.activeRuns.splice(i, 1);
                //mark the run as resolved
                activeRun.deferred.resolve();
            }
        }
    }

    /**
     * Start a new piece of work
     */
    public run<A, R = A | Promise<A>>(callback: (finalize?: FinalizeBuildStatusRun) => R, label?: string): R {
        const run = {
            label: label,
            startTime: new Date()
        };
        return this._run<A, R>(run, callback);
    }

    private _run<A, R = A | Promise<A>>(runInfo: RunInfo<T>, callback: (finalize?: FinalizeBuildStatusRun) => R, label?: string): R {
        this.activeRuns.push(runInfo);

        if (this.activeRuns.length === 1) {
            this.emit('change', BusyStatus.busy);
        }
        this.emit('active-runs-change', { activeRuns: [...this.activeRuns] });

        let isFinalized = false;
        const finalizeRun = () => {
            if (isFinalized === false) {
                isFinalized = true;

                this.emit('active-runs-change', { activeRuns: [...this.activeRuns] });

                let idx = this.activeRuns.indexOf(runInfo);
                if (idx > -1) {
                    this.activeRuns.splice(idx, 1);
                }
                if (this.activeRuns.length <= 0) {
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

    public once(eventName: 'active-runs-change'): Promise<{ activeRuns: Array<RunInfo<T>> }>;
    public once(eventName: 'change'): Promise<BusyStatus>;
    public once<T>(eventName: string): Promise<T> {
        return new Promise<T>((resolve) => {
            const off = this.on(eventName as any, (data) => {
                off();
                resolve(data as any);
            });
        });
    }

    public on(eventName: 'active-runs-change', handler: (event: { activeRuns: Array<RunInfo<T>> }) => void);
    public on(eventName: 'change', handler: (status: BusyStatus) => void);
    public on(eventName: string, handler: (event: any) => void) {
        this.emitter.on(eventName, handler);
        return () => {
            this.emitter.off(eventName, handler);
        };
    }

    private emit(eventName: 'active-runs-change', event: { activeRuns: Array<RunInfo<T>> });
    private emit(eventName: 'change', status: BusyStatus);
    private emit(eventName: string, event: any) {
        this.emitter.emit(eventName, event);
    }

    public destroy() {
        this.emitter.removeAllListeners();
    }

    /**
     * The current status of the busy tracker.
     * @readonly
     */
    public get status() {
        return this.activeRuns.length === 0 ? BusyStatus.idle : BusyStatus.busy;
    }
}

export type FinalizeBuildStatusRun = (status?: BusyStatus) => void;

export enum BusyStatus {
    busy = 'busy',
    idle = 'idle'
}
