import { Scope } from './Scope';
import type { BrsFile } from './files/BrsFile';
import type { Program } from './Program';

/**
 * The scope for a file that is not part of any other scope, but is the target of a named type import
 * (`import type { Name } from "..."`). Type imports do not bring the imported file into the importer's scope, so without
 * this scope the file would never be validated and problems in it would only surface indirectly (as unresolvable names
 * in the files that import from it). The scope contains the file and its own regular imports, and lives for as long as
 * the file is type-imported and has no other scope
 */
export class TypeImportScope extends Scope {
    constructor(
        public file: BrsFile,
        program: Program
    ) {
        super(TypeImportScope.getScopeName(file), program, `scope:type-import:${file.destPath.toLowerCase()}`);
    }

    public static getScopeName(file: BrsFile) {
        return `type-import:${file.destPath}`;
    }
}
