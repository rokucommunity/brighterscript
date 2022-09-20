import type { File } from './File';

export class GenericFile implements File {
    public constructor(
        public srcPath: string,
        public pkgPath: string
    ) {
        this.dependencyGraphKey = this.pkgPath.toLowerCase();
    }
    public type = 'GenericFile';

    dependencyGraphKey: string;
    //mark this file as validated so it skips all validation checks
    isValidated = true;
    //generic files don't need transpiled
    needsTranspiled = false;
}
