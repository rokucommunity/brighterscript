import type { BsDiagnostic } from '../interfaces';
import type { File } from './File';

export class AssetFile implements File {
    public constructor(
        public srcPath: string,
        public pkgPath: string
    ) {
        this.dependencyGraphKey = this.pkgPath.toLowerCase();
    }
    public type = 'AssetFile';

    public diagnostics: BsDiagnostic[] = [];
    dependencyGraphKey: string;
    //mark this file as validated so it skips all validation checks
    isValidated = true;
    //generic files don't need transpiled
    needsTranspiled = false;
}
