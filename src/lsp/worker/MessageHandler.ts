import type { MessagePort, parentPort } from 'worker_threads';
import * as EventEmitter from 'eventemitter3';
import type { DisposableLike } from '../../interfaces';
import util from '../../util';

interface PseudoMessagePort {
    on: (name: 'message', cb: (message: any) => any) => any;
    postMessage: typeof parentPort['postMessage'];
}

export class MessageHandler<T, TRequestName = MethodNames<T>> {
    constructor(
        options: {
            name?: string;
            port: PseudoMessagePort;
            onRequest?: (message: WorkerRequest) => any;
            onResponse?: (message: WorkerResponse) => any;
            onUpdate?: (message: WorkerUpdate) => any;
        }
    ) {
        this.name = options?.name;
        this.port = options?.port;
        const listener = (message: WorkerMessage) => {
            switch (message.type) {
                case 'request':
                    options?.onRequest?.(message);
                    break;
                case 'response':
                    options?.onResponse?.(message);
                    this.emitter.emit(`${message.type}-${message.id}`, message);
                    break;
                case 'update':
                    options?.onUpdate?.(message);
                    break;
            }
        };
        options?.port.on('message', listener);

        this.disposables.push(
            this.emitter.removeAllListeners.bind(this.emitter),
            () => (options?.port as MessagePort).off('message', listener)
        );
    }

    /**
     * An optional name to help with debugging this handler
     */
    public readonly name: string;

    private port: PseudoMessagePort;

    private disposables: DisposableLike[] = [];

    private emitter = new EventEmitter();

    /**
     * Get the response with this ID
     * @param id the ID of the response
     * @returns the message
     */
    private onResponse<T>(id: number) {
        return new Promise<WorkerResponse<T>>((resolve) => {
            this.emitter.once(`response-${id}`, (response) => {
                resolve(response);
            });
        });
    }

    /**
     * A unique sequence for identifying messages
     */
    private idSequence = 0;

    /**
     * Send a request to the worker, and wait for a response.
     * @param name the name of the request
     * @param options the request options
     */
    public async sendRequest<R>(name: TRequestName, options?: { data: any[]; id?: number }) {
        const request: WorkerMessage = {
            type: 'request',
            name: name as string,
            data: options?.data ?? [],
            id: options?.id ?? this.idSequence++
        };
        const responsePromise = this.onResponse<R>(request.id);
        this.port.postMessage(request);
        const response = await responsePromise;
        if ('error' in response) {
            const error = this.objectToError(response.error);
            (error as any)._response = response;
            //throw the error so it causes a rejected promise (like we'd expect)
            throw error;
        }
        return response;
    }

    /**
     * Send a request to the worker, and wait for a response.
     * @param request the request we are responding to
     * @param options options for this request
     */
    public sendResponse(request: WorkerMessage, options?: { data: any } | { error: Error } | undefined) {
        const response: WorkerResponse = {
            type: 'response',
            name: request.name,
            id: request.id
        };
        if ('error' in options) {
            //hack: turn the error into a plain json object
            response.error = this.errorToObject(options.error);
        } else if ('data' in options) {
            response.data = options.data;
        }
        this.port.postMessage(response);
    }

    /**
     * Send a request to the worker, and wait for a response.
     * @param name the name of the request
     * @param options options for the update
     */
    public sendUpdate<T>(name: string, options?: { data?: any[]; id?: number }) {
        let update: WorkerMessage = {
            type: 'update',
            name: name,
            data: options?.data ?? [],
            id: options?.id ?? this.idSequence++
        };
        this.port.postMessage(update);
    }

    /**
     * Convert an Error object into a plain object so it can be serialized
     * @param error the error to object-ify
     * @returns an object version of an error
     */
    private errorToObject(error: Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: (error.cause as any)?.message && (error.cause as any)?.stack ? this.errorToObject(error.cause as any) : error.cause
        };
    }

    /**
     * Turn an object with an error structure into a proper error
     * @param error the error (in object form) to turn into a proper Error item
     */
    private objectToError(error: Error) {
        let result = new Error();
        result.name = error.name;
        result.message = error.message;
        result.stack = error.stack;
        result.cause = (error.cause as any)?.message && (error.cause as any)?.stack ? this.objectToError(error.cause as any) : error.cause;
        return result;
    }

    public dispose() {
        util.applyDispose(this.disposables);
    }
}

export interface WorkerRequest<TData = any> {
    id: number;
    type: 'request';
    name: string;
    data?: TData;
}

export interface WorkerResponse<TData = any> {
    id: number;
    type: 'response';
    name: string;
    data?: TData;
    /**
     * An error occurred on the remote side. There will be no `.data` value
     */
    error?: Error;
}

export interface WorkerUpdate<TData = any> {
    id: number;
    type: 'update';
    name: string;
    data?: TData;
}

export type WorkerMessage<T = any> = WorkerRequest<T> | WorkerResponse<T> | WorkerUpdate<T>;

type MethodNames<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];
