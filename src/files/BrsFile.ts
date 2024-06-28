import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Position, Location } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import chalk from 'chalk';
import * as path from 'path';
import { DiagnosticCodeMap, diagnosticCodes, DiagnosticLegacyCodeMap, DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import type { Callable, CallableParam, CommentFlag, BsDiagnostic, FileReference, FileLink, SerializedCodeFile, NamespaceContainer } from '../interfaces';
import type { Token } from '../lexer/Token';
import { Lexer } from '../lexer/Lexer';
import { TokenKind, AllowedLocalIdentifiers } from '../lexer/TokenKind';
import { Parser, ParseMode } from '../parser/Parser';
import type { FunctionExpression } from '../parser/Expression';
import type { ClassStatement, NamespaceStatement, MethodStatement, FieldStatement } from '../parser/Statement';
import type { Program } from '../Program';
import { DynamicType } from '../types/DynamicType';
import { standardizePath as s, util } from '../util';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { serializeError } from 'serialize-error';
import { isClassStatement, isDottedGetExpression, isFunctionExpression, isFunctionStatement, isNamespaceStatement, isVariableExpression, isImportStatement, isEnumStatement, isConstStatement, isAnyReferenceType, isNamespaceType, isReferenceType, isCallableType } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyChangedEvent, DependencyGraph } from '../DependencyGraph';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import type { AstNode, Expression } from '../parser/AstNode';
import { ReferencesProvider } from '../bscPlugin/references/ReferencesProvider';
import { DocumentSymbolProcessor } from '../bscPlugin/symbols/DocumentSymbolProcessor';
import { WorkspaceSymbolProcessor } from '../bscPlugin/symbols/WorkspaceSymbolProcessor';
import type { UnresolvedSymbol, AssignedSymbol } from '../AstValidationSegmenter';
import { AstValidationSegmenter } from '../AstValidationSegmenter';
import { LogLevel } from '../Logger';
import type { BscSymbol } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import type { BscFileLike } from '../astUtils/CachedLookups';
import { CachedLookups } from '../astUtils/CachedLookups';
import { Editor } from '../astUtils/Editor';
import { getBsConst } from '../preprocessor/Manifest';
import type { BscType } from '../types';
import { NamespaceType } from '../types';
import type { BscFile } from './BscFile';
import { DefinitionProvider } from '../bscPlugin/definition/DefinitionProvider';

export interface ProvidedSymbol {
    symbol: BscSymbol;
    duplicates: BscSymbol[];
}
export type ProvidedSymbolMap = Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>;
export type ChangedSymbolMap = Map<SymbolTypeFlag, Set<string>>;

export interface ProvidedSymbolInfo {
    symbolMap: ProvidedSymbolMap;
    changes: ChangedSymbolMap;
}

/**
 * Holds all details about this file within the scope of the whole program
 */
export class BrsFile implements BscFile {
    constructor(options: {
        /**
         * The path to the file in its source location (where the source code lives in the file system)
         */
        srcPath: string;
        /**
         * The path to the file where it should exist in the program. This is similar to pkgPath, but retains its original file extensions from srcPath
         */
        destPath: string;
        /**
         * The final path in the zip. This has the extensions changed. Typically this is the same as destPath, but with file extensions changed for transpiled files.
         */
        pkgPath?: string;
        program: Program;
    }) {
        if (options) {
            this.srcPath = s`${options.srcPath}`;
            this.destPath = s`${options.destPath}`;
            this.program = options.program;
            this._cachedLookups = new CachedLookups(this as unknown as BscFileLike);

            this.extension = util.getExtension(this.srcPath);
            if (options.pkgPath) {
                this.pkgPath = options.pkgPath;
            } else {
                //don't rename .d.bs files to .d.brs
                if (this.extension === '.d.bs') {
                    this.pkgPath = this.destPath;
                } else {
                    this.pkgPath = this.destPath.replace(/\.bs$/i, '.brs');
                }
            }

            //all BrighterScript files need to be transpiled
            if (this.extension?.endsWith('.bs') || this.program?.options?.allowBrighterScriptInBrightScript) {
                this.parseMode = ParseMode.BrighterScript;
            }
            this.isTypedef = this.extension === '.d.bs';
            if (!this.isTypedef) {
                this.typedefKey = util.getTypedefPath(this.srcPath);
            }

            //global file doesn't have a program, so only resolve typedef info if we have a program
            if (this.program) {
                this.resolveTypedef();
            }
        }
    }

