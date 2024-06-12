import type { CancellationToken } from 'vscode-languageserver-protocol';
import { CancellationTokenSource } from 'vscode-languageserver-protocol';
import { Deferred } from '../deferred';
import * as safeJsonStringify from 'safe-json-stringify';
import { EventEmitter } from 'eventemitter3';
import util from '../util';

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
     * @param action action to be run
     */
    public run<T = any>(action: Action<T>, data?: T) {
        const deferred = new Deferred();
        this.queue.push({
            action: action,
            data: data,
            deferred: deferred
        });
        void this.process();
        return deferred.promise;
    }

    private isRunning = false;

    /**
     * Process the next pending action. Safe to call even if another action is running, we will only run one action at a time
     */
    private async process() {
        if (this.isRunning) {
            return;
        }
        if (this.queue.length === 0) {
            this.emit('idle');
            return;
        }
        this.isRunning = true;

        //run the action and resolve the deferred if it succeeds
        const queueItem = this.queue.shift();
        const cancellationTokenSource = new CancellationTokenSource();

        //process the action next tick to allow the event loop to catch up
        let actionPromise = Promise.resolve().then(() => {
            return queueItem.action(queueItem.data, cancellationTokenSource.token);
        }).then((result) => {
            queueItem.deferred.resolve(result);
        });

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

        //small delay to allow the event loop to catch up
        await util.sleep(1);

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

    public get isIdle() {
        return this.queue.length === 0 && !this.isRunning;
    }

    /**
     * Get a promise that resolves when the queue is empty
     */
    public onIdle() {
        if (!this.isIdle) {
            return this.once('idle');
        }
        return Promise.resolve();
    }

    public once(eventname: 'idle'): Promise<void>;
    public once(eventName: string): Promise<void> {
        return new Promise<any>((resolve) => {
            const disconnect = this.on(eventName as Parameters<typeof this['on']>[0], (...args) => {
                disconnect();
                resolve(args);
            });
        });
    }

    public on(eventName: 'idle', handler: () => any);
    public on(eventName: string, handler: (payload: any) => any) {
        this.emitter.on(eventName, handler as any);
        return () => {
            this.emitter.removeListener(eventName, handler as any);
        };
    }

    private async emit(eventName: 'idle');
    private async emit(eventName: string, data?: any) {
        //emit these events on next tick, otherwise they will be processed immediately which could cause issues
        await util.sleep(0);
        this.emitter.emit(eventName, data);
    }
    private emitter = new EventEmitter();

    public dispose() {
        this.emitter.removeAllListeners();
    }
}

export type Action<T = any> = (data: T, cancellationToken?: CancellationToken) => any;

export interface ActionQueueOptions {
    /**
     * Max milliseconds an individual action may run before it's cancelled. This is the amount of time the action actually runs,
     * and does not count the time it waits in the queue
     */
    maxActionDuration: number;
}
