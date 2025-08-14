import * as parseMilliseconds from 'parse-ms';
import { performance } from 'perf_hooks';

export class Stopwatch {
    public totalMilliseconds = 0;
    /**
     * The number of milliseconds when the stopwatch was started.
     */
    private startTime: number | undefined;
    start() {
        this.startTime = performance.now();
    }
    stop() {
        if (this.startTime) {
            this.totalMilliseconds += performance.now() - this.startTime;
        }
        this.startTime = undefined;
    }
    reset() {
        this.totalMilliseconds = 0;
        this.startTime = undefined;
    }
    getDurationText() {
        let parts = parseMilliseconds(this.totalMilliseconds);
        let fractionalMilliseconds = parseInt(this.totalMilliseconds.toFixed(3).toString().split('.')[1]);
        if (parts.minutes > 0) {
            return `${parts.minutes}m${parts.seconds}s${parts.milliseconds}.${fractionalMilliseconds}ms`;
        } else if (parts.seconds > 0) {
            return `${parts.seconds}s${parts.milliseconds}.${fractionalMilliseconds}ms`;
        } else {
            return `${parts.milliseconds}.${fractionalMilliseconds}ms`;
        }
    }
}
