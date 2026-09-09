import { Deferred } from './deferred';

/**
 * Enforces that a single action can be running at a time
 */
export class ActionPipeline {
    private workQueue: Array<Work<any>> = [];

    public run<T extends Action<any>, R extends Awaited<PromiseLike<ReturnType<T>>>>(action: T): Promise<R> {
        const work = {
            action: action,
            deferred: new Deferred<any>()
        };
        this.workQueue.push(work);
        //the queue drains in the background; callers await their own work's promise instead
        void this.process();
        return work.deferred.promise;
    }

    private async process() {
        //if we're already processing, the in-flight loop will pick up the work we just enqueued
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;
        try {
            while (this.workQueue.length > 0) {
                const work = this.workQueue.shift();
                try {
                    //await the action so the next item doesn't start until this one has fully settled
                    work.deferred.resolve(
                        await work.action()
                    );
                } catch (e) {
                    work.deferred.reject(e);
                }
            }
        } finally {
            this.isProcessing = false;
        }
    }
    private isProcessing = false;
}

interface Work<T> {
    action: Action<T>;
    deferred: Deferred<T>;
}

export type Action<T> = () => T | PromiseLike<T>;
