import type { AfterValidateBrsCodeSegmentEvent } from '../../interfaces';


export class BrsFileAfterValidator {
    constructor(
        public event: AfterValidateBrsCodeSegmentEvent
    ) {
    }

    public process() {
        const unlinkGlobalSymbolTable = this.event.codeSegment.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);
        this.event.codeSegment.processSymbolInformation();
        unlinkGlobalSymbolTable();
    }
}
