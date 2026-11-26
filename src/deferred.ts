export class Deferred<T = void, TReject = any> {
    constructor() {
        this._promise = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }
    public get promise() {
        return this._promise;
    }
    private _promise: Promise<T>;

    /**
     * Indicates whether the promise has been resolved or rejected
     */
    public get isCompleted() {
        return this._isCompleted;
    }
    private _isCompleted = false;

    /**
     * Indicates whether the promise has been resolved
     */
    public get isResolved() {
        return this._isResolved;
    }
    private _isResolved = false;

    /**
     * Indicates whether the promise has been rejected
     */
    public get isRejected() {
        return this._isRejected;
    }
    private _isRejected = false;

    /**
     * Resolve the promise
     */
    public resolve(value?: T) {
        if (this._isCompleted) {
            throw new Error('Already completed.');
        }
        this._isCompleted = true;
        this._isResolved = true;
        this._resolve(value);
    }
    private _resolve: (value: T) => void;

    public tryResolve(value?: T) {
        if (!this.isCompleted) {
            this.resolve(value);
        }
    }

    /**
     * Reject the promise
     */
    public reject(value: TReject) {
        if (this._isCompleted) {
            throw new Error('Already completed.');
        }
        this._isCompleted = true;
        this._isRejected = true;
        this._reject(value);
    }
    private _reject: (value: TReject) => void;

    public tryReject(reason?: TReject) {
        if (!this.isCompleted) {
            this.reject(reason);
        }
    }
}
