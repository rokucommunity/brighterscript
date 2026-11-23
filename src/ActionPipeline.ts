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
        this.process();
        return work.deferred.promise;
    }

    private process() {
        //if we're already processing,
        if (this.isProcessing) {
            return;
        }
        while (this.workQueue.length > 0) {
            const work = this.workQueue.shift();
            try {
                const result = Promise.resolve(
                    work.action()
                );
                work.deferred.resolve(result);
            } catch (e) {
                work.deferred.reject(e);
            }
        }
    }
    private isProcessing = false;
}

interface Work<T> {
    action: Action<T>;
    deferred: Deferred<T>;
}

export type Action<T> = () => T | PromiseLike<T>;
