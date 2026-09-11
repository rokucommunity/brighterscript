export class LazyFileData {
    constructor(
        private initialData: FileData
    ) { }

    /**
     * Has the data been loaded
     */
    public isValueLoaded = false;

    /**
     * Once the data has been loaded, this is where it's stored
     */
    private resolvedData: Buffer;

    public get value(): Buffer {
        if (!this.isValueLoaded) {
            this.isValueLoaded = true;
            this.resolve();
        }
        return this.resolvedData;
    }

    public set value(value: FileData) {
        this.isValueLoaded = true;
        this.initialData = value;
        this.resolve();
    }

    /**
     * Resolve the initialData into the actual data
     */
    private resolve() {
        let result: any;
        if (Buffer.isBuffer(this.initialData)) {
            result = this.initialData;
        } else if (typeof this.initialData === 'string') {
            result = Buffer.from(this.initialData);
        } else if (typeof this.initialData === 'function') {
            result = this.initialData();
            //convert result to buffer
            if (!Buffer.isBuffer(result)) {
                result = Buffer.from(result);
            }
        } else if (isLazyFileData(this.initialData)) {
            result = this.initialData.value;
        }
        this.resolvedData = result;
        delete this.initialData;
    }
}

export type FileData = string | Buffer | (() => Buffer | string) | LazyFileData;

function isLazyFileData(item: any): item is LazyFileData {
    return item?.constructor?.name === 'LazyFileData';
}
