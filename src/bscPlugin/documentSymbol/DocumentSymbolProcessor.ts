import { DocumentSymbol, SymbolKind } from 'vscode-languageserver-types';
import { isBrsFile, isClassStatement, isConstStatement, isEnumMemberStatement, isEnumStatement, isFieldStatement, isFunctionStatement, isInterfaceFieldStatement, isInterfaceMethodStatement, isInterfaceStatement, isMethodStatement, isNamespaceStatement } from '../../astUtils/reflection';
import type { BrsFile } from '../../files/BrsFile';
import type { ProvideDocumentSymbolsEvent } from '../../interfaces';
import type { Statement } from '../../parser/AstNode';

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
            const symbol = getSymbolsFromStatement(statement);
            if (symbol) {
                this.event.documentSymbols.push(symbol);
            }
        }
        return this.event.documentSymbols;

        function getSymbolsFromStatement(statement: Statement) {
            if (isFunctionStatement(statement)) {
                return DocumentSymbol.create(statement.name.text, '', SymbolKind.Function, statement.range, statement.name.range);

            } else if (isMethodStatement(statement)) {
                return DocumentSymbol.create(statement.name.text, '', SymbolKind.Method, statement.range, statement.name.range);

            } else if (isInterfaceMethodStatement(statement)) {
                return DocumentSymbol.create(statement.tokens.name.text, '', SymbolKind.Method, statement.range, statement.tokens.name.range);

            } else if (isFieldStatement(statement)) {
                return DocumentSymbol.create(statement.name.text, '', SymbolKind.Field, statement.range, statement.name.range);

            } else if (isInterfaceFieldStatement(statement)) {
                return DocumentSymbol.create(statement.tokens.name.text, '', SymbolKind.Field, statement.range, statement.tokens.name.range);

            } else if (isConstStatement(statement)) {
                return DocumentSymbol.create(statement.tokens.name.text, '', SymbolKind.Constant, statement.range, statement.tokens.name.range);

            } else if (isNamespaceStatement(statement)) {
                const children = statement.body.statements
                    .map(getSymbolsFromStatement)
                    .filter(x => !!x);
                return DocumentSymbol.create(statement.nameExpression.getNameParts().pop(), '', SymbolKind.Namespace, statement.range, statement.nameExpression.range, children);

            } else if (isClassStatement(statement)) {
                const children = statement.body
                    .map(getSymbolsFromStatement)
                    .filter(x => !!x);
                return DocumentSymbol.create(statement.name.text, '', SymbolKind.Class, statement.range, statement.name.range, children);

            } else if (isInterfaceStatement(statement)) {
                const children = statement.body
                    .map(getSymbolsFromStatement)
                    .filter(x => !!x);
                return DocumentSymbol.create(statement.tokens.name.text, '', SymbolKind.Interface, statement.range, statement.tokens.name.range, children);

            } else if (isEnumStatement(statement)) {
                const children = statement.body
                    .map(getSymbolsFromStatement)
                    .filter(x => !!x);
                return DocumentSymbol.create(statement.tokens.name.text, '', SymbolKind.Enum, statement.range, statement.tokens.name.range, children);

            } else if (isEnumMemberStatement(statement)) {
                return DocumentSymbol.create(statement.tokens.name.text, '', SymbolKind.EnumMember, statement.range, statement.tokens.name.range);
            }
        }
    }
}
