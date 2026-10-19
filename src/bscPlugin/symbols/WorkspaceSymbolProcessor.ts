import { isBrsCode } from '../../astUtils/reflection';
import type { BrsCode } from '../../files/BrsCode';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import { getWorkspaceSymbolsFromBrsCode } from './symbolUtils';

export class WorkspaceSymbolProcessor {
    public constructor(
        public event: ProvideWorkspaceSymbolsEvent
    ) {

    }

    public process() {
        const results = Object.values(this.event.program.files).map(file => {
            return (file.codes ?? []).map(code => {
                if (isBrsCode(code)) {
                    return this.getBrsCodeWorkspaceSymbols(code);
                }
                return [];
            }).flat();
        });
        return results.flat();
    }

    private getBrsCodeWorkspaceSymbols(code: BrsCode) {
        const symbols = getWorkspaceSymbolsFromBrsCode(code);
        this.event.workspaceSymbols.push(...symbols);
        return this.event.workspaceSymbols;
    }
}
