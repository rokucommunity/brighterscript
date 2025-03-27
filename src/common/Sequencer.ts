import type { CancellationToken } from 'vscode-languageserver-protocol';
import { util } from '../util';
import { EventEmitter } from 'eventemitter3';
import * as parseMilliseconds from 'parse-ms';

/**
 * Supports running a series of actions in sequence, either synchronously or asynchronously
 * @private
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
    private actions: Array<{
        /**
         * Label for this action. Is used for logging and metrics
         */
        label: string;
        /**
         * If this action is a member of a group (i.e. forEach calls), this is the label for the group which will be logged in addition to the label
         */
        groupLabel?: string;
        args: any[];
        func: (...args: any[]) => any;
    }> = [];

    public forEach<T>(label: string, itemsOrFactory: Iterable<T> | (() => Iterable<T>), func: (item: T) => any) {
        //register a single action for now, we will fetch the full list and register their actions later
        const primaryAction = {
            args: [],
            label: label,
            func: (data) => {
                const items = typeof itemsOrFactory === 'function' ? itemsOrFactory() : itemsOrFactory;
                const actions: Sequencer['actions'] = [];
                let i = 0;
                for (const item of items) {
                    actions.push({
                        label: label + `[${i++}]`,
                        groupLabel: label,
                        args: [item],
                        func: func
                    });
                }
                let primaryActionIndex = this.actions.indexOf(primaryAction);
                //insert all of these item actions immediately after this action
                this.actions.splice(primaryActionIndex + 1, 0, ...actions);
            }
        };
        this.actions.push(primaryAction);
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

    public once(label: string, func: () => any) {
        this.actions.push({
            args: [],
            func: func,
            label: label
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

                await this.runActionAsync(action);

                //if the cancellation token has asked us to cancel, then stop processing now
                if (this.options?.cancellationToken?.isCancellationRequested) {
                    return this.handleCancel();
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

    public runSync() {
        try {
            for (const action of this.actions) {
                //if the cancellation token has asked us to cancel, then stop processing now
                if (this.options?.cancellationToken?.isCancellationRequested) {
                    return this.handleCancel();
                }

                const result = this.runActionSync(action);

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

    private async runActionAsync<T>(action: typeof this.actions[0]): Promise<T> {
        //record the start time for this action
        let perfBefore = performance.now();
        try {
            return await Promise.resolve(
                action.func(...action.args)
            );
        } finally {
            let perfAfter = performance.now();
            this.incrementMetric(action.label, perfAfter - perfBefore, 1, !!action.groupLabel);
            if (action.groupLabel) {
                this.incrementMetric(action.groupLabel, perfAfter - perfBefore, 1);
            }
        }
    }

    private runActionSync<T>(action: typeof this.actions[0]) {
        //record the start time for this action
        let perfBefore = performance.now();
        try {
            return action.func(...action.args);
        } finally {
            let perfAfter = performance.now();
            this.incrementMetric(action.label, perfAfter - perfBefore, 1, !!action.groupLabel);
            if (action.groupLabel) {
                this.incrementMetric(action.groupLabel, perfAfter - perfBefore, 1);
            }
        }
    }

    /**
     * An object that collects timing information for our actions
     */
    public metrics = new Map<string, {
        duration: number;
        callCount: number;
        isLoopIteration: boolean;
    }>();

    /**
     * Get all the metrics in a text-based format (useful for logging)
     */
    public formatMetrics(options: { header: string; includeLoopIterations: boolean }) {
        let results: Array<{ label: string; durationText: string; callText: string }> = [];
        let total = 0;
        for (const [label, metric] of this.metrics) {
            //skip loop iterations if options say they should be skipped
            if (metric.isLoopIteration && options?.includeLoopIterations !== true) {
                continue;
            }
            //sum all the non-loop iterations (i.e. the one-off runs or grouped loop runs).
            //this represents the total time spend running these tasks
            if (!metric.isLoopIteration) {
                total += metric.duration;
            }
            results.push({
                label: label,
                durationText: this.getDurationText(metric.duration),
                callText: `${metric.callCount} calls`
            });
        }

        let maxLabelLength = Math.max(...results.map(x => x.label.length));
        let maxCallTextLength = Math.max(...results.map(x => x.callText.length));
        let maxDurationLength = Math.max(...results.map(x => x.durationText.length));

        results.push(
            {
                label: 'Total',
                durationText: this.getDurationText(total),
                callText: ''
            }
        );

        return (options?.header ? options.header + '\n' : '') +
            results.map(x => [
                '    ' + (x.label ?? '').padEnd(maxLabelLength + 2, '-') +
                (' ' + (x.durationText ?? '')).padStart(maxDurationLength + 2, '-') + ', ' +
                (x.callText ?? '').padStart(maxCallTextLength, ' ')
            ].join(', ')).join('\n');

    }

    private getDurationText(duration: number) {
        let parts = parseMilliseconds(duration);
        let fractionalMilliseconds = parseInt(duration.toFixed(3).toString().split('.')[1]);
        let result = `${parts.minutes}m${parts.seconds.toString().padStart(2, '0')}s${parts.milliseconds.toString().padStart(3, '0')}.${fractionalMilliseconds.toString().padStart(3, '0')}ms`;
        //remove leading zeros for minutes and seconds
        result = result.replace(/^0+m/, '').replace(/^0+s/, '');
        return result;
    }

    /**
     * Bump the metric for the given key by the given duration and call count
     * @param label the label of the action to have its metric incremented
     * @param duration the amount of new duration to add to the existing duration
     * @param callCount the amount of new calls to add to the existing call count
     */
    private incrementMetric(label: string, duration: number, callCount: number, isLoopIteration = false) {
        let metric = this.metrics.get(label);
        if (!metric) {
            metric = {
                duration: 0,
                callCount: 0,
                isLoopIteration: false
            };
            this.metrics.set(label, metric);
        }
        metric.duration += duration;
        metric.callCount += callCount;
        metric.isLoopIteration = isLoopIteration;
    }


    private handleCancel() {
        console.log(`Cancelling sequence ${this.options?.name}`);
        this.emitter.emit('cancel');
    }

    private dispose() {
        this.emitter.removeAllListeners();
    }
}
