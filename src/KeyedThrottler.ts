import { Throttler } from './Throttler';

export class KeyedThrottler {
    constructor(
        readonly delay: number
    ) {

    }

    private throttlers = {} as Record<string, Throttler>;

    /**
     * Run the job for the specified key
     */
    public run(key: string, job: any) {
        if (!this.throttlers[key]) {
            this.throttlers[key] = new Throttler(this.delay);
        }
        return this.throttlers[key].run(job);
    }

    /**
    * Get a promise that resolves the next time the throttler becomes idle.
    * If no throttler exists, this will resolve immediately
    */
    public async onIdleOnce(key: string, resolveImmediatelyIfIdle = true) {
        const throttler = this.throttlers[key];
        if (throttler) {
            return throttler.onIdleOnce(true);
        } else {
            return Promise.resolve();
        }
    }
}
