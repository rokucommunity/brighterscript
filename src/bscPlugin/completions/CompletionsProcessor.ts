import { isBody, isBrsFile, isCallableType, isClassType, isConstStatement, isEnumMemberType, isEnumType, isInterfaceType, isMethodStatement, isNamespaceType, isXmlFile, isXmlScope } from '../../astUtils/reflection';
import type { BscFile, ExtraSymbolData, FileReference, ProvideCompletionsEvent } from '../../interfaces';
import { Keywords, TokenKind } from '../../lexer/TokenKind';
import type { XmlScope } from '../../XmlScope';
import { util } from '../../util';
import type { Scope } from '../../Scope';
import { ParseMode, type Parser } from '../../parser/Parser';
import type { CompletionItem, Position } from 'vscode-languageserver';
import { CompletionItemKind, TextEdit } from 'vscode-languageserver';
import type { BscSymbol } from '../../SymbolTable';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { XmlFile } from '../../files/XmlFile';
import type { Program } from '../../Program';
import type { BrsFile } from '../../files/BrsFile';
import type { Token } from '../../lexer/Token';
import type { FunctionScope } from '../../FunctionScope';
import type { BscType } from '../../types';
import type { AstNode } from '../../parser/AstNode';
import type { FunctionStatement } from '../../parser/Statement';


export class CompletionsProcessor {
    constructor(
        private event: ProvideCompletionsEvent
    ) {

    }

    public process() {
        let completionsArray = [];
        if (isBrsFile(this.event.file) && this.event.file.isPositionNextToTokenKind(this.event.position, TokenKind.Callfunc)) {
            const xmlScopes = this.event.program.getScopes().filter((s) => isXmlScope(s)) as XmlScope[];
            // is next to a @. callfunc invocation - must be an interface method.
            //TODO refactor this to utilize the actual variable's component type (when available)
            for (const scope of xmlScopes) {
                let fileLinks = this.event.program.getStatementsForXmlFile(scope);
                for (let fileLink of fileLinks) {
                    let pushItem = this.createCompletionFromFunctionStatement(fileLink.item);
                    if (!completionsArray.includes(pushItem.label)) {
                        completionsArray.push(pushItem.label);
                        this.event.completions.push(pushItem);
                    }
                }
            }
            //no other result is possible in this case
            return;
        }

        //find the scopes for this file
        let scopesForFile = this.event.program.getScopesForFile(this.event.file);

        //if there are no scopes, include the global scope so we at least get the built-in functions
        scopesForFile = scopesForFile.length > 0 ? scopesForFile : [this.event.program.globalScope];

        //get the completions from all scopes for this file
        let allCompletions = util.flatMap(
            scopesForFile.map(scope => {
                if (isXmlFile(this.event.file)) {
                    return this.getXmlFileCompletions(this.event.position, this.event.file);
                } else if (isBrsFile(this.event.file)) {
                    return this.getBrsFileCompletions(this.event.position, this.event.file, scope);
                }
                return [];
            }),
            c => c
        );

        //only keep completions common to every scope for this file
        let keyCounts = new Map<string, number>();
        for (let completion of allCompletions) {
            let key = `${completion.label}-${completion.kind}`;
            keyCounts.set(key, keyCounts.has(key) ? keyCounts.get(key) + 1 : 1);
            if (keyCounts.get(key) === scopesForFile.length) {
                this.event.completions.push(completion);
            }
        }
    }


    /**
     * Get all available completions for the specified position
     * @param position the position to get completions
     */
    public getXmlFileCompletions(position: Position, file: XmlFile): CompletionItem[] {
        let scriptImport = util.getScriptImportAtPosition(file.scriptTagImports, position);
        if (scriptImport) {
            return this.getScriptImportCompletions(file.program, file.pkgPath, scriptImport);
        } else {
            return [];
        }
    }

    /**
     * Get a list of all script imports, relative to the specified pkgPath
     * @param program - reference to teh program
     * @param sourcePkgPath - the pkgPath of the source that wants to resolve script imports
     * @param scriptImport - example script import
     */
    public getScriptImportCompletions(program: Program, sourcePkgPath: string, scriptImport: FileReference) {
        let lowerSourcePkgPath = sourcePkgPath.toLowerCase();

        let result = [] as CompletionItem[];
        /**
         * hashtable to prevent duplicate results
         */
        let resultPkgPaths = {} as Record<string, boolean>;

        //restrict to only .brs files
        for (let key in program.files) {
            let file = program.files[key];
            if (
                //is a BrightScript or BrighterScript file
                (file.extension === '.bs' || file.extension === '.brs') &&
                //this file is not the current file
                lowerSourcePkgPath !== file.pkgPath.toLowerCase()
            ) {
                //add the relative path
                let relativePath = util.getRelativePath(sourcePkgPath, file.pkgPath).replace(/\\/g, '/');
                let pkgPathStandardized = file.pkgPath.replace(/\\/g, '/');
                let filePkgPath = `pkg:/${pkgPathStandardized}`;
                let lowerFilePkgPath = filePkgPath.toLowerCase();
                if (!resultPkgPaths[lowerFilePkgPath]) {
                    resultPkgPaths[lowerFilePkgPath] = true;

                    result.push({
                        label: relativePath,
                        detail: file.srcPath,
                        kind: CompletionItemKind.File,
                        textEdit: {
                            newText: relativePath,
                            range: scriptImport.filePathRange
                        }
                    });

                    //add the absolute path
                    result.push({
                        label: filePkgPath,
                        detail: file.srcPath,
                        kind: CompletionItemKind.File,
                        textEdit: {
                            newText: filePkgPath,
                            range: scriptImport.filePathRange
                        }
                    });
                }
            }
        }
        return result;
    }

