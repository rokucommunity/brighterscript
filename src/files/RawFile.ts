import type { BscFile } from './BscFile';

export class RawFile implements BscFile {
    public constructor(
        public srcPath: string,
        public pkgPath: string
    ) {
        this.dependencyGraphKey = this.pkgPath.toLowerCase();
    }
    public type = 'RawFile';

    dependencyGraphKey: string;
    //mark this file as validated so it skips all validation checks
    isValidated = true;
    //raw files don't need transpiled
    needsTranspiled = false;
}
