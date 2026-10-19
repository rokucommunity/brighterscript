import type { BrsCode } from '../../files/BrsCode';
import type { AfterValidateCodeEvent } from '../../interfaces';


export class BrsFileAfterValidator {
    constructor(
        public event: AfterValidateCodeEvent<BrsCode>
    ) {
    }

    public process() {
        const unlinkGlobalSymbolTable = this.event.code.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);
        this.event.code.processSymbolInformation();
        unlinkGlobalSymbolTable();
    }
}
