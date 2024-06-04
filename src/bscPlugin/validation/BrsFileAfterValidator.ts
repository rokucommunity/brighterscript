import { isBrsFile } from '../../astUtils/reflection';

import type { BrsFile } from '../../files/BrsFile';
import type { AfterFileValidateEvent } from '../../interfaces';


export class BrsFileAfterValidator {
    constructor(
        public event: AfterFileValidateEvent<BrsFile>
    ) {
    }

    public process() {
        if (isBrsFile(this.event.file)) {
            const unlinkGlobalSymbolTable = this.event.file.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);
            this.event.file.processSymbolInformation();
            unlinkGlobalSymbolTable();
        }

    }
}
