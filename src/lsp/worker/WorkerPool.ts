import type { Worker } from 'worker_threads';

export class WorkerPool {
    constructor(
        private factory: () => Worker
    ) {

    }

    private workers: Worker[] = [];

    /**
     * Ensure that there are ${count} workers available in the pool
     * @param count
     */
    public preload(count: number) {
        while (this.workers.length < count) {
            this.workers.push(
                this.getWorker()
            );
        }
    }

    /**
     * Get a worker from the pool, or create a new one if none are available
     * @returns a worker
     */
    public getWorker() {
        return this.workers.pop() ?? this.factory();
    }

    /**
     * Give the worker back to the pool so it can be used by someone else
     * @param worker the worker
     */
    public releaseWorker(worker: Worker) {
        this.workers.push(worker);
    }

    /**
     * Shut down all active worker pools
     */
    public dispose() {
        for (const worker of this.workers) {
            worker.terminate();
        }
    }
}
