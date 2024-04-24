import { isBlock, isBrsFile, isCallableType, isClassStatement, isClassType, isComponentType, isConstStatement, isEnumMemberType, isEnumType, isFunctionExpression, isInterfaceType, isMethodStatement, isNamespaceStatement, isNamespaceType, isNativeType, isTypedFunctionType, isXmlFile, isXmlScope } from '../../astUtils/reflection';
import type { FileReference, ProvideCompletionsEvent } from '../../interfaces';
import type { BscFile } from '../../files/BscFile';
import { AllowedTriviaTokens, DeclarableTypes, Keywords, TokenKind } from '../../lexer/TokenKind';
import type { XmlScope } from '../../XmlScope';
import { util } from '../../util';
import type { Scope } from '../../Scope';
import { ParseMode } from '../../parser/Parser';
import type { CompletionItem, Position } from 'vscode-languageserver';
import { CompletionItemKind, TextEdit } from 'vscode-languageserver';
import type { BscSymbol } from '../../SymbolTable';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import type { XmlFile } from '../../files/XmlFile';
import type { Program } from '../../Program';
import type { BrsFile } from '../../files/BrsFile';
import type { FunctionScope } from '../../FunctionScope';
import { BooleanType } from '../../types/BooleanType';
import { InvalidType } from '../../types/InvalidType';
import type { BscType } from '../../types/BscType';
import type { AstNode } from '../../parser/AstNode';
import type { ClassStatement, FunctionStatement, NamespaceStatement } from '../../parser/Statement';
import type { Token } from '../../lexer/Token';
import { createIdentifier } from '../../astUtils/creators';

export class CompletionsProcessor {
    constructor(
        private event: ProvideCompletionsEvent
    ) {

    }

