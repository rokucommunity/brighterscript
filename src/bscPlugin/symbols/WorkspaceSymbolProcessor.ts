import { isBrsFile } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import { getWorkspaceSymbolsFromStatement } from './symbolUtils';
import util from '../../util';

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
        for (const statement of file.ast.statements) {
            const symbol = getWorkspaceSymbolsFromStatement(statement, util.pathToUri(file.srcPath));
            if (symbol) {
                this.event.workspaceSymbols.push(...symbol);
            }
        }
        return this.event.workspaceSymbols;
    }
}
