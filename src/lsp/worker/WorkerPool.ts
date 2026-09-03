import { MessageChannel } from 'worker_threads';
import type { Worker, MessagePort } from 'worker_threads';
import { createLogger } from '../../logging';
import * as os from 'os';

interface WorkerEntry {
    worker: Worker;
    /**
     * How many projects currently have a MessagePort attached to this worker
     */
    projectCount: number;
    /**
     * True once the worker thread has exited. A dead entry is never handed out for new work and never
     * counts toward `maxWorkers`, but stays tracked until its remaining tenants release their slots,
     * so `releaseProject()` accounting stays correct for co-tenants of a crashed worker.
     */
    isDead?: boolean;
}

export class WorkerPool {
    constructor(
        private factory: () => Worker
    ) {

    }

    public logger = createLogger();

    /**
     * The maximum number of worker threads (i.e. separate V8 isolates) this pool will create.
     * Once this limit is reached, additional projects are multiplexed onto existing workers
     * (each project still gets its own dedicated MessagePort) instead of spawning new threads.
     */
    public maxWorkers = Math.max(1, os.cpus().length);

    /**
     * Every worker thread currently in the pool, along with how many projects are attached to it
     */
    private workers: WorkerEntry[] = [];

    /**
     * Create a new worker and add it to the pool
     */
    private createWorker(): WorkerEntry {
        const entry: WorkerEntry = {
            worker: this.factory(),
            projectCount: 0
        };
        this.workers.push(entry);
        //stop tracking a worker once it unexpectedly exits, so it can't be reused and doesn't consume a maxWorkers slot forever
        entry.worker.once('exit', () => this.removeWorker(entry.worker));
        return entry;
    }

    /**
     * Mark a worker as dead so it can't be reused and doesn't consume a `maxWorkers` slot. Does NOT terminate
     * the worker (it's assumed to already be gone, e.g. because it exited/crashed). The entry is only fully
     * untracked once no projects are attached to it, so surviving tenants can still release their slots.
     * Safe to call even if the worker is already untracked (e.g. because `releaseProject()` already removed
     * it as part of an intentional shutdown).
     */
    private removeWorker(worker: Worker) {
        const index = this.workers.findIndex(x => x.worker === worker);
        if (index > -1) {
            const entry = this.workers[index];
            entry.isDead = true;
            //nobody is attached anymore, so we can drop the entry entirely
            if (entry.projectCount <= 0) {
                this.workers.splice(index, 1);
            }
        }
    }

    /**
     * Find the worker entry with the fewest attached projects
     */
    private getLeastLoadedEntry(): WorkerEntry {
        const liveWorkers = this.getLiveWorkers();
        return liveWorkers.reduce(
            (least, current) => (current.projectCount < least.projectCount ? current : least),
            liveWorkers[0]
        );
    }

    /**
     * All workers that are still alive (i.e. eligible to host new projects)
     */
    private getLiveWorkers() {
        return this.workers.filter(x => !x.isDead);
    }

    /**
     * Ensure that there are at least `count` workers created in the pool
     * @param count the minimum number of workers that should exist when this function exits
     */
    public preload(count: number) {
        while (this.getLiveWorkers().length < Math.min(count, this.maxWorkers)) {
            this.createWorker();
        }
    }

    /**
     * Assign a new project to a worker thread. Prefers reusing an existing idle (zero-project) worker
     * (e.g. one created via `preload()`). If none is available and the pool hasn't yet reached `maxWorkers`,
     * a new worker is created for this project. Otherwise, the project is attached to the least-loaded
     * existing worker via its own dedicated `MessagePort`, so multiple projects can share a single worker
     * thread/isolate.
     * @returns the worker thread hosting this project, and the MessagePort dedicated to it
     */
    public assignProject(): { worker: Worker; port: MessagePort } {
        const liveWorkerCount = this.getLiveWorkers().length;
        let entry = this.workers.find(x => !x.isDead && x.projectCount === 0);
        if (!entry) {
            //the `=== 0` check guards against a nonsensical maxWorkers (0, negative, NaN) stranding the pool at zero workers
            if (liveWorkerCount === 0 || liveWorkerCount < this.maxWorkers) {
                this.logger.log('Creating new worker thread');
                entry = this.createWorker();
            } else {
                this.logger.log('Reusing existing worker thread');
                entry = this.getLeastLoadedEntry();
            }
        } else {
            this.logger.log('Reusing preloaded/idle worker thread');
        }
        entry.projectCount++;

        const { port1, port2 } = new MessageChannel();
        entry.worker.postMessage({ type: 'attachProject', port: port2 }, [port2]);
        return { worker: entry.worker, port: port1 };
    }

    /**
     * Release a project from its worker. If that worker has no more attached projects, it is
     * terminated and removed from the pool so its memory can be reclaimed.
     * @param worker the worker the project was assigned to (from `assignProject()`)
     */
    public releaseProject(worker: Worker) {
        const index = this.workers.findIndex(x => x.worker === worker);
        if (index === -1) {
            return;
        }
        const entry = this.workers[index];
        entry.projectCount--;
        if (entry.projectCount <= 0) {
            this.workers.splice(index, 1);
            //an already-exited worker needs no termination
            if (!entry.isDead) {
                this.terminateWorker(worker);
            }
        }
    }

    private terminateWorker(worker: Worker) {
        try {
            Promise.resolve(worker.terminate()).catch(e => console.error(e));
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * Shut down all active worker pools
     */
    public dispose() {
        for (const entry of this.workers) {
            this.terminateWorker(entry.worker);
        }
        this.workers = [];
    }
}
