import { isBrsFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import { getWorkspaceSymbolsFromBrsFile } from './symbolUtils';

export class WorkspaceSymbolProcessor {
    public constructor(
        public event: ProvideWorkspaceSymbolsEvent
    ) {

    }

    public process() {
        const results = Object.values(this.event.program.files).map(file => {
            if (isBrsFile(file)) {
                return this.getBrsFileWorkspaceSymbols(file);
            }
            return [];
        });
        return results.flat();
    }

    private getBrsFileWorkspaceSymbols(file: BrsFile) {
        const symbols = getWorkspaceSymbolsFromBrsFile(file);
        this.event.workspaceSymbols.push(...symbols);
        return this.event.workspaceSymbols;
    }
}