    public type = 'BrsFile';

    public srcPath: string;
    public destPath: string;
    public pkgPath: string;

    public program: Program;

    private _cachedLookups: CachedLookups;

    /**
     * An editor assigned during the build flow that manages edits that will be undone once the build process is complete.
     */
    public editor?: Editor;

    /**
     * Will this file result in only comment or whitespace output? If so, it can be excluded from the output if that bsconfig setting is enabled.
     */
    public get canBePruned() {
        let canPrune = true;
        this.ast.walk(createVisitor({
            FunctionStatement: () => {
                canPrune = false;
            },
            ClassStatement: () => {
                canPrune = false;
            }
        }), {
            walkMode: WalkMode.visitStatements
        });
        return canPrune;
    }

    /**
     * The parseMode used for the parser for this file
     */
    public parseMode = ParseMode.BrightScript;

    /**
     * The key used to identify this file in the dependency graph. This is set by the BrighterScript program and should not be set by plugins
     */
    public dependencyGraphKey: string;

    /**
     * Indicates whether this file needs to be validated.
     * Files are only ever validated a single time
     */
    public isValidated = false;

    /**
     * The all-lowercase extension for this file (including the leading dot)
     */
    public extension: string;

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
     * files referenced by import statements
     */
    public get ownScriptImports() {
        const result = this.cache?.getOrAdd('BrsFile_ownScriptImports', () => {
            const result = [] as FileReference[];
            for (const statement of this._cachedLookups?.importStatements ?? []) {
                //register import statements
                if (isImportStatement(statement) && statement.tokens.path) {
                    result.push({
                        filePathRange: statement.tokens.path.location?.range,
                        destPath: util.getPkgPathFromTarget(this.destPath, statement.filePath),
                        sourceFile: this,
                        text: statement.tokens.path.text
                    });
                }
            }
            return result;
        }) ?? [];
        return result;
    }