    /**
     * Get completions available at the given cursor. This aggregates all values from this file and the current scope.
     */
    public getBrsFileCompletions(position: Position, file: BrsFile, scope?: Scope): CompletionItem[] {
        let result = [] as CompletionItem[];

        //handle script import completions
        let scriptImport = util.getScriptImportAtPosition(file.ownScriptImports, position);
        if (scriptImport) {
            return this.getScriptImportCompletions(file.program, file.pkgPath, scriptImport);
        }

        const currentToken = file.getTokenAt(position) ?? file.getTokenAt(file.getClosestExpression(position)?.range.start);
        if (!currentToken) {
            return [];
        }
        //if cursor is within a comment, disable completions
        const tokenKind = currentToken?.kind;
        if (tokenKind === TokenKind.Comment) {
            return [];
        } else if (tokenKind === TokenKind.StringLiteral || tokenKind === TokenKind.TemplateStringQuasi) {
            const match = /^("?)(pkg|libpkg):/.exec(currentToken.text);
            if (match) {
                const [, openingQuote, fileProtocol] = match;
                //include every absolute file path from this scope
                for (const file of scope.getAllFiles()) {
                    const pkgPath = `${fileProtocol}:/${file.pkgPath.replace(/\\/g, '/')}`;
                    result.push({
                        label: pkgPath,
                        textEdit: TextEdit.replace(
                            util.createRange(
                                currentToken.range.start.line,
                                //+1 to step past the opening quote
                                currentToken.range.start.character + (openingQuote ? 1 : 0),
                                currentToken.range.end.line,
                                //-1 to exclude the closing quotemark (or the end character if there is no closing quotemark)
                                currentToken.range.end.character + (currentToken.text.endsWith('"') ? -1 : 0)
                            ),
                            pkgPath
                        ),
                        kind: CompletionItemKind.File
                    });
                }
                return result;
            } else {
                //do nothing. we don't want to show completions inside of strings...
                return [];
            }
        }

        let expression: AstNode;
        let shouldLookForMembers = false;

        if (file.tokenFollows(currentToken, TokenKind.Goto)) {
            let functionScope = file.getFunctionScopeAtPosition(position);
            return this.getLabelCompletion(functionScope);
        }


        if (file.getPreviousToken(currentToken)?.kind === TokenKind.Dot || file.isTokenNextToTokenKind(currentToken, TokenKind.Dot)) {
            const dotToken = currentToken.kind === TokenKind.Dot ? currentToken : file.getTokenBefore(currentToken, TokenKind.Dot);
            const beforeDotToken = file.getTokenBefore(dotToken);
            expression = file.getClosestExpression(beforeDotToken?.range.end);
            shouldLookForMembers = true;
        } else {
            expression = file.getClosestExpression(this.event.position);
        }

        if (!expression) {
            return [];
        }
        const tokenBefore = file.getTokenBefore(file.getClosestToken(expression.range.start));

        // helper to check get correct symbol tables for look ups
        function getSymbolTableForLookups() {
            if (shouldLookForMembers) {
                let type = expression.getType({ flags: SymbolTypeFlag.runtime });
                if (isEnumMemberType(type)) {
                    // Completions on an enum member should include the reset of the members
                    type = expression.getSymbolTable().getSymbolType(type.enumName, { flags: SymbolTypeFlag.runtime });
                }
                // Make sure built in interfaces are added.
                if (type.isResolvable()) {
                    type.addBuiltInInterfaces();
                }
                return type?.memberTable;
            }
            const symbolTableToUse = expression.getSymbolTable();
            return symbolTableToUse;
        }

        for (const scope of this.event.scopes) {
            scope.linkSymbolTable();
            let currentSymbols = getSymbolTableForLookups()?.getAllSymbols(SymbolTypeFlag.runtime) ?? [];
            // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
            switch (tokenBefore.kind) {
                case TokenKind.New:
                    //we are after a new keyword; so we can only be namespaces that have a class or classes at this point
                    currentSymbols = currentSymbols.filter(symbol => isClassType(symbol.type) || this.isNamespaceTypeWithMemberType(symbol.type, isClassType));
                    break;
            }
            if (shouldLookForMembers) {
                const tokenType = expression.getType({ flags: SymbolTypeFlag.runtime });
                if (isClassType(tokenType)) {
                    // don't return the constructor as a property
                    currentSymbols = currentSymbols.filter((symbol) => symbol.name !== 'new');
                }
            }

            result.push(...this.getSymbolsCompletion(currentSymbols, shouldLookForMembers));
            if (shouldLookForMembers && currentSymbols.length === 0) {
                // could not find members of actual known types.. just try everything
                result.push(...this.getPropertyNameCompletions(scope),
                    ...this.getAllClassMemberCompletions(scope).values());
            }
            scope.unlinkSymbolTable();
        }
        return result;
    }

    private getSymbolsCompletion(symbols: BscSymbol[], areMembers = false): CompletionItem[] {
        return symbols.map(symbol => {
            // if this is low priority, sort it at the end of the list
            const sortText = symbol.data?.completionPriority ? 'z'.repeat(symbol.data?.completionPriority) + symbol.name : undefined;
            return {
                label: symbol.name,
                kind: this.getCompletionKindFromType(symbol.type, symbol.data, areMembers),
                detail: symbol?.type?.toString(),
                documentation: this.getDocumentation(symbol),
                sortText: sortText
            };
        });
    }

    private getDocumentation(symbol: BscSymbol) {
        if (symbol.data?.description) {
            return symbol.data?.description;
        }
        const root = symbol.data?.definingNode?.getRoot();
        let parser: Parser;
        if (isBody(root)) {
            parser = root.parser;
        }
        if (!parser) {
            return undefined;
        }
        let exprStartToken: Token;
        for (let token of parser.tokens) {
            if (util.rangeContains(token.range, symbol.data?.definingNode?.range?.start)) {
                exprStartToken = token;
                break;
            }
        }
        return util.getTokenDocumentation(parser?.tokens, exprStartToken);
    }


    private getCompletionKindFromType(type: BscType, extraData?: ExtraSymbolData, areMembers = false) {
        if (isConstStatement(extraData?.definingNode)) {
            return CompletionItemKind.Constant;
        } else if (isClassType(type)) {
            return CompletionItemKind.Class;
        } else if (isCallableType(type)) {
            return areMembers ? CompletionItemKind.Method : CompletionItemKind.Function;
        } else if (isInterfaceType(type)) {
            return CompletionItemKind.Interface;
        } else if (isEnumType(type)) {
            return CompletionItemKind.Enum;
        } else if (isEnumMemberType(type)) {
            return CompletionItemKind.EnumMember;
        } else if (isNamespaceType(type)) {
            return CompletionItemKind.Module;
        }
        return areMembers ? CompletionItemKind.Field : CompletionItemKind.Variable;
    }


    private isNamespaceTypeWithMemberType(nsType: BscType, predicate: (t: BscType) => boolean): boolean {
        if (!isNamespaceType(nsType)) {
            return false;
        }
        const members = nsType.memberTable.getAllSymbols(SymbolTypeFlag.runtime);
        for (const member of members) {
            if (predicate(member.type)) {
                return true;
            } else if (isNamespaceType(member.type)) {
                if (this.isNamespaceTypeWithMemberType(member.type, predicate)) {
                    return true;
                }
            }
        }
        return false;

    }

    private getLabelCompletion(functionScope: FunctionScope) {
        return functionScope.labelStatements.map(label => ({
            label: label.name,
            kind: CompletionItemKind.Reference
        }));
    }

    public createCompletionFromFunctionStatement(statement: FunctionStatement): CompletionItem {
        return {
            label: statement.getName(ParseMode.BrighterScript),
            kind: CompletionItemKind.Function,
            documentation: statement.getType({ flags: SymbolTypeFlag.runtime }).toString()
        };
    }


    /**
     * Scan all files for property names, and return them as completions
     */
    public getPropertyNameCompletions(scope: Scope) {
        let results = [] as CompletionItem[];
        scope.enumerateBrsFiles((file) => {
            results.push(...file.propertyNameCompletions);
        });
        return results;
    }

    public getAllClassMemberCompletions(scope: Scope) {
        let results = new Map<string, CompletionItem>();
        let filesSearched = new Set<BscFile>();
        for (const file of scope.getAllFiles()) {
            if (isXmlFile(file) || filesSearched.has(file)) {
                continue;
            }
            filesSearched.add(file);
            for (let cs of file.parser.references.classStatements) {
                for (let s of [...cs.methods, ...cs.fields]) {
                    if (!results.has(s.name.text) && s.name.text.toLowerCase() !== 'new') {
                        results.set(s.name.text, {
                            label: s.name.text,
                            kind: isMethodStatement(s) ? CompletionItemKind.Method : CompletionItemKind.Field
                        });
                    }
                }
            }
        }
        return results;
    }
}

/**
 * List of completions for all valid keywords/reserved words.
 * Build this list once because it won't change for the lifetime of this process
 */
export const KeywordCompletions = Object.keys(Keywords)
    //remove any keywords with whitespace
    .filter(x => !x.includes(' '))
    //create completions
    .map(x => {
        return {
            label: x,
            kind: CompletionItemKind.Keyword
        } as CompletionItem;
    });
