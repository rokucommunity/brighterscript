import type { BsDiagnostic } from '../interfaces';
import type { File } from './File';
import { standardizePath as s } from '../util';

export class AssetFile implements File {
    /**
     * Create a new instance of this file
     */
    constructor(options: {
        srcPath: string;
        destPath: string;
        pkgPath?: string;
    }) {
        //spread the constructor args onto this object
        Object.assign(this, options);
        this.srcPath = s`${this.srcPath}`;
        this.destPath = s`${this.destPath}`;
        this.pkgPath = s`${this.pkgPath ?? this.destPath}`;
        this.dependencyGraphKey = this.pkgPath.toLowerCase();
    }
    public type = 'AssetFile';

    public srcPath: string;
    public destPath: string;
    public pkgPath: string;

    public diagnostics: BsDiagnostic[] = [];
    dependencyGraphKey: string;
    //mark this file as validated so it skips all validation checks
    isValidated = true;
    //generic files don't need transpiled
    needsTranspiled = false;
}
