import type { Worker } from 'worker_threads';
import { createLogger } from '../../logging';

export class WorkerPool {
    constructor(
        private factory: () => Worker
    ) {

    }

    public logger = createLogger();

    /**
     * List of workers that are free to be used by a new task
     */
    private freeWorkers: Worker[] = [];
    /**
     * List of all workers that we've ever created
     */
    private allWorkers: Worker[] = [];

    /**
     * Ensure that there are ${count} workers available in the pool
     * @param count the number of total free workers that should exist when this function exits
     */
    public preload(count: number) {
        while (this.freeWorkers.length < count) {
            this.freeWorkers.push(
                this.createWorker()
            );
        }
    }

    /**
     * Create a new worker
     */
    private createWorker() {
        const worker = this.factory();
        this.allWorkers.push(worker);
        return worker;
    }

    /**
     * Get a worker from the pool, or create a new one if none are available
     * @returns a worker
     */
    public getWorker() {
        //we have no free workers. spin up a new one
        if (this.freeWorkers.length === 0) {
            this.logger.log('Creating new worker thread');
            return this.createWorker();
        } else {
            //return an existing free worker
            this.logger.log('Reusing existing worker thread');
            return this.freeWorkers.pop();
        }
    }

    /**
     * Give the worker back to the pool so it can be used by someone else
     * @param worker the worker
     */
    public releaseWorker(worker: Worker) {
        //add this worker back to the free workers list (if it's not already in there)
        if (!this.freeWorkers.includes(worker)) {
            this.freeWorkers.push(worker);
        }
    }

    /**
     * Shut down all active worker pools
     */
    public dispose() {
        for (const worker of this.allWorkers) {
            try {
                worker.terminate();
            } catch (e) {
                console.error(e);
            }
        }
        this.allWorkers = [];
        this.freeWorkers = [];
    }
}
