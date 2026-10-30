import type { AfterValidateFileEvent } from '../../interfaces';
import util from '../../util';


export class BrsFileAfterValidator {
    constructor(
        public event: AfterValidateFileEvent
    ) {
    }

    public process() {
        const codeSegments = util.getCodeSegments(this.event.file);
        //link all of the file's code segments to the global symbol table as a group, so the links (and the type caches
        //they invalidate) happen once for the file rather than once per code segment
        const unlinkGlobalSymbolTables = codeSegments.map(codeSegment => {
            return codeSegment.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);
        });
        for (const codeSegment of codeSegments) {
            codeSegment.processSymbolInformation();
        }
        for (const unlinkGlobalSymbolTable of unlinkGlobalSymbolTables) {
            unlinkGlobalSymbolTable();
        }
    }
}
