import { EventEmitter } from 'eventemitter3';
import { Deferred } from './deferred';

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

    /**
     * Collection to track scoped runs. All runs represented here also have a corresponding entry in `activeRuns`
     */
    private scopedRuns = new Map<any, Array<{
        label: string;
        deferred: Deferred;
    }>>();

    /**
     * Begin a busy task. It's expected you will call `endScopeRun` when the task is complete.
     * @param scope an object used for reference as to what is doing the work. Can be used to bulk-cancel all runs for a given scope.
     * @param label  label for the run. This is required for the `endScopedRun` method to know what to end.
     */
    public beginScopedRun(scope: any, label: string) {
        let runsForScope = this.scopedRuns.get(scope);
        if (!runsForScope) {
            runsForScope = [];
            this.scopedRuns.set(scope, runsForScope);
        }

        const deferred = new Deferred();

        void this.run(() => {
            //don't mark the busy run as completed until the deferred is resolved
            return deferred.promise;
        }, label);

        runsForScope.push({
            label: label,
            deferred: deferred
        });
    }

    /**
     * End the earliest run for the given scope and label
     * @param scope an object used for reference as to what is doing the work. Can be used to bulk-cancel all runs for a given scope.
     * @param label label for the run
     */
    public endScopedRun(scope: any, label: string) {
        const runsForScope = this.scopedRuns.get(scope);
        if (!runsForScope) {
            return;
        }
        const earliestRunIndex = runsForScope.findIndex(x => x.label === label);
        if (earliestRunIndex === -1) {
            return;
        }
        const earliestRun = runsForScope[earliestRunIndex];
        runsForScope.splice(earliestRunIndex, 1);
        earliestRun.deferred.resolve();
        return earliestRun.deferred.promise;
    }

    /**
     * End all runs for a given scope. This is typically used when the scope is destroyed, and we want to make sure all runs are cleaned up.
     * @param scope an object used for reference as to what is doing the work.
     */
    public endAllRunsForScope(scope: any) {
        const runsForScope = this.scopedRuns.get(scope);
        if (!runsForScope) {
            return;
        }
        for (const run of runsForScope) {
            run.deferred.resolve();
        }
        this.scopedRuns.delete(scope);
    }

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

    public once(eventName: 'change'): Promise<BusyStatus>;
    public once<T>(eventName: string): Promise<T> {
        return new Promise<T>((resolve) => {
            const off = this.on(eventName as any, (data) => {
                off();
                resolve(data as any);
            });
        });
    }

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