    /**
     * Does this file need to be transpiled?
     * @deprecated use the `.editor` property to push changes to the file, which will force transpilation
     */
    public get needsTranspiled() {
        if (this._needsTranspiled !== undefined) {
            return this._needsTranspiled;
        }
        return !!(this.extension?.endsWith('.bs') || this.program?.options?.allowBrighterScriptInBrightScript || this.editor?.hasChanges);
    }
    public set needsTranspiled(value) {
        this._needsTranspiled = value;
    }
    public _needsTranspiled: boolean;

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
        const handle = new CancellationTokenSource();
        let containingNode: AstNode;
        this.ast.walk((node) => {
            const latestContainer = containingNode;
            //bsc walks depth-first
            if (util.rangeContains(node.location?.range, position)) {
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

    public get parser() {
        if (!this._parser) {
            //remove the typedef file (if it exists)
            this.hasTypedef = false;
            this.typedefFile = undefined;

            //parse the file (it should parse fully since there's no linked typedef
            this.parse(this.fileContents);

            //re-link the typedef (if it exists...which it should)
            this.resolveTypedef();
        }
        return this._parser;
    }
    private _parser: Parser;

    public fileContents: string;

    /**
     * If this is a typedef file
     */
    public isTypedef: boolean;

    /**
     * The key to find the typedef file in the program's files map.
     * A falsey value means this file is ineligable for a typedef
     */
    public typedefKey?: string;

    /**
     * If the file was given type definitions during parse
     */
    public hasTypedef;

    /**
     * A reference to the typedef file (if one exists)
     */
    public typedefFile?: BrsFile;

    /**
     * Find and set the typedef variables (if a matching typedef file exists)
     */
    private resolveTypedef() {
        this.typedefFile = this.program.getFile<BrsFile>(this.typedefKey);
        this.hasTypedef = !!this.typedefFile;
    }

    public onDependenciesChanged(event: DependencyChangedEvent) {
        this.resolveTypedef();
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     * @deprecated this does nothing. This functionality is now handled by the file api and will be deleted in v1
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) { }

    /**
     * The list of files that this file depends on
     */
    public get dependencies() {
        const result = this.ownScriptImports.filter(x => !!x.destPath).map(x => x.destPath.toLowerCase());

        //if this is a .brs file, watch for typedef changes
        if (this.extension === '.brs') {
            result.push(
                util.getTypedefPath(this.destPath)
            );
        }
        return result;
    }

    /**
     * Calculate the AST for this file
     * @param fileContents the raw source code to parse
     */
    public parse(fileContents: string) {
        const diagnostics = [];

        try {
            this.fileContents = fileContents;

            //if we have a typedef file, skip parsing this file
            if (this.hasTypedef) {
                //skip validation since the typedef is shadowing this file
                this.isValidated = true;
                return;
            }

            //tokenize the input file
            let lexer = this.program.logger.time('debug', ['lexer.lex', chalk.green(this.srcPath)], () => {
                return Lexer.scan(fileContents, {
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
                    bsConsts: getBsConst(this.program.getManifest())
                });
            });

            //absorb all lexing/preprocessing/parsing diagnostics
            diagnostics.push(
                ...lexer.diagnostics as BsDiagnostic[],
                ...this._parser.diagnostics as BsDiagnostic[]
            );

            //attach this file to every diagnostic
            for (let diagnostic of diagnostics) {
                diagnostic.file = this;
            }
        } catch (e) {
            this._parser = new Parser();
            diagnostics.push({
                file: this,
                range: util.createRange(0, 0, 0, Number.MAX_VALUE),
                ...DiagnosticMessages.genericParserMessage('Critical error parsing file: ' + JSON.stringify(serializeError(e)))
            });
        }
        this.program?.diagnostics.register(diagnostics);
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

        const scopes = this.program.getScopesForFile(this);
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
        const processor = new CommentFlagProcessor(this, ['rem', `'`], diagnosticCodes, [DiagnosticCodeMap.unknownDiagnosticCode, DiagnosticLegacyCodeMap.unknownDiagnosticCode]);

        this.commentFlags = [];
        for (let lexerToken of tokens) {
            for (let triviaToken of lexerToken.leadingTrivia ?? []) {
                if (triviaToken.kind === TokenKind.Comment) {
                    processor.tryAdd(triviaToken.text, triviaToken.location?.range);
                }
            }
        }
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
                        getType: () => DynamicType.instance //TODO: Infer types from array
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
                    file: this,
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
                for (const statement of this._cachedLookups.namespaceStatements) {
                    if (util.rangeContains(statement.location?.range, position)) {
                        return statement;
                    }
                }
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
     * Find the first scope that has a namespace with this name.
     * Returns false if no namespace was found with that name
     */
    public calleeStartsWithNamespace(callee: Expression) {
        let left = callee as AstNode;
        while (isDottedGetExpression(left)) {
            left = left.obj;
        }

        if (isVariableExpression(left)) {
            let lowerName = left.tokens.name.text.toLowerCase();
            //find the first scope that contains this namespace
            let scopes = this.program.getScopesForFile(this);
            for (let scope of scopes) {
                if (scope.namespaceLookup.has(lowerName)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Determine if the callee (i.e. function name) is a known function declared on the given namespace.
     */
    public calleeIsKnownNamespaceFunction(callee: Expression, namespaceName: string | undefined) {
        //if we have a variable and a namespace
        if (isVariableExpression(callee) && namespaceName) {
            let lowerCalleeName = callee?.tokens.name?.text?.toLowerCase();
            if (lowerCalleeName) {
                let scopes = this.program.getScopesForFile(this);
                for (let scope of scopes) {
                    let namespace = scope.namespaceLookup.get(namespaceName.toLowerCase());
                    if (!namespace) {
                        continue;
                    }
                    if (namespace.functionStatements.has(lowerCalleeName)) {
                        return true;
                    }
                    if (namespace.classStatements.has(lowerCalleeName)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Determine if the callee (i.e. function name) is a known function
     */
    public calleeIsKnownFunction(callee: Expression, namespaceName?: string) {
        //if we have a variable and a namespace
        if (isVariableExpression(callee)) {
            if (namespaceName) {
                return this.calleeIsKnownNamespaceFunction(callee, namespaceName);
            }
            let scopes = this.program.getScopesForFile(this);
            let lowerCalleeName = callee?.tokens.name?.text?.toLowerCase();
            for (let scope of scopes) {
                if (scope.getCallableByName(lowerCalleeName)) {
                    return true;
                }
                if (scope.getClass(lowerCalleeName)) {
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

    /**
     * Builds a list of document symbols for this file. Used by LanguageServer's onDocumentSymbol functionality
     * @deprecated use `DocumentSymbolProvider.process()` instead
     */
    public getDocumentSymbols() {
        return new DocumentSymbolProcessor({
            documentSymbols: [],
            file: this,
            program: this.program
        }).process();
    }

    /**
     * Builds a list of workspace symbols for this file. Used by LanguageServer's onWorkspaceSymbol functionality
     */
    public getWorkspaceSymbols() {
        return new WorkspaceSymbolProcessor({
            program: this.program,
            workspaceSymbols: []
        }).process();
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     * @deprecated use `DefinitionProvider.process()` instead
     */
    public getDefinition(position: Position): Location[] {
        return new DefinitionProvider({
            program: this.program,
            file: this,
            position: position,
            definitions: []
        }).process();
    }

    public getClassMemberDefinitions(textToSearchFor: string, file: BrsFile): Location[] {
        let results: Location[] = [];
        //get class fields and members
        const statementHandler = (statement: MethodStatement) => {
            if (statement.getName(file.parseMode).toLowerCase() === textToSearchFor) {
                results.push(util.createLocationFromRange(util.pathToUri(file.srcPath), statement.location?.range));
            }
        };
        const fieldStatementHandler = (statement: FieldStatement) => {
            if (statement.tokens.name.text.toLowerCase() === textToSearchFor) {
                results.push(util.createLocationFromRange(util.pathToUri(file.srcPath), statement.location?.range));
            }
        };
        file.parser.ast.walk(createVisitor({
            MethodStatement: statementHandler,
            FieldStatement: fieldStatementHandler
        }), {
            walkMode: WalkMode.visitStatements
        });

        return results;
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

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * look up all references of that identifier (every place that identifier is used across the whole app)
     * @deprecated use `ReferencesProvider.process()` instead
     */
    public getReferences(position: Position): Location[] {
        return new ReferencesProvider({
            program: this.program,
            file: this,
            position: position,
            references: []
        }).process();
    }

    /**
     * Generate the code, map, and typedef for this file
     */
    public serialize(): SerializedCodeFile {
        const result: SerializedCodeFile = {};

        const transpiled = this.transpile();
        if (typeof transpiled.code === 'string') {
            result.code = transpiled.code;
        }
        if (transpiled.map) {
            result.map = transpiled.map.toString();
        }
        //generate the typedef (if this is not a typedef itself, and if enabled)
        if (!this.isTypedef && this.program.options.emitDefinitions) {
            result.typedef = this.getTypedef();
        }
        return result;
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new BrsTranspileState(this);
        state.editor = this.editor ?? new Editor();
        let transpileResult: SourceNode | undefined;

        if (this.needsTranspiled) {
            const astTranspile = this.ast.transpile(state);
            const trailingComments = [];
            if (util.hasLeadingComments(this.parser.eofToken)) {
                if (util.isLeadingCommentOnSameLine(this.ast.statements[this.ast.statements.length - 1]?.location, this.parser.eofToken)) {
                    trailingComments.push(' ');
                } else {
                    trailingComments.push('\n');
                }
                trailingComments.push(...state.transpileLeadingComments(this.parser.eofToken));
            }

            transpileResult = util.sourceNodeFromTranspileResult(null, null, state.srcPath, [...astTranspile, ...trailingComments]);
        } else if (this.program.options.sourceMap) {
            //emit code as-is with a simple map to the original file location
            transpileResult = util.simpleMap(state.srcPath, this.fileContents);
        } else {
            //simple SourceNode wrapping the entire file to simplify the logic below
            transpileResult = new SourceNode(null, null, state.srcPath, this.fileContents);
        }

        //if we created an editor for this flow, undo the edits now
        if (!this.editor) {
            //undo any AST edits that the transpile cycle has made
            state.editor.undoAll();
        }

        if (this.program.options.sourceMap) {
            const stagingFileName = path.basename(state.srcPath).replace(/\.bs$/, '.brs');
            return new SourceNode(null, null, stagingFileName, [
                transpileResult,
                //add the sourcemap reference comment
                state.newline + `'//# sourceMappingURL=./${stagingFileName}.map`
            ]).toStringWithSourceMap({ file: stagingFileName });
        } else {
            return {
                code: transpileResult.toString(),
                map: undefined
            };
        }
    }

    public validationSegmenter = new AstValidationSegmenter(this);

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
        const nsTable = this.getNamespaceSymbolTable(false);
        this.linkSymbolTableDisposables.push(this.ast.symbolTable.addSibling(nsTable));

        this.validationSegmenter.processTree(this.ast);
        this.program.addFileSymbolInfo(this);
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
                    if (this.ast.getSymbolTable().hasSymbol(fullSymbolKey, flag)) {
                        //catches aliases
                        continue;
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
            const allAssignedSymbolsEntries = this.validationSegmenter.assignedTokensInSegment.entries() ?? [];

            let allAssignedSymbolsSet: AssignedSymbol[] = [];

            for (const [_segment, assignedSymbolSet] of allAssignedSymbolsEntries) {
                allAssignedSymbolsSet.push(...assignedSymbolSet.values());
            }
            return allAssignedSymbolsSet;
        });
    }

    private getProvidedSymbols() {
        const symbolMap = new Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>();
        const runTimeSymbolMap = new Map<string, ProvidedSymbol>();
        const typeTimeSymbolMap = new Map<string, ProvidedSymbol>();
        const referenceSymbolMap = new Map<SymbolTypeFlag, Map<string, ProvidedSymbol>>();
        const referenceRunTimeSymbolMap = new Map<string, ProvidedSymbol>();
        const referenceTypeTimeSymbolMap = new Map<string, ProvidedSymbol>();

        const tablesToGetSymbolsFrom: Array<{ table: SymbolTable; namePrefixLower?: string }> = [{
            table: this.parser.symbolTable
        }];

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
                    typeTimeSymbolMap.set(symbolNameLower, { symbol: symbol, duplicates: duplicates });
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
        const previouslyProvidedSymbols = this.program.getFileSymbolInfo(this)?.provides.symbolMap;
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
                        file: this,
                        fullName: loopName,
                        fullNameLower: lowerLoopName,
                        parentNameLower: parentNameLower,
                        nameParts: nameParts.slice(0, i),
                        nameRange: namespaceStatement.nameExpression.location?.range,
                        lastPartName: part.text,
                        lastPartNameLower: lowerPartName,
                        functionStatements: new Map(),
                        namespaceStatements: [],
                        namespaces: new Map(),
                        classStatements: new Map(),
                        enumStatements: new Map(),
                        constStatements: new Map(),
                        statements: [],
                        // the aggregate symbol table should have no parent. It should include just the symbols of the namespace.
                        symbolTable: new SymbolTable(`Namespace Aggregate: '${loopName}'`)
                    });
                }
            }
            let ns = namespaceLookup.get(lowerLoopName);
            ns.namespaceStatements.push(namespaceStatement);
            ns.statements.push(...namespaceStatement.body.statements);
            for (let statement of namespaceStatement.body.statements) {
                if (isClassStatement(statement) && statement.tokens.name) {
                    ns.classStatements.set(statement.tokens.name.text.toLowerCase(), statement);
                } else if (isFunctionStatement(statement) && statement.tokens.name) {
                    ns.functionStatements.set(statement.tokens.name.text.toLowerCase(), statement);
                } else if (isEnumStatement(statement) && statement.fullName) {
                    ns.enumStatements.set(statement.fullName.toLowerCase(), statement);
                } else if (isConstStatement(statement) && statement.fullName) {
                    ns.constStatements.set(statement.fullName.toLowerCase(), statement);
                }
            }
            // Merges all the symbol tables of the namespace statements into the new symbol table created above.
            // Set those symbol tables to have this new merged table as a parent
            ns.symbolTable.mergeSymbolTable(namespaceStatement.body.getSymbolTable());
        }
        return namespaceLookup;
    }

    public getTypedef() {
        const state = new BrsTranspileState(this);
        const typedef = this.ast.getTypedef(state);
        const programNode = util.sourceNodeFromTranspileResult(null, null, this.srcPath, typedef);
        return programNode.toString();
    }

    public dispose() {
        this._parser?.dispose();

        //deleting these properties result in lower memory usage (garbage collection is magic!)
        delete this.fileContents;
        delete this._parser;
        delete this._functionScopes;
        delete this.scopesByFunc;
    }
}
