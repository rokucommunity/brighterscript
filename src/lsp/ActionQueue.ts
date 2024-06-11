import { CancellationToken, CancellationTokenSource } from "vscode-languageserver-protocol";
import { Deferred } from "../deferred";
import * as safeJsonStringify from 'safe-json-stringify';

export class ActionQueue {

    public constructor(
        options?: ActionQueueOptions
    ) {
        this.options = options ?? {} as any;
        this.options.maxActionDuration ??= 2_147_483_647;
    }

    public options: ActionQueueOptions;

    private queue: Array<{
        /**
         * An action to run
         */
        action: Action;
        /**
         * Data to be passed to the action
         */
        data: any;
        /**
         * A deferred to resolve when the action is complete.
         * @default Number.MAX_SAFE_INTEGER
         */
        deferred: Deferred<any>;
    }> = [];

    /**
     * Run an action. This will run after all previous actions have completed
     * @param data data to be passed to the action. We collect this so we can log this data if this action takes too long (helpful for debugging)
     * @param action action to be run
     * @returns
     */
    public run<T = any>(action: Action<T>, data?: T) {
        const deferred = new Deferred();
        this.queue.push({
            action: action,
            data: data,
            deferred: deferred
        });
        this.process();
        return deferred.promise;
    }

    private isRunning = false;

    /**
     * Process the next pending action. Safe to call even if another action is running, we will only run one action at a time
     * @returns
     */
    private async process() {
        if (this.isRunning) {
            return;
        }
        if (this.queue.length === 0) {
            return;
        }
        this.isRunning = true;

        //run the action and resolve the deferred if it succeeds
        const queueItem = this.queue.shift();
        const cancellationTokenSource = new CancellationTokenSource();

        let actionPromise = Promise.resolve().then(() => {
            return queueItem.action(queueItem.data, cancellationTokenSource.token);
        }).then((result) => {
            queueItem.deferred.resolve(result);
        })

        //register a timeout that will reject if the action takes too long
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                cancellationTokenSource.cancel();
                reject(
                    new Error(`Action took longer than ${this.options.maxActionDuration}ms to complete. Data: ${this.stringifyJson(queueItem.data)}`)
                );
            }, this.options.maxActionDuration);
        });

        //wait for the action to finish or the timeout to trigger
        await Promise.race([timeoutPromise, actionPromise]).catch((error) => {
            //if we have an error, reject the deferred
            queueItem.deferred.tryReject(error);
        });

        clearTimeout(timeoutId);

        this.isRunning = false;

        //at this point, we've properly handled the action, so try and handle the next one
        await this.process();
    }

    private stringifyJson(data: any) {
        return safeJsonStringify(
            data,
            (_, value) => {
                return typeof value === 'bigint' ? value.toString() : value;
            }
        );
    }
}

export type Action<T = any> = (data: T, cancellationToken?: CancellationToken) => (Promise<any> | any)

export interface ActionQueueOptions {
    /**
     * Max milliseconds an individual action may run before it's cancelled. This is the amount of time the action actually runs,
     * and does not count the time it waits in the queue
     */
    maxActionDuration: number;
}
