import { isBrsFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideDocumentSymbolsEvent } from '../../interfaces';
import { getDocumentSymbolsFromBrsFile } from './symbolUtils';

export class DocumentSymbolProcessor {
    public constructor(
        public event: ProvideDocumentSymbolsEvent
    ) {

    }

    public process() {
        if (isBrsFile(this.event.file)) {
            return this.getBrsFileDocumentSymbols(this.event.file);
        }
    }

    private getBrsFileDocumentSymbols(file: BrsFile) {
        const symbols = getDocumentSymbolsFromBrsFile(file);
        this.event.documentSymbols.push(...symbols);
        return this.event.documentSymbols;
    }
}