    public process() {
        let file = this.event.file;

        //find the scopes for this file
        let scopesForFile = this.event.program.getScopesForFile(file);

        //if there are no scopes, include the global scope so we at least get the built-in functions
        scopesForFile = scopesForFile.length > 0 ? scopesForFile : [this.event.program.globalScope];

        //get the completions from all scopes for this file
        let completionResults: CompletionItem[] = [];
        if (isXmlFile(file)) {
            completionResults = this.getXmlFileCompletions(this.event.position, file);
        } else if (isBrsFile(file)) {
            //handle script import completions
            let scriptImport = util.getScriptImportAtPosition(file.ownScriptImports, this.event.position);
            if (scriptImport) {
                this.event.completions.push(...this.getScriptImportCompletions(file.program, file.pkgPath, scriptImport));
                return;
            }
            completionResults = this.getBrsFileCompletions(this.event.position, file);
        }

        let allCompletions = completionResults.flat();

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
     * @param program - reference to the program
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
            const ext = util.getExtension(file.srcPath);
            if (
                //is a BrightScript or BrighterScript file
                (ext === '.bs' || ext === '.brs') &&
                //this file is not the current file
                lowerSourcePkgPath !== file.pkgPath.toLowerCase()
            ) {
                //add the relative path
                let relativePath = util.getRelativePath(sourcePkgPath, file.destPath).replace(/\\/g, '/');
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
    public getBrsFileCompletions(position: Position, file: BrsFile): CompletionItem[] {
        let result = [] as CompletionItem[];
        const currentTokenByFilePosition = file.getTokenAt(position);
        const currentToken = currentTokenByFilePosition ?? file.getTokenAt(file.getClosestExpression(position)?.range.start);
        if (!currentToken) {
            return [];
        }
        const tokenKind = currentToken?.kind;

        //if cursor is after a comment, disable completions
        if (this.isPostionInComment(file, position)) {
            return [];
        }

        let expression: AstNode;
        let shouldLookForMembers = false;
        let shouldLookForCallFuncMembers = false;
        let symbolTableLookupFlag = SymbolTypeFlag.runtime;
        let beforeDotToken: Token;

        if (file.tokenFollows(currentToken, TokenKind.Goto)) {
            let functionScope = file.getFunctionScopeAtPosition(position);
            return this.getLabelCompletion(functionScope);
        }


        if (file.getPreviousToken(currentToken)?.kind === TokenKind.Dot || file.isTokenNextToTokenKind(currentToken, TokenKind.Dot)) {
            const dotToken = currentToken.kind === TokenKind.Dot ? currentToken : file.getTokenBefore(currentToken, TokenKind.Dot);
            beforeDotToken = file.getTokenBefore(dotToken);
            expression = file.getClosestExpression(beforeDotToken?.range.end);
            shouldLookForMembers = true;
        } else if (file.getPreviousToken(currentToken)?.kind === TokenKind.Callfunc || file.isTokenNextToTokenKind(currentToken, TokenKind.Callfunc)) {
            const dotToken = currentToken.kind === TokenKind.Callfunc ? currentToken : file.getTokenBefore(currentToken, TokenKind.Callfunc);
            beforeDotToken = file.getTokenBefore(dotToken);
            expression = file.getClosestExpression(beforeDotToken?.range.end);
            shouldLookForCallFuncMembers = true;
        } else if (file.getPreviousToken(currentToken)?.kind === TokenKind.As || file.isTokenNextToTokenKind(currentToken, TokenKind.As)) {

            if (file.parseMode === ParseMode.BrightScript) {
                return NativeTypeCompletions;
            }
            expression = file.getClosestExpression(this.event.position);
            symbolTableLookupFlag = SymbolTypeFlag.typetime;
        } else {
            expression = file.getClosestExpression(this.event.position);
        }

        if (!expression) {
            return [];
        }

        if (isFunctionExpression(expression)) {
            // if completion is the last character of the function, use the completions of the body of the function
            expression = expression.body;
        }

        const tokenBefore = file.getTokenBefore(file.getClosestToken(expression.range.start));

        // helper to check get correct symbol tables for look ups
        function getSymbolTableForLookups() {
            if (shouldLookForMembers) {
                let type = expression.getType({ flags: SymbolTypeFlag.runtime });
                if (isEnumType(type) && !isEnumType(expression.getType({ flags: SymbolTypeFlag.typetime }))) {
                    // enum members are registered in the symbol table as enum type
                    // an enum type should ONLY use the enum type's members when called directly
                    // since this is not a typetime enum, the actual type is actually an enum member!
                    type = type.defaultMemberType;
                }
                // Make sure built in interfaces are added.
                if (type.isResolvable()) {
                    type.addBuiltInInterfaces();
                }
                return type?.getMemberTable();
            } else if (shouldLookForCallFuncMembers) {
                let type = expression.getType({ flags: SymbolTypeFlag.runtime });
                if (isComponentType(type)) {
                    // it's a component and you're doing a callFunc - only let it do functions from that table
                    return type.getCallFuncTable();
                }
                // this is not a component type - there should be no callfunc members
                return undefined;
            }
            const symbolTableToUse = expression.getSymbolTable();
            return symbolTableToUse;
        }

        let gotSymbolsFromThisFile = false;
        let gotSymbolsFromGlobal = false;
        const shouldLookInNamespace: NamespaceStatement = !(shouldLookForMembers || shouldLookForCallFuncMembers) && expression.findAncestor(isNamespaceStatement);

        const containingClassStmt = expression.findAncestor<ClassStatement>(isClassStatement);
        const containingNamespace = expression.findAncestor<NamespaceStatement>(isNamespaceStatement);
        const containingNamespaceName = containingNamespace?.getName(ParseMode.BrighterScript);

        for (const scope of this.event.scopes) {
            if (tokenKind === TokenKind.StringLiteral || tokenKind === TokenKind.TemplateStringQuasi) {
                result.push(...this.getStringLiteralCompletions(scope, currentToken));
                continue;
            }
            scope.linkSymbolTable();
            const symbolTable = getSymbolTableForLookups();
            let currentSymbols: BscSymbol[] = [];

            if (shouldLookForMembers || shouldLookForCallFuncMembers) {
                currentSymbols = symbolTable?.getAllSymbols(symbolTableLookupFlag) ?? [];
                const tokenType = expression.getType({ flags: SymbolTypeFlag.runtime });
                if (isClassType(tokenType)) {
                    currentSymbols = currentSymbols.filter((symbol) => {
                        if (symbol.name === 'new') {
                            // don't return the constructor as a property
                            return false;
                        }
                        return this.isMemberAccessible(scope, symbol, containingClassStmt, containingNamespaceName);
                    });
                }
            } else {
                // get symbols directly from current symbol table and scope
                if (!gotSymbolsFromThisFile) {
                    currentSymbols = symbolTable?.getOwnSymbols(symbolTableLookupFlag) ?? [];
                    if (isBlock(expression) && isFunctionExpression(expression.parent)) {
                        currentSymbols.push(...expression.parent.getSymbolTable().getOwnSymbols(symbolTableLookupFlag));
                    }
                    gotSymbolsFromThisFile = true;
                }
                if (shouldLookInNamespace) {
                    const nsNameParts = shouldLookInNamespace.getNameParts();
                    let nameSpaceTypeSofar: BscType;
                    let nsNameLookupTable = scope.symbolTable;
                    for (const namePart of nsNameParts) {
                        nameSpaceTypeSofar = nsNameLookupTable?.getSymbolType(namePart.text, { flags: symbolTableLookupFlag });
                        if (isNamespaceType(nameSpaceTypeSofar)) {
                            nsNameLookupTable = nameSpaceTypeSofar.getMemberTable();
                        } else {
                            break;
                        }
                    }
                    if (isNamespaceType(nameSpaceTypeSofar)) {
                        currentSymbols.push(...nameSpaceTypeSofar.getMemberTable().getAllSymbols(symbolTableLookupFlag));
                    }
                }

                currentSymbols.push(...this.getScopeSymbolCompletions(file, scope, symbolTableLookupFlag));

                // get global symbols
                if (!gotSymbolsFromGlobal) {
                    currentSymbols.push(...this.event.program.globalScope.symbolTable.getOwnSymbols(symbolTableLookupFlag));
                    if (symbolTableLookupFlag === SymbolTypeFlag.runtime) {
                        currentSymbols.push(...this.getGlobalValues());
                    }
                    gotSymbolsFromGlobal = true;
                }
            }

            let ignoreAllPropertyNames = false;

            // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
            switch (tokenBefore?.kind) {
                case TokenKind.New:
                    //we are after a new keyword; so we can only be namespaces that have a class or classes at this point
                    currentSymbols = currentSymbols.filter(symbol => isClassType(symbol.type) || this.isNamespaceTypeWithMemberType(symbol.type, isClassType));
                    ignoreAllPropertyNames = true;
                    break;
            }

            result.push(...this.getSymbolsCompletion(currentSymbols, shouldLookForMembers || shouldLookForCallFuncMembers));
            if (shouldLookForMembers && currentSymbols.length === 0 && !ignoreAllPropertyNames) {
                // could not find members of actual known types.. just try everything
                result.push(...this.getPropertyNameCompletions(scope),
                    ...this.getAllClassMemberCompletions(scope).values());
            } else if (shouldLookForCallFuncMembers && currentSymbols.length === 0) {
                // could not find members of actual known types.. just try everything
                result.push(...this.getCallFuncNameCompletions(scope));
            }
            scope.unlinkSymbolTable();
        }
        return result;
    }

    private getScopeSymbolCompletions(file: BrsFile, scope: Scope, symbolTableLookupFlag: SymbolTypeFlag) {
        // get all scope available symbols

        let scopeSymbols = file.parseMode === ParseMode.BrighterScript
            ? [...scope.symbolTable.getOwnSymbols(symbolTableLookupFlag), ...scope.allNamespaceTypeTable.getOwnSymbols(symbolTableLookupFlag)]
            : scope.symbolTable.getOwnSymbols(symbolTableLookupFlag);


        const scopeAvailableSymbols = scopeSymbols.filter(sym => {
            if (file.parseMode === ParseMode.BrighterScript) {
                // eslint-disable-next-line no-bitwise
                if (sym.flags & SymbolTypeFlag.postTranspile) {
                    // underscored symbols should not be available in Brighterscript files
                    return false;
                }
            } else if (file.parseMode === ParseMode.BrightScript) {
                if (isNamespaceType(sym.type)) {
                    return false;
                }
            }
            return true;
        });

        return scopeAvailableSymbols;
    }

    private getSymbolsCompletion(symbols: BscSymbol[], areMembers = false): CompletionItem[] {
        return symbols.map(symbol => {
            // if this is low priority, sort it at the end of the list
            const sortText = symbol.data?.completionPriority ? 'z'.repeat(symbol.data?.completionPriority) + symbol.name : undefined;
            return {
                label: symbol.name,
                kind: this.getCompletionKindFromSymbol(symbol, areMembers),
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
        return util.getNodeDocumentation(symbol.data?.definingNode);
    }


    private getCompletionKindFromSymbol(symbol: BscSymbol, areMembers = false) {
        const type = symbol?.type;
        const extraData = symbol?.data;
        const finalTypeNameLower = type?.toString().split('.').pop().toLowerCase();
        const symbolNameLower = symbol?.name.toLowerCase();
        let nameMatchesType = symbolNameLower === finalTypeNameLower;
        if (isConstStatement(extraData?.definingNode)) {
            return CompletionItemKind.Constant;
        } else if (isClassType(type) && nameMatchesType) {
            return CompletionItemKind.Class;
        } else if (isCallableType(type)) {
            if (isTypedFunctionType(type) && !nameMatchesType) {
                if (symbolNameLower === type.name.replaceAll('.', '_').toLowerCase()) {
                    nameMatchesType = true;
                }
            }
            if (nameMatchesType) {
                return areMembers ? CompletionItemKind.Method : CompletionItemKind.Function;
            }
        } else if (isInterfaceType(type) && nameMatchesType) {
            return CompletionItemKind.Interface;
        } else if (isEnumType(type) && nameMatchesType) {
            return CompletionItemKind.Enum;
        } else if (isEnumMemberType(type)) {
            return CompletionItemKind.EnumMember;
        } else if (isNamespaceType(type)) {
            return CompletionItemKind.Module;
        } else if (isComponentType(type) && (nameMatchesType || symbolNameLower === 'rosgnode')) {
            return CompletionItemKind.Interface;
        }
        if (areMembers) {
            return CompletionItemKind.Field;
        }
        const lowerSymbolName = symbol.name.toLowerCase();
        if (lowerSymbolName === 'true' ||
            lowerSymbolName === 'false' ||
            lowerSymbolName === 'invalid') {
            return CompletionItemKind.Value;

        }
        const tokenIdentifier = util.tokenToBscType(createIdentifier(symbol.name));
        if (isNativeType(tokenIdentifier)) {
            return CompletionItemKind.Keyword;

        }
        return CompletionItemKind.Variable;
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

    private isMemberAccessible(scope: Scope, member: BscSymbol, containingClassStmt: ClassStatement, containingNamespaceName: string): boolean {
        // eslint-disable-next-line no-bitwise
        const isPrivate = member.flags & SymbolTypeFlag.private;
        // eslint-disable-next-line no-bitwise
        const isProtected = member.flags & SymbolTypeFlag.protected;

        if (!containingClassStmt || !(isPrivate || isProtected)) {
            // not in a class - no private or protected members allowed
            return !(isPrivate || isProtected);
        }
        const containingClassName = containingClassStmt.getName(ParseMode.BrighterScript);
        const classStmtThatDefinedMember = member.data?.definingNode?.findAncestor<ClassStatement>(isClassStatement);
        if (isPrivate) {
            return containingClassStmt === classStmtThatDefinedMember;

        } else if (isProtected) {
            const ancestorClasses = scope.getClassHierarchy(containingClassName, containingNamespaceName).map(link => link.item);
            return ancestorClasses.includes(classStmtThatDefinedMember);
        }
        return true;
    }

    private getLabelCompletion(functionScope: FunctionScope) {
        return functionScope.labelStatements.map(label => ({
            label: label.name,
            kind: CompletionItemKind.Reference
        }));
    }

    public createCompletionFromFunctionStatement(statement: FunctionStatement): CompletionItem {
        const funcType = statement.getType({ flags: SymbolTypeFlag.runtime });
        return {
            label: statement.getName(ParseMode.BrighterScript),
            kind: CompletionItemKind.Function,
            detail: funcType.toString(),
            documentation: util.getNodeDocumentation(statement)
        };
    }

    private getStringLiteralCompletions(scope: Scope, currentToken: Token) {
        const match = /^("?)(pkg|libpkg):/.exec(currentToken.text);
        let result = [] as CompletionItem[];
        if (match) {
            // Get file path locations
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
            if (isBrsFile(file) && !filesSearched.has(file)) {
                // eslint-disable-next-line @typescript-eslint/dot-notation
                for (let cs of file['_cachedLookups'].classStatements) {
                    for (let s of [...cs.methods, ...cs.fields]) {
                        if (!results.has(s.tokens.name.text) && s.tokens.name.text.toLowerCase() !== 'new') {
                            results.set(s.tokens.name.text, {
                                label: s.tokens.name.text,
                                kind: isMethodStatement(s) ? CompletionItemKind.Method : CompletionItemKind.Field
                            });
                        }
                    }
                }
            }
            filesSearched.add(file);
        }
        return results;
    }

    /**
     * Scan all xmlScopes for call funcs
     */
    public getCallFuncNameCompletions(scope: Scope) {
        let completionsArray = [] as CompletionItem[];
        let completetionsLabels = [];
        const xmlScopes = this.event.program.getScopes().filter((s) => isXmlScope(s)) as XmlScope[];
        // is next to a @. callfunc invocation - must be an component interface method.


        //TODO refactor this to utilize the actual variable's component type (when available)
        for (const scope of xmlScopes) {
            let fileLinks = this.event.program.getStatementsForXmlFile(scope);
            for (let fileLink of fileLinks) {
                let pushItem = this.createCompletionFromFunctionStatement(fileLink.item);
                if (!completetionsLabels.includes(pushItem.label)) {
                    completetionsLabels.push(pushItem.label);
                    completionsArray.push(pushItem);
                }
            }
        }
        //no other result is possible in this case
        return completionsArray;
    }


    private getGlobalValues(): BscSymbol[] {
        return [
            {
                name: 'true',
                type: BooleanType.instance,
                flags: SymbolTypeFlag.runtime,
                data: {}
            },
            {
                name: 'false',
                type: BooleanType.instance,
                flags: SymbolTypeFlag.runtime,
                data: {}
            },
            {
                name: 'invalid',
                type: InvalidType.instance,
                flags: SymbolTypeFlag.runtime,
                data: {}
            }
        ];
    }

    private isPostionInComment(file: BrsFile, position: Position) {
        const currentToken = file.getCurrentOrNextTokenAt(position);
        const tokenKind = currentToken?.kind;
        if (!currentToken) {
            return true;
        }
        if (tokenKind === TokenKind.Comment) {
            return true;
        }

        const nextNonComment = file.getNextTokenByPredicate(currentToken, (t: Token) => !AllowedTriviaTokens.includes(t.kind), 1);
        const firstComment = nextNonComment?.leadingTrivia.find(t => t.kind === TokenKind.Comment);
        if (firstComment && util.comparePosition(position, firstComment?.range.start) >= 0) {
            return true;
        }
        return false;
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


/**
 * List of completions for all valid intrinsic types.
 * Build this list once because it won't change for the lifetime of this process
 */
export const NativeTypeCompletions = DeclarableTypes
    //create completions
    .map(x => {
        return {
            label: x.toLowerCase(),
            kind: CompletionItemKind.Keyword
        } as CompletionItem;
    });
