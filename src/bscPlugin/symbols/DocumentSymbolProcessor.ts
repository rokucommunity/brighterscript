import { isBrsCodeSegment } from '../../astUtils/reflection';
import type { BrsCodeSegment } from '../../files/BrsCodeSegment';
import type { ProvideDocumentSymbolsEvent } from '../../interfaces';
import { getDocumentSymbolsFromBrsCodeSegment } from './symbolUtils';

export class DocumentSymbolProcessor {
    public constructor(
        public event: ProvideDocumentSymbolsEvent
    ) {

    }

    public process() {
        if (isBrsCodeSegment(this.event.codeSegment)) {
            return this.getBrsCodeSegmentDocumentSymbols(this.event.codeSegment);
        }
    }

    private getBrsCodeSegmentDocumentSymbols(codeSegment: BrsCodeSegment) {
        const symbols = getDocumentSymbolsFromBrsCodeSegment(codeSegment);
        this.event.documentSymbols.push(...symbols);
        return this.event.documentSymbols;
    }
}
