import { isBrsFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideDocumentSymbolsEvent } from '../../interfaces';
import { getDocumentSymbolsFromStatement } from './symbolUtils';

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
        for (const statement of file.ast.statements) {
            const symbol = getDocumentSymbolsFromStatement(statement);
            if (symbol) {
                this.event.documentSymbols.push(...symbol);
            }
        }
        return this.event.documentSymbols;
    }
}
