import { isBrsCode } from '../../astUtils/reflection';
import type { BrsCode } from '../../files/BrsCode';
import type { ProvideDocumentSymbolsEvent } from '../../interfaces';
import { getDocumentSymbolsFromBrsCode } from './symbolUtils';

export class DocumentSymbolProcessor {
    public constructor(
        public event: ProvideDocumentSymbolsEvent
    ) {

    }

    public process() {
        if (isBrsCode(this.event.code)) {
            return this.getBrsCodeDocumentSymbols(this.event.code);
        }
    }

    private getBrsCodeDocumentSymbols(code: BrsCode) {
        const symbols = getDocumentSymbolsFromBrsCode(code);
        this.event.documentSymbols.push(...symbols);
        return this.event.documentSymbols;
    }
}
