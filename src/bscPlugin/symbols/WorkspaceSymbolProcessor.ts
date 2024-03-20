import { DocumentSymbol, SymbolKind } from 'vscode-languageserver-types';
import { isBrsFile, isClassStatement, isConstStatement, isEnumMemberStatement, isEnumStatement, isFieldStatement, isFunctionStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInterfaceStatement, isMethodStatement, isNamespaceStatement } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideWorkspaceSymbolsEvent } from '../../interfaces';
import type { Statement } from '../../parser/AstNode';
import { getWorkspaceSymbolFromStatement } from './symbolUtils';

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
        const symbol = SymbolInformation.create(name, symbolKind, statement.range, uri, containerStatement?.getName(ParseMode.BrighterScript));

        for (const statement of file.ast.statements) {
            const symbol = getWorkspaceSymbolFromStatement(statement);
            if (symbol) {
                this.event.workspaceSymbols.push(symbol);
            }
        }
        return this.event.workspaceSymbols;
    }
}
