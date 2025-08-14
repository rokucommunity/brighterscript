import type { Range } from 'vscode-languageserver-protocol';
import { WorkspaceSymbol } from 'vscode-languageserver-protocol';
import { DocumentSymbol, SymbolKind } from 'vscode-languageserver-protocol';
import type { AstNode } from '../../parser/AstNode';
import util from '../../util';
import type { BrsFile } from '../../files/BrsFile';
import { WalkMode, createVisitor } from '../../astUtils/visitors';

export function getDocumentSymbolsFromBrsFile(file: BrsFile) {
    let result: DocumentSymbol[] = [];
    const symbols = getSymbolsFromAstNode(file.ast);
    for (let symbol of symbols) {
        result.push(
            createSymbol(symbol)
        );
    }
    return result;

    function createSymbol(symbol: SymbolInfo): DocumentSymbol {
        return DocumentSymbol.create(
            symbol.name,
            symbol.documentation,
            symbol.kind,
            symbol.range,
            symbol.selectionRange,
            symbol.children.map(x => createSymbol(x))
        );
    }
}

export function getWorkspaceSymbolsFromBrsFile(file: BrsFile) {
    const result: WorkspaceSymbol[] = [];
    const uri = util.pathToUri(file.srcPath);
    let symbolsToProcess = getSymbolsFromAstNode(file.ast);
    while (symbolsToProcess.length > 0) {
        //get the symbol
        const symbolInfo = symbolsToProcess.shift();
        //push any children to be processed later
        symbolsToProcess.push(...symbolInfo.children);
        const workspaceSymbol = WorkspaceSymbol.create(
            symbolInfo.name,
            symbolInfo.kind,
            uri,
            symbolInfo.selectionRange
        );
        workspaceSymbol.containerName = symbolInfo.containerName;
        result.push(workspaceSymbol);
    }
    return result;
}

interface SymbolInfo {
    name: string;
    documentation: string;
    kind: SymbolKind;
    range: Range;
    selectionRange: Range;
    containerName: string;
    children: SymbolInfo[];
}

function getSymbolsFromAstNode(node: AstNode): SymbolInfo[] {
    //collection of every symbol, indexed by the node it was based on (this is useful to help attach children to their parents)
    const result: SymbolInfo[] = [];
    const lookup = new Map<AstNode, SymbolInfo>();

    function addSymbol(node: AstNode, name: string, kind: SymbolKind, range: Range, selectionRange: Range, documenation?: string) {
        const symbol = {
            name: name,
            documentation: documenation,
            kind: kind,
            range: range,
            selectionRange: selectionRange,
            containerName: undefined,
            children: []
        };
        lookup.set(node, symbol);

        let parent = node.parent;
        while (parent) {
            if (lookup.has(parent)) {
                break;
            }
            parent = parent.parent;
        }
        //if we found a parent, add this symbol as a child of the parent
        if (parent) {
            const parentSymbol = lookup.get(parent);
            symbol.containerName = parentSymbol.name;

            parentSymbol.children.push(symbol);
        } else {
            //there's no parent. add the symbol as a top level result
            result.push(symbol);
        }
    }

    node.walk(createVisitor({
        FunctionStatement: (statement) => {
            if (statement.name?.text) {
                addSymbol(statement, statement.name.text, SymbolKind.Function, statement.range, statement.name.range);
            }
        },
        ClassStatement: (statement, parent) => {
            if (statement.name?.text) {
                addSymbol(statement, statement.name.text, SymbolKind.Class, statement.range, statement.name.range);
            }
        },
        FieldStatement: (statement, parent) => {
            if (statement.name?.text) {
                addSymbol(statement, statement.name.text, SymbolKind.Field, statement.range, statement.name.range);
            }
        },
        MethodStatement: (statement, parent) => {
            if (statement.name?.text) {
                addSymbol(statement, statement.name.text, SymbolKind.Method, statement.range, statement.name.range);
            }
        },
        InterfaceStatement: (statement, parent) => {
            if (statement.tokens.name?.text) {
                addSymbol(statement, statement.tokens.name.text, SymbolKind.Interface, statement.range, statement.tokens.name.range);
            }
        },
        InterfaceFieldStatement: (statement, parent) => {
            if (statement.tokens.name?.text) {
                addSymbol(statement, statement.tokens.name.text, SymbolKind.Field, statement.range, statement.tokens.name.range);
            }
        },
        InterfaceMethodStatement: (statement, parent) => {
            if (statement.tokens.name?.text) {
                addSymbol(statement, statement.tokens.name.text, SymbolKind.Method, statement.range, statement.tokens.name.range);
            }
        },
        ConstStatement: (statement) => {
            if (statement.tokens.name?.text) {
                addSymbol(statement, statement.tokens.name.text, SymbolKind.Constant, statement.range, statement.tokens.name.range);
            }
        },
        NamespaceStatement: (statement) => {
            if (statement.nameExpression) {
                addSymbol(statement, statement.nameExpression.getNameParts().pop(), SymbolKind.Namespace, statement.range, statement.nameExpression.range);
            }
        },
        EnumStatement: (statement) => {
            if (statement.tokens.name?.text) {
                addSymbol(statement, statement.tokens.name.text, SymbolKind.Enum, statement.range, statement.tokens.name.range);
            }
        },
        EnumMemberStatement: (statement) => {
            if (statement.tokens.name?.text) {
                addSymbol(statement, statement.tokens.name.text, SymbolKind.EnumMember, statement.range, statement.tokens.name.range);
            }
        }
    }), {
        walkMode: WalkMode.visitAllRecursive
    });
    return result;
}
