import { isBrsFile, isCallableType, isClassStatement, isConstStatement, isEnumStatement, isFieldStatement, isFunctionStatement, isMethodStatement, isXmlFile, isXmlScope } from '../../astUtils/reflection';
import type { BscFile, CallableContainer, FileLink, FileReference, ProvideCompletionsEvent } from '../../interfaces';
import { Keywords, TokenKind } from '../../lexer/TokenKind';
import type { XmlScope } from '../../XmlScope';
import { util } from '../../util';
import type { Scope } from '../../Scope';
import { ParseMode } from '../../parser/Parser';
import type { CompletionItem, Position } from 'vscode-languageserver';
import { CompletionItemKind, TextEdit } from 'vscode-languageserver';
import type { ClassStatement, FunctionStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { XmlFile } from '../../files/XmlFile';
import type { Program } from '../../Program';
import type { BrsFile } from '../../files/BrsFile';
import type { Token } from '../../lexer/Token';
import type { FunctionScope } from '../../FunctionScope';

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

        //a map of lower-case names of all added options
        let names = {} as Record<string, boolean>;

        //handle script import completions
        let scriptImport = util.getScriptImportAtPosition(file.ownScriptImports, position);
        if (scriptImport) {
            return this.getScriptImportCompletions(file.program, file.pkgPath, scriptImport);
        }

        //if cursor is within a comment, disable completions
        let currentToken = file.getTokenAt(position);
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

        const namespaceCompletions = this.getNamespaceCompletions(file, currentToken, scope);
        if (namespaceCompletions.length > 0) {
            return [...namespaceCompletions];
        }

        const enumMemberCompletions = this.getEnumMemberStatementCompletions(file, currentToken, scope);
        if (enumMemberCompletions.length > 0) {
            // no other completion is valid in this case
            return enumMemberCompletions;
        }

        //determine if cursor is inside a function
        let functionScope = file.getFunctionScopeAtPosition(position);
        const classNameCompletions = this.getGlobalClassStatementCompletions(file, currentToken, file.parseMode);
        if (!functionScope) {
            //we aren't in any function scope, so return the keyword completions and namespaces
            if (file.getTokenBefore(currentToken, TokenKind.New)) {
                // there's a new keyword, so only class types are viable here
                return [...classNameCompletions];
            } else {
                return [
                    ...KeywordCompletions,
                    ...classNameCompletions,
                    ...namespaceCompletions,
                    ...this.getNonNamespacedEnumStatementCompletions(file, currentToken, scope)
                ];
            }
        }

        const newToken = file.getTokenBefore(currentToken, TokenKind.New);
        if (newToken) {
            //we are after a new keyword; so we can only be top-level namespaces or classes at this point
            result.push(...classNameCompletions);
            result.push(...namespaceCompletions);
            return result;
        }

        if (file.tokenFollows(currentToken, TokenKind.Goto)) {
            return this.getLabelCompletion(functionScope);
        }

        if (file.isPositionNextToTokenKind(position, TokenKind.Dot)) {
            const selfClassMemberCompletions = this.getClassMemberCompletions(file, position, currentToken, functionScope, scope);
            if (selfClassMemberCompletions.size > 0) {
                return [...selfClassMemberCompletions.values()].filter((i) => i.label !== 'new');
            }

            if (!this.getClassFromMReference(file, position, currentToken, functionScope)) {
                //and anything from any class in scope to a non m class
                let classMemberCompletions = this.getAllClassMemberCompletions(scope);
                result.push(...classMemberCompletions.values());
                result.push(...this.getPropertyNameCompletions(scope).filter((i) => !classMemberCompletions.has(i.label)));
            } else {
                result.push(...this.getPropertyNameCompletions(scope));
            }
        } else {
            result.push(
                //include namespaces
                ...namespaceCompletions,
                //include class names
                ...classNameCompletions,
                //include enums
                ...this.getNonNamespacedEnumStatementCompletions(file, currentToken, scope),
                //include constants
                ...this.getNonNamespacedConstStatementCompletions(file, currentToken, scope),
                //include the global callables
                ...this.getCallablesAsCompletions(scope, file.parseMode)
            );

            //add `m` because that's always valid within a function
            result.push({
                label: 'm',
                kind: CompletionItemKind.Variable
            });
            names.m = true;

            result.push(...KeywordCompletions);

            //include local variables
            let variables = functionScope.variableDeclarations;
            for (let variable of variables) {
                //skip duplicate variable names
                if (names[variable.name.toLowerCase()]) {
                    continue;
                }
                names[variable.name.toLowerCase()] = true;
                result.push({
                    label: variable.name,
                    kind: isCallableType(variable.getType()) ? CompletionItemKind.Function : CompletionItemKind.Variable
                });
            }

            if (file.parseMode === ParseMode.BrighterScript) {
                //include the first part of namespaces
                let namespaces = scope.getAllNamespaceStatements();
                for (let stmt of namespaces) {
                    let firstPart = util.getAllDottedGetParts(stmt.nameExpression).shift().text;
                    //skip duplicate namespace names
                    if (names[firstPart.toLowerCase()]) {
                        continue;
                    }
                    names[firstPart.toLowerCase()] = true;
                    result.push({
                        label: firstPart,
                        kind: CompletionItemKind.Module
                    });
                }
            }
        }
        return result;
    }

    private getLabelCompletion(functionScope: FunctionScope) {
        return functionScope.labelStatements.map(label => ({
            label: label.name,
            kind: CompletionItemKind.Reference
        }));
    }

    private getClassMemberCompletions(file: BrsFile, position: Position, currentToken: Token, functionScope: FunctionScope, scope: Scope) {
        let classStatement = this.getClassFromMReference(file, position, currentToken, functionScope);
        let results = new Map<string, CompletionItem>();
        if (classStatement) {
            let classes = scope.getClassHierarchy(classStatement.item.getName(ParseMode.BrighterScript).toLowerCase());
            for (let cs of classes) {
                for (let member of [...cs?.item?.fields ?? [], ...cs?.item?.methods ?? []]) {
                    if (!results.has(member.name.text.toLowerCase())) {
                        results.set(member.name.text.toLowerCase(), {
                            label: member.name.text,
                            kind: isFieldStatement(member) ? CompletionItemKind.Field : CompletionItemKind.Function
                        });
                    }
                }
            }
        }
        return results;
    }

    public getClassFromMReference(file: BrsFile, position: Position, currentToken: Token, functionScope: FunctionScope): FileLink<ClassStatement> | undefined {
        let previousToken = file.getPreviousToken(currentToken);
        if (previousToken?.kind === TokenKind.Dot) {
            previousToken = file.getPreviousToken(previousToken);
        }
        if (previousToken?.kind === TokenKind.Identifier && previousToken?.text.toLowerCase() === 'm' && isMethodStatement(functionScope.func.functionStatement)) {
            return { item: file.parser.references.classStatements.find((cs) => util.rangeContains(cs.range, position)), file: file };
        }
        return undefined;
    }

    private getGlobalClassStatementCompletions(file: BrsFile, currentToken: Token, parseMode: ParseMode): CompletionItem[] {
        if (parseMode === ParseMode.BrightScript) {
            return [];
        }
        let results = new Map<string, CompletionItem>();
        let completionName = file.getPartialVariableName(currentToken, [TokenKind.New])?.toLowerCase();
        if (completionName?.includes('.')) {
            return [];
        }
        let scopes = file.program.getScopesForFile(file);
        for (let scope of scopes) {
            let classMap = scope.getClassMap();
            for (const key of [...classMap.keys()]) {
                let cs = classMap.get(key).item;
                if (!results.has(cs.name.text)) {
                    results.set(cs.name.text, {
                        label: cs.name.text,
                        kind: CompletionItemKind.Class
                    });
                }
            }
        }
        return [...results.values()];
    }

    private getNonNamespacedEnumStatementCompletions(file: BrsFile, currentToken: Token, scope: Scope): CompletionItem[] {
        if (file.parseMode !== ParseMode.BrighterScript) {
            return [];
        }
        const containingNamespaceName = file.getNamespaceStatementForPosition(currentToken?.range?.start)?.name + '.';
        const results = new Map<string, CompletionItem>();
        const enumMap = scope.getEnumMap();
        for (const key of [...enumMap.keys()]) {
            const enumStatement = enumMap.get(key).item;
            const fullName = enumStatement.fullName;
            //if the enum is contained within our own namespace, or if it's a non-namespaced enum
            if (fullName.startsWith(containingNamespaceName) || !fullName.includes('.')) {
                results.set(fullName, {
                    label: enumStatement.name,
                    kind: CompletionItemKind.Enum
                });
            }
        }
        return [...results.values()];
    }

    private getNonNamespacedConstStatementCompletions(file: BrsFile, currentToken: Token, scope: Scope): CompletionItem[] {
        if (file.parseMode !== ParseMode.BrighterScript) {
            return [];
        }
        const containingNamespaceName = file.getNamespaceStatementForPosition(currentToken?.range?.start)?.name + '.';
        const results = new Map<string, CompletionItem>();
        const map = scope.getConstMap();
        for (const key of [...map.keys()]) {
            const statement = map.get(key).item;
            const fullName = statement.fullName;
            //if the item is contained within our own namespace, or if it's non-namespaced
            if (fullName.startsWith(containingNamespaceName) || !fullName.includes('.')) {
                results.set(fullName, {
                    label: statement.name,
                    kind: CompletionItemKind.Constant
                });
            }
        }
        return [...results.values()];
    }

    private getEnumMemberStatementCompletions(file: BrsFile, currentToken: Token, scope: Scope): CompletionItem[] {
        if (file.parseMode === ParseMode.BrightScript || !currentToken) {
            return [];
        }
        const results = new Map<string, CompletionItem>();
        const completionName = file.getPartialVariableName(currentToken)?.toLowerCase();
        //if we don't have a completion name, or if there's no period in the name, then this is not to the right of an enum name
        if (!completionName || !completionName.includes('.')) {
            return [];
        }
        const enumNameLower = completionName?.split(/\.(\w+)?$/)[0]?.toLowerCase();
        const namespaceNameLower = file.getNamespaceStatementForPosition(currentToken.range.end)?.name.toLowerCase();
        const enumMap = scope.getEnumMap();
        //get the enum statement with this name (check without namespace prefix first, then with inferred namespace prefix next)
        const enumStatement = (enumMap.get(enumNameLower) ?? enumMap.get(namespaceNameLower + '.' + enumNameLower))?.item;
        //if we found an enum with this name
        if (enumStatement) {
            for (const member of enumStatement.getMembers()) {
                const name = enumStatement.fullName + '.' + member.name;
                const nameLower = name.toLowerCase();
                results.set(nameLower, {
                    label: member.name,
                    kind: CompletionItemKind.EnumMember
                });
            }
        }
        return [...results.values()];
    }

    private getNamespaceCompletions(file: BrsFile, currentToken: Token, scope: Scope): CompletionItem[] {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (file.parseMode === ParseMode.BrightScript) {
            return [];
        }

        const completionName = file.getPartialVariableName(currentToken, [TokenKind.New]);
        //if we don't have a completion name, or if there's no period in the name, then this is not a namespaced variable
        if (!completionName || !completionName.includes('.')) {
            return [];
        }
        //remove any trailing identifer and then any trailing dot, to give us the
        //name of its immediate parent namespace
        let closestParentNamespaceName = completionName.replace(/\.([a-z0-9_]*)?$/gi, '').toLowerCase();
        let newToken = file.getTokenBefore(currentToken, TokenKind.New);

        let result = new Map<string, CompletionItem>();
        for (let [, namespace] of scope.namespaceLookup) {
            //completionName = "NameA."
            //completionName = "NameA.Na
            //NameA
            //NameA.NameB
            //NameA.NameB.NameC
            if (namespace.fullNameLower === closestParentNamespaceName) {
                //add all of this namespace's immediate child namespaces, bearing in mind if we are after a new keyword
                for (let [, ns] of namespace.namespaces) {
                    if (!newToken || ns.statements.find((s) => isClassStatement(s))) {
                        if (!result.has(ns.lastPartName)) {
                            result.set(ns.lastPartName, {
                                label: ns.lastPartName,
                                kind: CompletionItemKind.Module
                            });
                        }
                    }
                }

                //add function and class statement completions
                for (let stmt of namespace.statements) {
                    if (isClassStatement(stmt)) {
                        result.set(stmt.name.text, {
                            label: stmt.name.text,
                            kind: CompletionItemKind.Class
                        });
                    } else if (isFunctionStatement(stmt) && !newToken) {
                        result.set(stmt.name.text, {
                            label: stmt.name.text,
                            kind: CompletionItemKind.Function
                        });
                    } else if (isEnumStatement(stmt) && !newToken) {
                        result.set(stmt.name, {
                            label: stmt.name,
                            kind: CompletionItemKind.Enum
                        });
                    } else if (isConstStatement(stmt) && !newToken) {
                        result.set(stmt.name, {
                            label: stmt.name,
                            kind: CompletionItemKind.Constant
                        });
                    }
                }
            }
        }
        return [...result.values()];
    }

    /**
     * Get all callables as completionItems
     */
    public getCallablesAsCompletions(scope: Scope, parseMode: ParseMode) {
        let completions = [] as CompletionItem[];
        let callables = scope.getAllCallables();

        if (parseMode === ParseMode.BrighterScript) {
            //throw out the namespaced callables (they will be handled by another method)
            callables = callables.filter(x => x.callable.hasNamespace === false);
        }

        for (let callableContainer of callables) {
            completions.push(this.createCompletionFromCallable(callableContainer));
        }
        return completions;
    }

    public createCompletionFromCallable(callableContainer: CallableContainer): CompletionItem {
        return {
            label: callableContainer.callable.getName(ParseMode.BrighterScript),
            kind: CompletionItemKind.Function,
            detail: callableContainer.callable.shortDescription,
            documentation: callableContainer.callable.documentation ? { kind: 'markdown', value: callableContainer.callable.documentation } : undefined
        };
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
