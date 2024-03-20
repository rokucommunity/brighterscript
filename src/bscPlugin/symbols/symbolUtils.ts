import type { WorkspaceSymbol, Range } from 'vscode-languageserver-protocol';
import { DocumentSymbol, SymbolKind } from 'vscode-languageserver-protocol';
import type { Statement } from '../../parser/AstNode';
import { ClassStatement, ConstStatement, EnumMemberStatement, EnumStatement, FieldStatement, FunctionStatement, InterfaceFieldStatement, InterfaceMethodStatement, InterfaceStatement, MethodStatement, NamespaceStatement } from '../../parser/Statement';

export function getDocumentSymbolFromStatement(statement: Statement) {
    return getSymbolsFromStatement(statement, DocumentSymbol.create);
}

export function getWorkspaceSymbolFromStatement(statement: Statement) {
    return getSymbolsFromStatement(statement, (name: string, documenation: string, kind: SymbolKind, range: Range, selectionRange: Range, children?: WorkspaceSymbol[]) => {
        return {} as WorkspaceSymbol;
    });
}

type SymbolFactory<T> = (name: string, documenation: string, kind: SymbolKind, range: Range, selectionRange: Range, children?: T[]) => T;

/**
 * TypeScript won't type narrow within a switch statement, so we use this function to do the type narrowing for us.
 * Hopefully v8 will just inline the function and we won't pay a perf penalty for this. This does not actually do any runtime checking, it just narrows the type for TypeScript's benefit.
 */
function coerce<T>(value: any): value is T {
    return true;
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function getSymbolsFromStatement<T extends WorkspaceSymbol | DocumentSymbol>(statement: Statement, factory: SymbolFactory<T>) {
    switch (statement?.constructor?.name) {
        case FunctionStatement.name:
            if (coerce<FunctionStatement>(statement) && statement.name?.text) {
                return factory(statement.name.text, '', SymbolKind.Function, statement.range, statement.name.range);
            }
            break;

        case ClassStatement.name:
            if (coerce<ClassStatement>(statement) && statement.name?.text) {
                const children = statement.body
                    .map((x) => getSymbolsFromStatement(x, factory))
                    .filter(x => !!x);
                return factory(statement.name.text, '', SymbolKind.Class, statement.range, statement.name.range, children);
            }
            break;

        case FieldStatement.name:
            if (coerce<FieldStatement>(statement) && statement.name?.text) {
                return factory(statement.name.text, '', SymbolKind.Field, statement.range, statement.name.range);
            }
            break;

        case MethodStatement.name:
            if (coerce<MethodStatement>(statement) && statement.name?.text) {
                return factory(statement.name.text, '', SymbolKind.Method, statement.range, statement.name.range);
            }
            break;

        case InterfaceStatement.name:
            if (coerce<InterfaceStatement>(statement) && statement.tokens.name?.text) {
                const children = statement.body
                    .map((x) => getSymbolsFromStatement(x, factory))
                    .filter(x => !!x);
                return factory(statement.tokens.name.text, '', SymbolKind.Interface, statement.range, statement.tokens.name.range, children);
            }
            break;

        case InterfaceFieldStatement.name:
            if (coerce<InterfaceFieldStatement>(statement) && statement.tokens.name?.text) {
                return factory(statement.tokens.name.text, '', SymbolKind.Field, statement.range, statement.tokens.name.range);
            }
            break;

        case InterfaceMethodStatement.name:
            if (coerce<InterfaceMethodStatement>(statement) && statement.tokens.name?.text) {
                return factory(statement.tokens.name.text, '', SymbolKind.Method, statement.range, statement.tokens.name.range);
            }
            break;

        case ConstStatement.name:
            if (coerce<ConstStatement>(statement) && statement.tokens.name?.text) {
                return factory(statement.tokens.name.text, '', SymbolKind.Constant, statement.range, statement.tokens.name.range);
            }
            break;

        case NamespaceStatement.name:
            if (coerce<NamespaceStatement>(statement) && statement.nameExpression) {
                const children = statement.body.statements
                    .map((x) => getSymbolsFromStatement(x, factory))
                    .filter(x => !!x);
                return factory(statement.nameExpression.getNameParts().pop(), '', SymbolKind.Namespace, statement.range, statement.nameExpression.range, children);
            }
            break;

        case EnumStatement.name:
            if (coerce<EnumStatement>(statement) && statement.tokens.name?.text) {
                const children = statement.body
                    .map((x) => getSymbolsFromStatement(x, factory))
                    .filter(x => !!x);
                return factory(statement.tokens.name.text, '', SymbolKind.Enum, statement.range, statement.tokens.name.range, children);
            }
            break;

        case EnumMemberStatement.name:
            if (coerce<EnumMemberStatement>(statement)) {
                return factory(statement.tokens.name.text, '', SymbolKind.EnumMember, statement.range, statement.tokens.name.range);
            }
            break;
    }
}
