import type { BscFile } from './BscFile';
import { standardizePath as s } from '../util';
import type { FileData } from './LazyFileData';
import { LazyFileData } from './LazyFileData';

export class AssetFile implements BscFile {
    /**
     * Create a new instance of this file
     */
    constructor(options: {
        srcPath: string;
        destPath: string;
        pkgPath?: string;
        /**
         * The data for this file.
         */
        data?: FileData;
    }) {
        //spread the constructor args onto this object
        Object.assign(this, options);
        this.data = new LazyFileData(options.data);
        this.srcPath = s`${this.srcPath}`;
        this.destPath = s`${this.destPath}`;
        this.pkgPath = s`${this.pkgPath ?? this.destPath}`;
        this.dependencyGraphKey = this.pkgPath.toLowerCase();
    }
    public type = 'AssetFile';

    public srcPath: string;
    public destPath: string;
    public pkgPath: string;

    public dependencyGraphKey: string;

    //mark this file as validated so it skips all validation checks
    public isValidated = true;

    public data: LazyFileData;
}
