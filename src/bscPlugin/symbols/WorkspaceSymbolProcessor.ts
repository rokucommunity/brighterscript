import { isBrsCodeSegment } from '../../astUtils/reflection';
import type { BrsCodeSegment } from '../../files/BrsCodeSegment';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import { getWorkspaceSymbolsFromBrsCode } from './symbolUtils';

export class WorkspaceSymbolProcessor {
    public constructor(
        public event: ProvideWorkspaceSymbolsEvent
    ) {

    }

    public process() {
        const results = Object.values(this.event.program.files).map(file => {
            return (file.codeSegments ?? []).map(code => {
                if (isBrsCodeSegment(code)) {
                    return this.getBrsCodeWorkspaceSymbols(code);
                }
                return [];
            }).flat();
        });
        return results.flat();
    }

    private getBrsCodeWorkspaceSymbols(code: BrsCodeSegment) {
        const symbols = getWorkspaceSymbolsFromBrsCode(code);
        this.event.workspaceSymbols.push(...symbols);
        return this.event.workspaceSymbols;
    }
}
