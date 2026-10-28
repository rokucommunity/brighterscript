import { isBrsCodeSegment } from '../../astUtils/reflection';
import type { BrsCodeSegment } from '../../files/BrsCodeSegment';
import type { ProvideDocumentSymbolsEvent } from '../../interfaces';
import { getDocumentSymbolsFromBrsCode } from './symbolUtils';

export class DocumentSymbolProcessor {
    public constructor(
        public event: ProvideDocumentSymbolsEvent
    ) {

    }

    public process() {
        if (isBrsCodeSegment(this.event.codeSegment)) {
            return this.getBrsCodeDocumentSymbols(this.event.codeSegment);
        }
    }

    private getBrsCodeDocumentSymbols(code: BrsCodeSegment) {
        const symbols = getDocumentSymbolsFromBrsCode(code);
        this.event.documentSymbols.push(...symbols);
        return this.event.documentSymbols;
    }
}
