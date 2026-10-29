import { isBrsCodeSegment } from '../../astUtils/reflection';
import type { BrsCodeSegment } from '../../files/BrsCodeSegment';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import { getWorkspaceSymbolsFromBrsCodeSegment } from './symbolUtils';

export class WorkspaceSymbolProcessor {
    public constructor(
        public event: ProvideWorkspaceSymbolsEvent
    ) {

    }

    public process() {
        const results = Object.values(this.event.program.files).map(file => {
            return (file.codeSegments ?? []).map(codeSegment => {
                if (isBrsCodeSegment(codeSegment)) {
                    return this.getBrsCodeSegmentWorkspaceSymbols(codeSegment);
                }
                return [];
            }).flat();
        });
        return results.flat();
    }

    private getBrsCodeSegmentWorkspaceSymbols(codeSegment: BrsCodeSegment) {
        const symbols = getWorkspaceSymbolsFromBrsCodeSegment(codeSegment);
        this.event.workspaceSymbols.push(...symbols);
        return this.event.workspaceSymbols;
    }
}
