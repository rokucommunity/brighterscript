export class TaskThrottler {

    private runningJob: Promise<void> = null;
    private pendingRequest = false;

    public onIdle: () => void;

    /**
     * Set up a single job runner, ignoring extra requests to re-run the job
     * @param job async task to run
     * @param delay quiet period
     */
    public constructor(private job: () => Promise<void>, private delay: number = 0) {
    }

    public run() {
        // ignore requests while a job is running
        if (this.runningJob !== null) {
            this.pendingRequest = true;
            return;
        }
        // start job
        this.pendingRequest = false;
        this.runningJob = this.runJob();
        // on completion, re-run if there were extra requests
        this.runningJob.then(() => this.nextJob(), () => this.nextJob());
    }

    private nextJob() {
        this.runningJob = null;
        if (this.pendingRequest) {
            this.run();
        } else if (this.onIdle) {
            this.onIdle();
        }
    }

    private runJob(): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(this.job());
            }, this.delay);
        });
    }
}
