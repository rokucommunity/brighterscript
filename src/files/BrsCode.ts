import type { CompletionItem, Position } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import chalk from 'chalk';
import { diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import type { NamespaceFileContribution } from '../Scope';
import { SymbolTable } from '../SymbolTable';
import { FunctionScope } from '../FunctionScope';
import type { Callable, CallableParam, CommentFlag, BsDiagnostic, FileReference, FileLink } from '../interfaces';
import type { NamespaceContainer } from '../Scope';
import type { Token } from '../lexer/Token';
import { Lexer } from '../lexer/Lexer';
import { TokenKind, AllowedLocalIdentifiers } from '../lexer/TokenKind';
import { Parser, ParseMode } from '../parser/Parser';
import type { FunctionExpression } from '../parser/Expression';
import type { ClassStatement, NamespaceStatement, MethodStatement } from '../parser/Statement';
import type { Program } from '../Program';
import { util } from '../util';
import { isClassStatement, isDottedGetExpression, isFunctionExpression, isNamespaceStatement, isVariableExpression, isImportStatement, isAnyReferenceType, isNamespaceType, isReferenceType, isCallableType, isFunctionStatement, isEnumStatement, isConstStatement } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import type { AstNode, Expression } from '../parser/AstNode';
import type { UnresolvedSymbol, AssignedSymbol } from '../AstValidationSegmenter';
import { AstValidationSegmenter } from '../AstValidationSegmenter';
import { LogLevel } from '../Logger';
import type { BscSymbol } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import type { BscFileLike } from '../astUtils/CachedLookups';
import { CachedLookups } from '../astUtils/CachedLookups';
import { getBsConst } from '../preprocessor/Manifest';
import type { BscType } from '../types';
import { NamespaceType } from '../types';
import type { BscFile } from './BscFile';
import type { BscCode } from './BscCode';
import type { BrsFile, ProvidedSymbol } from './BrsFile';

/**
 * A piece of BrightScript or BrighterScript code. This holds everything about the code itself (tokens, AST, symbols, callables, etc.),
 * while the file it lives in (its `document`) holds the paths, contents, dependencies and output.
 */
export class BrsCode implements BscCode {
    constructor(options: {
        /**
         * The file this code lives in
         */
        document: BscFile;
        program: Program;
        /**
         * The parse mode to use for this code
         */
        parseMode?: ParseMode;
        /**
         * Called when the parser is requested but this code has not been parsed yet (i.e. a `.brs` file whose parse was skipped because it has a typedef)
         */
        onParserRequested?: () => void;
    }) {
        this.document = options.document;
        this.program = options.program;
        this.parseMode = options.parseMode ?? ParseMode.BrightScript;
        this.onParserRequested = options.onParserRequested;
        this._cachedLookups = new CachedLookups(this as unknown as BscFileLike);
        this.validationSegmenter = new AstValidationSegmenter(this.file);
    }

    public type = 'BrsCode';

    /**
     * The file this code lives in
     */
    public document: BscFile;

    public program: Program;

    /**
     * The parseMode used for the parser for this code
     */
    public parseMode: ParseMode;

    private onParserRequested: () => void;

    /**
     * The document as a `BrsFile`. Many things outside of this class still identify code by its file
     * (callables, file links, symbol info, etc.), so this is what gets handed to them until they move to `BrsCode`.
     */
    private get file() {
        return this.document as BrsFile;
    }

    public get srcPath() {
        return this.document.srcPath;
    }

    public get destPath() {
        return this.document.destPath;
    }

    public get pkgPath() {
        return this.document.pkgPath;
    }

    private _cachedLookups: CachedLookups;

    /**
     * Indicates whether this code has been validated
     */
    public isValidated = false;

    public get parser() {
        if (!this._parser) {
            this.onParserRequested?.();
        }
        return this._parser;
    }
    private _parser: Parser;

    /**
     * Tokenize and parse this code
     * @param text the source code to parse
     */
    public parse(text: string) {
        const diagnostics = [] as Array<BsDiagnostic>;

        try {
            //tokenize the input file
            let lexer = this.program.logger.time('debug', ['lexer.lex', chalk.green(this.srcPath)], () => {
                return Lexer.scan(text, {
                    includeWhitespace: false,
                    srcPath: this.srcPath
                });
            });

            this.getCommentFlags(lexer.tokens);

            this.program.logger.time(LogLevel.debug, ['parser.parse', chalk.green(this.srcPath)], () => {
                this._parser = Parser.parse(lexer.tokens, {
                    srcPath: this.srcPath,
                    mode: this.parseMode,
                    logger: this.program.logger,
                    bsConsts: getBsConst(this.program.getManifest()),
                    minFirmwareVersion: this.program.options.minFirmwareVersion
                });
            });

            this._cachedLookups.invalidate();

            //absorb all lexing/preprocessing/parsing diagnostics
            diagnostics.push(
                ...lexer.diagnostics as BsDiagnostic[],
                ...this._parser.diagnostics as BsDiagnostic[]
            );


        } catch (e) {
            this._parser = new Parser();
            diagnostics.push({
                location: util.createLocationFromFileRange(this.document, util.createRange(0, 0, 0, Number.MAX_VALUE)),
                ...DiagnosticMessages.genericParserMessage('Critical error parsing file: ' + JSON.stringify(util.serializeError(e)))
            });
        }
        this.program?.diagnostics.registerParseDiagnostics(diagnostics);
    }

    public commentFlags = [] as CommentFlag[];

    private _functionScopes: FunctionScope[];

    public get functionScopes(): FunctionScope[] {
        if (!this._functionScopes) {
            this.createFunctionScopes();
        }
        return this._functionScopes;
    }

    private get cache() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        return this._cachedLookups['cache'];
    }

    /**
     * Return this file's per-namespace contributions. Cached on the file's parser-level
     * cache, so the result is invalidated automatically when the file re-parses.
     *
     * Each entry covers a single dotted name part (so a `namespace A.B.C` declaration
     * produces entries for `A`, `A.B`, and `A.B.C`). Intermediates carry only structural
     * fields; leaves populate the relevant statement collections plus a single-file
     * symbolTable. The symbolTable has no parent provider (see Phase 4 design notes).
     *
     * The returned Map is shared across every Scope that pulls in this file, which is
     * the core sharing primitive Phase 4 relies on.
     * @internal
     */
    protected getNamespaceContributions(): Map<string, NamespaceFileContribution> {
        return this.cache.getOrAdd('namespaceContributions', () => {
            let contributions = new Map<string, NamespaceFileContribution>();
            this.ast.walk(createVisitor({
                NamespaceStatement: namespaceStatement => {
                    const name = namespaceStatement.getName(ParseMode.BrighterScript);
                    const nameParts = name.split('.');
                    let loopName: string | null = null;
                    //ensure each dotted prefix has a contribution entry
                    for (const part of nameParts) {
                        loopName = loopName === null ? part : `${loopName}.${part}`;
                        const lowerLoopName = loopName.toLowerCase();
                        if (!contributions.has(lowerLoopName)) {
                            //explicitly assign every optional field as undefined so all
                            //NamespaceFileContribution instances share a single V8 hidden
                            //class. Subsequent `??=` assignments mutate values without
                            //changing the object shape, which keeps property access fast.
                            contributions.set(lowerLoopName, {
                                file: this.file,
                                fullName: loopName,
                                lastPartName: part,
                                nameRange: namespaceStatement.nameExpression.location?.range,
                                namespaceStatements: undefined,
                                statements: undefined,
                                classStatements: undefined,
                                functionStatements: undefined,
                                enumStatements: undefined,
                                constStatements: undefined,
                                symbolTable: undefined
                            });
                        }
                    }
                    //populate the leaf contribution from this namespaceStatement's body
                    const ns = contributions.get(name.toLowerCase())!;
                    (ns.namespaceStatements ??= []).push(namespaceStatement);
                    if (namespaceStatement.body.statements.length > 0) {
                        (ns.statements ??= []).push(...namespaceStatement.body.statements);
                    }
                    for (const statement of namespaceStatement.body.statements) {
                        if (isClassStatement(statement) && statement.tokens.name) {
                            (ns.classStatements ??= {})[statement.tokens.name.text.toLowerCase()] = statement;
                        } else if (isFunctionStatement(statement) && statement.tokens.name) {
                            (ns.functionStatements ??= {})[statement.tokens.name.text.toLowerCase()] = statement;
                        } else if (isEnumStatement(statement) && statement.fullName) {
                            (ns.enumStatements ??= new Map()).set(statement.fullName.toLowerCase(), statement);
                        } else if (isConstStatement(statement) && statement.fullName) {
                            (ns.constStatements ??= new Map()).set(statement.fullName.toLowerCase(), statement);
                        }
                    }
                    //single-file aggregate; NO parent provider (sibling resolution does not
                    //walk into a sibling's parent, so the previous scope-coupled provider
                    //was dead code)
                    ns.symbolTable ??= new SymbolTable(`Namespace File Contribution: '${ns.fullName}' in ${this.pkgPath}`);
                    ns.symbolTable.mergeSymbolTable(namespaceStatement.body.getSymbolTable());
                }
            }), {
                walkMode: WalkMode.visitStatements
            });

            return contributions;
        });
    }

    /**
     * files referenced by import statements
     */
    public get ownScriptImports() {
        const result = this.cache?.getOrAdd('ownScriptImports', () => {
            const result = [] as FileReference[];
            for (const statement of this._cachedLookups?.importStatements ?? []) {
                //register import statements
                if (isImportStatement(statement) && statement.tokens.path) {
                    result.push({
                        filePathRange: statement.tokens.path.location?.range,
                        destPath: util.getPkgPathFromTarget(this.destPath, statement.filePath),
                        sourceFile: this.file,
                        text: statement.tokens.path.text
                    });
                }
            }
            return result;
        }) ?? [];
        return result;
    }

    /**
     * The AST for this file
     */
    public get ast() {
        return this.parser?.ast;
    }

    /**
     * Get the token at the specified position
     */
    public getTokenAt(position: Position) {
        for (let token of this.parser.tokens) {
            if (util.rangeContains(token.location?.range, position)) {
                return token;
            }
        }
    }

    /**
     * Get the token at the specified position, or the next token
     */
    public getCurrentOrNextTokenAt(position: Position) {
        for (let token of this.parser.tokens) {
            if (util.comparePositionToRange(position, token.location?.range) < 0) {
                return token;
            }
        }
    }

    /**
     * Walk the AST and find the expression that this token is most specifically contained within
     */
    public getClosestExpression(position: Position) {
        if (typeof position?.line !== 'number') {
            return undefined;
        }
        const handle = new CancellationTokenSource();
        let containingNode: AstNode;
        this.ast.walk((node) => {
            const latestContainer = containingNode;
            //bsc walks depth-first
            if (node.location?.range && util.rangeContains(node.location?.range, position)) {
                containingNode = node;
            }
            //we had a match before, and don't now. this means we've finished walking down the whole way, and found our match
            if (latestContainer && !containingNode) {
                containingNode = latestContainer;
                handle.cancel();
            }
        }, {
            walkMode: WalkMode.visitAllRecursive,
            cancel: handle.token
        });
        return containingNode;
    }

    /**
     * Find a class. This scans all scopes for this file, and returns the first matching class that is found.
     * Returns undefined if not found.
     * @param className - The class name, including the namespace of the class if possible
     * @param containingNamespace - The namespace used to resolve relative class names. (i.e. the namespace around the current statement trying to find a class)
     * @returns the first class in the first scope found, or undefined if not found
     */
    public getClassFileLink(className: string, containingNamespace?: string): FileLink<ClassStatement> {
        const lowerClassName = className.toLowerCase();
        const lowerContainingNamespace = containingNamespace?.toLowerCase();

        const scopes = this.program.getScopesForFile(this.file);
        //find the first class in the first scope that has it
        for (let scope of scopes) {
            const cls = scope.getClassFileLink(lowerClassName, lowerContainingNamespace);
            if (cls) {
                return cls;
            }
        }
    }

    public findPropertyNameCompletions(): CompletionItem[] {
        //Build completion items from all the "properties" found in the file
        const { propertyHints } = this._cachedLookups;
        const results = [] as CompletionItem[];
        for (const key of Object.keys(propertyHints)) {
            results.push({
                label: propertyHints[key],
                kind: CompletionItemKind.Text
            });
        }
        return results;
    }

    private _propertyNameCompletions: CompletionItem[];

    public get propertyNameCompletions(): CompletionItem[] {
        if (!this._propertyNameCompletions) {
            this._propertyNameCompletions = this.findPropertyNameCompletions();
        }
        return this._propertyNameCompletions;
    }

    /**
     * Find all comment flags in the source code. These enable or disable diagnostic messages.
     * @param tokens - an array of tokens of which to find `TokenKind.Comment` from
     */
    public getCommentFlags(tokens: Token[]) {
        const processor = new CommentFlagProcessor(this.file, ['rem', `'`], diagnosticCodes);

        this.commentFlags = [];
        for (let lexerToken of tokens) {
            for (let triviaToken of lexerToken.leadingTrivia ?? []) {
                if (triviaToken.kind === TokenKind.Comment) {
                    processor.tryAdd(triviaToken.text, triviaToken.location?.range);
                }
            }
        }
        processor.finalize();
        this.commentFlags.push(...processor.commentFlags);
        this.program?.diagnostics.register(processor.diagnostics);
    }

    public scopesByFunc = new Map<FunctionExpression, FunctionScope>();

    /**
     * Create a scope for every function in this file
     */
    private createFunctionScopes() {
        //find every function
        let functions = this._cachedLookups.functionExpressions;

        //create a functionScope for every function
        this._functionScopes = [];

        for (let func of functions) {
            let scope = new FunctionScope(func);

            //find parent function, and add this scope to it if found
            {
                let parentScope = this.scopesByFunc.get(
                    func.findAncestor<FunctionExpression>(isFunctionExpression)
                );

                //add this child scope to its parent
                if (parentScope) {
                    parentScope.childrenScopes.push(scope);
                }
                //store the parent scope for this scope
                scope.parentScope = parentScope;
            }

            //add every parameter
            for (let param of func.parameters) {
                scope.variableDeclarations.push({
                    nameRange: param.tokens.name.location?.range,
                    lineIndex: param.tokens.name.location?.range?.start.line,
                    name: param.tokens.name.text,
                    getType: () => {
                        return param.getType({ flags: SymbolTypeFlag.typetime });
                    }
                });
            }

            //add all of ForEachStatement loop varibales
            func.body?.walk(createVisitor({
                ForEachStatement: (stmt) => {
                    scope.variableDeclarations.push({
                        nameRange: stmt.tokens.item.location?.range,
                        lineIndex: stmt.tokens.item.location?.range?.start.line,
                        name: stmt.tokens.item.text,
                        getType: () => stmt.getType({ flags: SymbolTypeFlag.runtime })
                    });
                },
                LabelStatement: (stmt) => {
                    const { name: identifier } = stmt.tokens;
                    scope.labelStatements.push({
                        nameRange: identifier.location?.range,
                        lineIndex: identifier.location?.range?.start.line,
                        name: identifier.text
                    });
                }
            }), {
                walkMode: WalkMode.visitStatements
            });

            this.scopesByFunc.set(func, scope);

            //find every statement in the scope
            this._functionScopes.push(scope);
        }

        //find every variable assignment in the whole file
        let assignmentStatements = this._cachedLookups.assignmentStatements;

        for (let statement of assignmentStatements) {

            //find this statement's function scope
            let scope = this.scopesByFunc.get(
                statement.findAncestor<FunctionExpression>(isFunctionExpression)
            );

            //skip variable declarations that are outside of any scope
            if (scope) {
                const variableName = statement.tokens.name;
                scope.variableDeclarations.push({
                    nameRange: variableName.location?.range,
                    lineIndex: variableName.location?.range?.start.line,
                    name: variableName.text,
                    getType: () => {
                        return statement.getType({ flags: SymbolTypeFlag.runtime });
                    }
                });
            }
        }
    }

    public staticCallables: Callable[];

    get callables(): Callable[] {

        if (this.staticCallables) {
            // globalFile can statically set the callables
            return this.staticCallables;
        }

        return this.cache.getOrAdd(`BrsFile_callables`, () => {
            const callables = [];

            for (let statement of this._cachedLookups.functionStatements ?? []) {

                //extract the parameters
                let params = [] as CallableParam[];
                for (let param of statement.func.parameters) {
                    const paramType = param.getType({ flags: SymbolTypeFlag.typetime });

                    let callableParam = {
                        name: param.tokens.name?.text,
                        type: paramType,
                        isOptional: !!param.defaultValue,
                        isRestArgument: false
                    };
                    params.push(callableParam);
                }
                const funcType = statement.getType({ flags: SymbolTypeFlag.typetime });
                callables.push({
                    isSub: statement.func.tokens.functionType?.text.toLowerCase() === 'sub',
                    name: statement.tokens.name?.text,
                    nameRange: statement.tokens.name?.location?.range,
                    file: this.file,
                    params: params,
                    range: statement.func.location?.range,
                    type: funcType,
                    getName: statement.getName.bind(statement),
                    hasNamespace: !!statement.findAncestor<NamespaceStatement>(isNamespaceStatement),
                    functionStatement: statement
                });
            }

            return callables;
        });


    }

    /**
     * Find the function scope at the given position.
     * @param position the position used to find the deepest scope that contains it
     */
    public getFunctionScopeAtPosition(position: Position): FunctionScope {
        return this.cache.getOrAdd(`functionScope-${position.line}:${position.character}`, () => {
            return this._getFunctionScopeAtPosition(position, this.functionScopes);
        });
    }

    public _getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope {
        if (!functionScopes) {
            functionScopes = this.functionScopes;
        }
        for (let scope of functionScopes) {
            if (util.rangeContains(scope.range, position)) {
                //see if any of that scope's children match the position also, and give them priority
                let childScope = this._getFunctionScopeAtPosition(position, scope.childrenScopes);
                if (childScope) {
                    return childScope;
                } else {
                    return scope;
                }
            }
        }
    }

    /**
     * Find the NamespaceStatement enclosing the given position
     */
    public getNamespaceStatementForPosition(position: Position): NamespaceStatement {
        if (position) {
            return this.cache.getOrAdd(`namespaceStatementForPosition-${position.line}:${position.character}`, () => {
                let mostSpecificNamespace: NamespaceStatement;
                for (const statement of this._cachedLookups.namespaceStatements) {
                    if (util.rangeContains(statement.location?.range, position)) {
                        if (mostSpecificNamespace) {
                            if (util.isRangeInRange(statement.location?.range, mostSpecificNamespace.location?.range)) {
                                mostSpecificNamespace = statement;
                            }
                        } else {
                            mostSpecificNamespace = statement;
                        }
                    }
                }
                return mostSpecificNamespace;
            });
        }
    }

    /**
     * Given a current token, walk
     */
    public getPartialVariableName(currentToken: Token, excludeTokens: TokenKind[] = null) {
        let identifierAndDotKinds = [TokenKind.Identifier, ...AllowedLocalIdentifiers, TokenKind.Dot];

        //consume tokens backwards until we find something other than a dot or an identifier
        let tokens = [];
        const parser = this.parser;
        for (let i = parser.tokens.indexOf(currentToken); i >= 0; i--) {
            currentToken = parser.tokens[i];
            if (identifierAndDotKinds.includes(currentToken.kind) && (!excludeTokens || !excludeTokens.includes(currentToken.kind))) {
                tokens.unshift(currentToken.text);
            } else {
                break;
            }
        }

        //if we found name and dot tokens, join them together to make the namespace name
        if (tokens.length > 0) {
            return tokens.join('');
        } else {
            return undefined;
        }
    }

    public isPositionNextToTokenKind(position: Position, tokenKind: TokenKind) {
        const closestToken = this.getClosestToken(position);
        return this.isTokenNextToTokenKind(closestToken, tokenKind);
    }

    public isTokenNextToTokenKind(closestToken: Token, tokenKind: TokenKind) {
        const previousToken = this.getPreviousToken(closestToken);
        const previousTokenKind = previousToken?.kind;
        //next to matched token
        if (!closestToken || closestToken.kind === TokenKind.Eof) {
            return false;
        } else if (closestToken.kind === tokenKind) {
            return true;
        } else if (closestToken.kind === TokenKind.Newline || previousTokenKind === TokenKind.Newline) {
            return false;
            //next to an identifier, which is next to token kind
        } else if (closestToken.kind === TokenKind.Identifier && previousTokenKind === tokenKind) {
            return true;
        } else {
            return false;
        }
    }

    public getTokenBefore(currentToken: Token, tokenKind?: TokenKind): Token {
        const index = this.parser.tokens.indexOf(currentToken);
        if (!tokenKind) {
            return this.parser.tokens[index - 1];
        }
        for (let i = index - 1; i >= 0; i--) {
            currentToken = this.parser.tokens[i];
            if (currentToken.kind === TokenKind.Newline) {
                break;
            } else if (currentToken.kind === tokenKind) {
                return currentToken;
            }
        }
        return undefined;
    }

    public tokenFollows(currentToken: Token, tokenKind: TokenKind): boolean {
        const index = this.parser.tokens.indexOf(currentToken);
        if (index > 0) {
            return this.parser.tokens[index - 1].kind === tokenKind;
        }
        return false;
    }

    public getTokensUntil(currentToken: Token, tokenKind: TokenKind, direction: -1 | 1 = 1) {
        let tokens = [];
        for (let i = this.parser.tokens.indexOf(currentToken); direction === -1 ? i >= 0 : i < this.parser.tokens.length; i += direction) {
            currentToken = this.parser.tokens[i];
            if (currentToken.kind === TokenKind.Newline || currentToken.kind === tokenKind) {
                break;
            }
            tokens.push(currentToken);
        }
        return tokens;
    }

    public getNextTokenByPredicate(currentToken: Token, test: (Token) => boolean, direction: -1 | 1 = 1) {
        for (let i = this.parser.tokens.indexOf(currentToken); direction === -1 ? i >= 0 : i < this.parser.tokens.length; i += direction) {
            currentToken = this.parser.tokens[i];
            if (test(currentToken)) {
                return currentToken;
            }
        }
        return undefined;
    }

    public getPreviousToken(token: Token) {
        const parser = this.parser;
        let idx = parser.tokens.indexOf(token);
        return parser.tokens[idx - 1];
    }

    /**
     * Finds the first scope for this file, then returns true if there's a namespace with this name.
     * Returns false if no namespace was found with that name
     */
    public calleeStartsWithNamespace(callee: Expression) {
        let left = callee as AstNode;
        while (isDottedGetExpression(left)) {
            left = left.obj;
        }

        if (isVariableExpression(left)) {
            const leftType = left.getType({ flags: SymbolTypeFlag.runtime });
            if (isNamespaceType(leftType)) {
                // this is a namespace, but it might be aliased. Look it up and see if it has the same name
                if (leftType.name.toLowerCase() === left.tokens?.name?.text?.toLowerCase()) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the token closest to the position. if no token is found, the previous token is returned
     */
    public getClosestToken(position: Position) {
        let tokens = this.parser.tokens;
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (util.rangeContains(token.location?.range, position)) {
                return token;
            }
            //if the position less than this token range, then this position touches no token,
            if (util.positionIsGreaterThanRange(position, token.location?.range) === false) {
                let t = tokens[i - 1];
                //return the token or the first token
                return t ? t : tokens[0];
            }
        }
        //return the last token
        return tokens[tokens.length - 1];
    }

    public getClassMethod(classStatement: ClassStatement, name: string, walkParents = true): MethodStatement | undefined {
        //TODO - would like to write this with getClassHieararchy; but got stuck on working out the scopes to use... :(
        let statement;
        const statementHandler = (e: MethodStatement) => {
            if (!statement && e.tokens.name.text.toLowerCase() === name.toLowerCase()) {
                statement = e;
            }
        };
        while (classStatement) {
            classStatement.walk(createVisitor({
                MethodStatement: statementHandler
            }), {
                walkMode: WalkMode.visitStatements
            });
            if (statement) {
                break;
            }
            if (walkParents && classStatement.parentClassName) {
                const nameParts = classStatement.parentClassName.getNameParts();
                classStatement = this.getClassFileLink(nameParts[nameParts.length - 1], nameParts.slice(0, -1).join('.'))?.item;
            } else {
                break;
            }

        }
        return statement;
    }

    public validationSegmenter: AstValidationSegmenter;

    public getNamespaceSymbolTable(allowCache = true) {
        if (!allowCache) {
            return this.constructNamespaceSymbolTable();
        }
        return this.cache?.getOrAdd(`namespaceSymbolTable`, () => this.constructNamespaceSymbolTable());
    }

    private constructNamespaceSymbolTable() {
        const nsTable = new SymbolTable(`File NamespaceTypes ${this.destPath}`, () => this.program?.globalScope.symbolTable);
        this.populateNameSpaceSymbolTable(nsTable);
        return nsTable;
    }

    public processSymbolInformation() {
        // Get namespaces across imported files
        this.program.logger.debug('Processing symbol information', this.srcPath);

        const nsTable = this.getNamespaceSymbolTable(false);
        this.linkSymbolTableDisposables.push(this.ast.symbolTable.addSibling(nsTable));
        this.validationSegmenter.processTree(this.ast);
        this.program.addFileSymbolInfo(this.file);
        this.unlinkNamespaceSymbolTables();
    }

    public unlinkNamespaceSymbolTables() {
        for (let disposable of this.linkSymbolTableDisposables) {
            disposable();
        }
        this.linkSymbolTableDisposables = [];
    }

    private linkSymbolTableDisposables = [];


    public populateNameSpaceSymbolTable(namespaceSymbolTable: SymbolTable) {
        //Add namespace aggregates to namespace member tables
        const namespaceTypesKnown = new Map<string, BscType>();
        // eslint-disable-next-line no-bitwise
        let getTypeOptions = { flags: SymbolTypeFlag.runtime | SymbolTypeFlag.typetime };
        for (const [nsName, nsContainer] of this.getNamespaceLookupObject()) {
            let currentNSType: BscType = null;
            let parentNSType: BscType = null;
            const existingNsStmt = nsContainer.namespaceStatements?.[0];

            if (!nsContainer.isTopLevel) {
                parentNSType = namespaceTypesKnown.get(nsContainer.parentNameLower);
                if (!parentNSType) {
                    // we don't know about the parent namespace... uh, oh!
                    this.program.logger.error(`Unable to find parent namespace type for namespace ${nsName}`);
                    break;
                }
                currentNSType = parentNSType.getMemberType(nsContainer.fullNameLower, getTypeOptions);
            } else {
                currentNSType = namespaceSymbolTable.getSymbolType(nsContainer.fullNameLower, getTypeOptions);
            }
            if (!isNamespaceType(currentNSType)) {
                if (!currentNSType || isReferenceType(currentNSType) || isCallableType(currentNSType)) {
                    currentNSType = existingNsStmt
                        ? existingNsStmt.getType(getTypeOptions)
                        : new NamespaceType(nsName);
                    if (parentNSType) {
                        // adding as a member of existing NS
                        parentNSType.addMember(nsContainer.lastPartName, { definingNode: existingNsStmt }, currentNSType, getTypeOptions.flags);
                    } else {
                        namespaceSymbolTable.addSymbol(nsContainer.lastPartName, { definingNode: existingNsStmt }, currentNSType, getTypeOptions.flags);
                    }
                } else {
                    // Something else already used the name this namespace is using.
                    continue;
                }
            } else {
                // Existing known namespace
            }
            if (!namespaceTypesKnown.has(nsName)) {
                namespaceTypesKnown.set(nsName, currentNSType);
            }
            currentNSType.memberTable.addSibling(nsContainer.symbolTable);
        }
    }

    public get requiredSymbols() {
        return this.cache.getOrAdd(`requiredSymbols`, () => {
            this.program.logger.debug('Getting required symbols', this.srcPath);

            const allNeededSymbolSets = this.validationSegmenter.unresolvedSegmentsSymbols.values();

            const requiredSymbols: UnresolvedSymbol[] = [];
            const addedSymbols = new Map<SymbolTypeFlag, Set<string>>();
            addedSymbols.set(SymbolTypeFlag.runtime, new Set());
            addedSymbols.set(SymbolTypeFlag.typetime, new Set());
            for (const setOfSymbols of allNeededSymbolSets) {
                for (const symbol of setOfSymbols) {
                    const fullSymbolKey = symbol.typeChain.map(tce => tce.name).join('.').toLowerCase();
                    const flag = symbol.endChainFlags;
                    if (this.providedSymbols.symbolMap.get(flag)?.has(fullSymbolKey)) {
                        // this catches namespaced things
                        continue;
                    }
                    const existingSymbol = this.ast.getSymbolTable().getSymbol(fullSymbolKey, flag);
                    if (existingSymbol?.length > 0) {
                        if (symbol[0]?.data?.isAlias) {
                            //catches aliases
                            continue;
                        }
                    }
                    if (!addedSymbols.get(flag)?.has(fullSymbolKey)) {
                        requiredSymbols.push(symbol);
                        addedSymbols.get(flag)?.add(fullSymbolKey);
                    }
                }
            }
            return requiredSymbols;
        });
    }

    public get providedSymbols() {
        return this.cache?.getOrAdd(`providedSymbols`, () => {
            return this.getProvidedSymbols();
        });
    }

    public get assignedSymbols() {
        return this.cache.getOrAdd(`assignedSymbols`, () => {
            const allAssignedSymbolsEntries = this.validationSegmenter.assignedTokensInSegment.entries() ?? ([] as Array<[AstNode, Set<AssignedSymbol>]>);

            let allAssignedSymbolsSet: AssignedSymbol[] = [];

            for (const [_segment, assignedSymbolSet] of allAssignedSymbolsEntries) {
                allAssignedSymbolsSet.push(...assignedSymbolSet.values());
            }
            return allAssignedSymbolsSet;
        });
    }

    private getProvidedSymbols() {
        this.program.logger.debug('Getting provided symbols', this.srcPath);

        const symbolMap = new Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>();
        const runTimeSymbolMap = new Map<string, ProvidedSymbol>();
        const typeTimeSymbolMap = new Map<string, ProvidedSymbol>();
        const referenceSymbolMap = new Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>();
        const referenceRunTimeSymbolMap = new Map<string, ProvidedSymbol>();
        const referenceTypeTimeSymbolMap = new Map<string, ProvidedSymbol>();

        const tablesToGetSymbolsFrom: Array<{ table: SymbolTable; namePrefixLower?: string }> = [
            { table: this.parser.symbolTable },
            ...this.parser.symbolTable.pocketTables
        ];

        for (const namespaceStatement of this._cachedLookups.namespaceStatements) {
            tablesToGetSymbolsFrom.push({
                table: namespaceStatement.body.getSymbolTable(),
                namePrefixLower: namespaceStatement.getName(ParseMode.BrighterScript).toLowerCase()
            });
        }

        function getAnyDuplicates(symbolNameLower: string, providedSymbolMap: Map<string, ProvidedSymbol>, referenceProvidedSymbolMap: Map<string, ProvidedSymbol>) {
            if (symbolNameLower === 'm') {
                return [];
            }
            let duplicates = [] as Array<BscSymbol>;
            let existingSymbol = providedSymbolMap.get(symbolNameLower);
            if (existingSymbol) {
                duplicates.push(existingSymbol.symbol, ...existingSymbol.duplicates);
            }
            existingSymbol = referenceProvidedSymbolMap.get(symbolNameLower);
            if (existingSymbol) {
                duplicates.push(existingSymbol.symbol, ...existingSymbol.duplicates);
            }

            return duplicates;
        }

        for (const symbolTable of tablesToGetSymbolsFrom) {
            const runTimeSymbols = symbolTable.table.getOwnSymbols(SymbolTypeFlag.runtime);
            const typeTimeSymbols = symbolTable.table.getOwnSymbols(SymbolTypeFlag.typetime);

            for (const symbol of runTimeSymbols) {
                const symbolNameLower = symbolTable.namePrefixLower
                    ? `${symbolTable.namePrefixLower}.${symbol.name.toLowerCase()}`
                    : symbol.name.toLowerCase();
                if (symbolNameLower === 'm') {
                    continue;
                }
                const duplicates = getAnyDuplicates(symbolNameLower, runTimeSymbolMap, referenceRunTimeSymbolMap);

                if (!isAnyReferenceType(symbol.type)) {
                    runTimeSymbolMap.set(symbolNameLower, { symbol: symbol, duplicates: duplicates });
                } else {
                    referenceRunTimeSymbolMap.set(symbolNameLower, { symbol: symbol, duplicates: duplicates });
                }
            }

            for (const symbol of typeTimeSymbols) {
                const symbolNameLower = symbolTable.namePrefixLower
                    ? `${symbolTable.namePrefixLower}.${symbol.name.toLowerCase()}`
                    : symbol.name.toLowerCase();
                if (symbolNameLower === 'm') {
                    continue;
                }

                const duplicates = getAnyDuplicates(symbolNameLower, typeTimeSymbolMap, referenceTypeTimeSymbolMap);
                if (!isAnyReferenceType(symbol.type)) {
                    const requiredSymbolTypes = new Set<BscType>();
                    util.getCustomTypesInSymbolTree(requiredSymbolTypes, symbol.type);
                    const requiredSymbolNames = new Set<string>();
                    for (const requiredType of requiredSymbolTypes.values()) {
                        requiredSymbolNames.add(requiredType.toString());
                    }
                    typeTimeSymbolMap.set(symbolNameLower, { symbol: symbol, duplicates: duplicates, requiredSymbolNames: requiredSymbolNames });
                } else {
                    referenceTypeTimeSymbolMap.set(symbolNameLower, { symbol: symbol, duplicates: duplicates });
                }
            }
        }

        symbolMap.set(SymbolTypeFlag.runtime, runTimeSymbolMap);
        symbolMap.set(SymbolTypeFlag.typetime, typeTimeSymbolMap);

        referenceSymbolMap.set(SymbolTypeFlag.runtime, referenceRunTimeSymbolMap);
        referenceSymbolMap.set(SymbolTypeFlag.typetime, referenceTypeTimeSymbolMap);

        const changes = new Map<SymbolTypeFlag, Set<string>>();
        changes.set(SymbolTypeFlag.runtime, new Set<string>());
        changes.set(SymbolTypeFlag.typetime, new Set<string>());
        const previouslyProvidedSymbols = this.program.getFileSymbolInfo(this.file)?.provides.symbolMap;
        const previousSymbolsChecked = new Map<SymbolTypeFlag, Set<string>>();
        previousSymbolsChecked.set(SymbolTypeFlag.runtime, new Set<string>());
        previousSymbolsChecked.set(SymbolTypeFlag.typetime, new Set<string>());

        for (const flag of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
            const newSymbolMapForFlag = symbolMap.get(flag);
            const oldSymbolMapForFlag = previouslyProvidedSymbols?.get(flag);
            const previousSymbolsCheckedForFlag = previousSymbolsChecked.get(flag);
            const changesForFlag = changes.get(flag);
            if (!oldSymbolMapForFlag) {
                for (const key of newSymbolMapForFlag.keys()) {
                    changesForFlag.add(key);
                }
                continue;

            }
            for (const [symbolKey, symbolObj] of newSymbolMapForFlag) {
                const symbolType = symbolObj.symbol.type;
                const previousType = oldSymbolMapForFlag?.get(symbolKey)?.symbol?.type;
                previousSymbolsCheckedForFlag.add(symbolKey);
                if (!previousType) {
                    changesForFlag.add(symbolKey);
                    continue;
                }
                const data = {};
                if (!symbolType.isEqual(previousType, data)) {
                    changesForFlag.add(symbolKey);
                }
            }
            for (const [symbolKey] of previouslyProvidedSymbols.get(flag)) {
                if (!previousSymbolsCheckedForFlag.has(symbolKey)) {
                    changesForFlag.add(symbolKey);
                }
            }
        }
        return {
            symbolMap: symbolMap,
            changes: changes,
            referenceSymbolMap: referenceSymbolMap
        };
    }

    public markSegmentAsValidated(node: AstNode) {
        this.validationSegmenter.markSegmentAsValidated(node);
    }

    public getNamespaceLookupObject() {
        if (!this.isValidated) {
            return this.buildNamespaceLookup();
        }
        return this.cache.getOrAdd(`namespaceLookup`, () => {
            const nsLookup = this.buildNamespaceLookup();
            return nsLookup;
        });
    }

    private buildNamespaceLookup() {
        const namespaceLookup = new Map<string, NamespaceContainer>();
        for (let namespaceStatement of this._cachedLookups.namespaceStatements) {
            let nameParts = namespaceStatement.getNameParts();

            let loopName: string = null;
            let lowerLoopName: string = null;
            let parentNameLower: string = null;

            //ensure each namespace section is represented in the results
            //(so if the namespace name is A.B.C, this will make an entry for "A", an entry for "A.B", and an entry for "A.B.C"
            for (let i = 0; i < nameParts.length; i++) {

                let part = nameParts[i];
                let lowerPartName = part.text.toLowerCase();

                if (i === 0) {
                    loopName = part.text;
                    lowerLoopName = lowerPartName;
                } else {
                    parentNameLower = lowerLoopName;
                    loopName += '.' + part.text;
                    lowerLoopName += '.' + lowerPartName;
                }
                if (!namespaceLookup.has(lowerLoopName)) {
                    namespaceLookup.set(lowerLoopName, {
                        isTopLevel: i === 0,
                        file: this.file,
                        fullName: loopName,
                        fullNameLower: lowerLoopName,
                        parentNameLower: parentNameLower,
                        nameParts: nameParts.slice(0, i),
                        nameRange: namespaceStatement.nameExpression.location?.range,
                        lastPartName: part.text,
                        lastPartNameLower: lowerPartName,
                        namespaceStatements: [],
                        // the aggregate symbol table should have no parent. It should include just the symbols of the namespace.
                        symbolTable: new SymbolTable(`Namespace File Aggregate: '${loopName}'`)
                    });
                }
            }
            let ns = namespaceLookup.get(lowerLoopName);
            ns.namespaceStatements.push(namespaceStatement);
            // Merges all the symbol tables of the namespace statements into the new symbol table created above.
            // Set those symbol tables to have this new merged table as a parent
            ns.symbolTable.mergeSymbolTable(namespaceStatement.body.getSymbolTable());
        }
        return namespaceLookup;
    }
    public dispose() {
        this._cachedLookups?.invalidate();
        this._parser?.dispose();

        //deleting these properties result in lower memory usage (garbage collection is magic!)
        delete this._parser;
        delete this._functionScopes;
        delete this.scopesByFunc;
    }
}
