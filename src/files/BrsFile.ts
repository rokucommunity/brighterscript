import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Position, Location, Diagnostic } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { CompletionItemKind, SymbolKind, DocumentSymbol, SymbolInformation } from 'vscode-languageserver';
import chalk from 'chalk';
import * as path from 'path';
import { DiagnosticCodeMap, diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import type { Callable, CallableArg, CallableParam, CommentFlag, FunctionCall, BsDiagnostic, FileReference, FileLink, SerializedCodeFile, NamespaceContainer } from '../interfaces';
import { type Token } from '../lexer/Token';
import { Lexer } from '../lexer/Lexer';
import { TokenKind, AllowedLocalIdentifiers } from '../lexer/TokenKind';
import { Parser, ParseMode } from '../parser/Parser';
import type { FunctionExpression, VariableExpression } from '../parser/Expression';
import type { ClassStatement, FunctionStatement, NamespaceStatement, MethodStatement, FieldStatement } from '../parser/Statement';
import type { Program } from '../Program';
import { DynamicType } from '../types/DynamicType';
import { standardizePath as s, util } from '../util';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { Preprocessor } from '../preprocessor/Preprocessor';
import { LogLevel } from '../Logger';
import { serializeError } from 'serialize-error';
import { isMethodStatement, isClassStatement, isDottedGetExpression, isFunctionStatement, isLiteralExpression, isNamespaceStatement, isStringType, isVariableExpression, isImportStatement, isFieldStatement, isFunctionExpression, isBrsFile, isEnumStatement, isConstStatement, isAnyReferenceType } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyGraph } from '../DependencyGraph';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import { URI } from 'vscode-uri';
import type { Statement, AstNode } from '../parser/AstNode';
import { type Expression } from '../parser/AstNode';
import type { BscSymbol } from '../SymbolTable';
import { SymbolTable, SymbolTypeFlag } from '../SymbolTable';
import type { BscFile } from './BscFile';
import { Editor } from '../astUtils/Editor';
import type { UnresolvedSymbol } from '../AstValidationSegmenter';
import { AstValidationSegmenter } from '../AstValidationSegmenter';
import type { BscFileLike } from '../astUtils/CachedLookups';
import { CachedLookups } from '../astUtils/CachedLookups';


export type ProvidedSymbolMap = Map<SymbolTypeFlag, Map<string, BscSymbol>>;
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


    /**
     * A collection of diagnostics related to this file
     */
    public diagnostics = [] as BsDiagnostic[];

    /**
     * @deprecated use `.diagnostics` instead
     */
    public getDiagnostics() {
        return this.diagnostics;
    }

    public addDiagnostic(diagnostic: Diagnostic & { file?: BscFile }) {
        if (!diagnostic.file) {
            diagnostic.file = this;
        }
        this.diagnostics.push(diagnostic as any);
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
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
     * files referenced by import statements
     */
    public get ownScriptImports() {
        const result = this.cache?.getOrAdd('BrsFile_ownScriptImports', () => {
            const result = [] as FileReference[];
            for (const statement of this._cachedLookups?.importStatements ?? []) {
                //register import statements
                if (isImportStatement(statement) && statement.tokens.filePath) {
                    result.push({
                        filePathRange: statement.tokens.filePath.range,
                        destPath: util.getPkgPathFromTarget(this.destPath, statement.filePath),
                        sourceFile: this,
                        text: statement.tokens.filePath.text
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

    private documentSymbols: DocumentSymbol[];

    private workspaceSymbols: SymbolInformation[];

    /**
     * Get the token at the specified position
     */
    public getTokenAt(position: Position) {
        for (let token of this.parser.tokens) {
            if (util.rangeContains(token.range, position)) {
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
            if (util.rangeContains(node.range, position)) {
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

    public onDependenciesChanged() {
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
        try {
            this.fileContents = fileContents;
            this.diagnostics = [];

            //if we have a typedef file, skip parsing this file
            if (this.hasTypedef) {
                //skip validation since the typedef is shadowing this file
                this.isValidated = true;
                return;
            }

            //tokenize the input file
            let lexer = this.program.logger.time(LogLevel.debug, ['lexer.lex', chalk.green(this.srcPath)], () => {
                return Lexer.scan(fileContents, {
                    includeWhitespace: false
                });
            });

            this.getCommentFlags(lexer.tokens);

            let preprocessor = new Preprocessor();

            //remove all code inside false-resolved conditional compilation statements.
            //TODO preprocessor should go away in favor of the AST handling this internally (because it affects transpile)
            //currently the preprocessor throws exceptions on syntax errors...so we need to catch it
            try {
                this.program.logger.time(LogLevel.debug, ['preprocessor.process', chalk.green(this.srcPath)], () => {
                    preprocessor.process(lexer.tokens, this.program.getManifest());
                });
            } catch (error: any) {
                //if the thrown error is DIFFERENT than any errors from the preprocessor, add that error to the list as well
                if (this.diagnostics.find((x) => x === error) === undefined) {
                    this.diagnostics.push(error);
                }
            }

            //if the preprocessor generated tokens, use them.
            let tokens = preprocessor.processedTokens.length > 0 ? preprocessor.processedTokens : lexer.tokens;

            this.program.logger.time(LogLevel.debug, ['parser.parse', chalk.green(this.srcPath)], () => {
                this._parser = Parser.parse(tokens, {
                    mode: this.parseMode,
                    logger: this.program.logger
                });
            });

            //absorb all lexing/preprocessing/parsing diagnostics
            this.diagnostics.push(
                ...lexer.diagnostics as BsDiagnostic[],
                ...preprocessor.diagnostics as BsDiagnostic[],
                ...this._parser.diagnostics as BsDiagnostic[]
            );

            //attach this file to every diagnostic
            for (let diagnostic of this.diagnostics) {
                diagnostic.file = this;
            }
        } catch (e) {
            this._parser = new Parser();
            this.diagnostics.push({
                file: this,
                range: util.createRange(0, 0, 0, Number.MAX_VALUE),
                ...DiagnosticMessages.genericParserMessage('Critical error parsing file: ' + JSON.stringify(serializeError(e)))
            });
        }
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
        const processor = new CommentFlagProcessor(this, ['rem', `'`], diagnosticCodes, [DiagnosticCodeMap.unknownDiagnosticCode]);

        this.commentFlags = [];
        for (let token of tokens) {
            if (token.kind === TokenKind.Comment) {
                processor.tryAdd(token.text, token.range);
            }
        }
        this.commentFlags.push(...processor.commentFlags);
        this.diagnostics.push(...processor.diagnostics);
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
                    nameRange: param.tokens.name.range,
                    lineIndex: param.tokens.name.range.start.line,
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
                        nameRange: stmt.tokens.item.range,
                        lineIndex: stmt.tokens.item.range.start.line,
                        name: stmt.tokens.item.text,
                        getType: () => DynamicType.instance //TODO: Infer types from array
                    });
                },
                LabelStatement: (stmt) => {
                    const { identifier } = stmt.tokens;
                    scope.labelStatements.push({
                        nameRange: identifier.range,
                        lineIndex: identifier.range.start.line,
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
                    nameRange: variableName.range,
                    lineIndex: variableName.range.start.line,
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
                    nameRange: statement.tokens.name?.range,
                    file: this,
                    params: params,
                    range: statement.func.range,
                    type: funcType,
                    getName: statement.getName.bind(statement),
                    hasNamespace: !!statement.findAncestor<NamespaceStatement>(isNamespaceStatement),
                    functionStatement: statement
                });
            }

            return callables;
        });


    }

    get functionCalls(): FunctionCall[] {
        return this.cache.getOrAdd(`BrsFile_functionCalls`, () => {
            const functionCalls = [];
            //for every function in the file
            for (let func of this._cachedLookups.functionExpressions) {
                //for all function calls in this function
                for (let expression of func.callExpressions) {
                    if (
                        //filter out dotted function invocations (i.e. object.doSomething()) (not currently supported. TODO support it)
                        (expression.callee as any).obj ||
                        //filter out method calls on method calls for now (i.e. getSomething().getSomethingElse())
                        (expression.callee as any).callee ||
                        //filter out callees without a name (immediately-invoked function expressions)
                        !(expression.callee as any).tokens?.name
                    ) {
                        continue;
                    }
                    //callee is the name of the function being called
                    let callee = expression.callee as VariableExpression;

                    let functionName = callee.tokens.name.text;
                    let columnIndexBegin = callee.range.start.character;
                    let columnIndexEnd = callee.range.end.character;

                    let args = [] as CallableArg[];
                    //TODO convert if stmts to use instanceof instead
                    for (let arg of expression.args as any) {

                        //is a literal parameter value
                        if (isLiteralExpression(arg)) {
                            args.push({
                                range: arg.range,
                                type: arg.getType(),
                                text: arg.tokens.value.text,
                                expression: arg,
                                typeToken: undefined
                            });

                            //is variable being passed into argument
                        } else if (arg.tokens?.name) {
                            args.push({
                                range: arg.range,
                                //TODO - look up the data type of the actual variable
                                type: new DynamicType(),
                                text: arg.tokens.name.text,
                                expression: arg,
                                typeToken: undefined
                            });

                        } else if (arg.value) {
                            let text = '';
                            /* istanbul ignore next: TODO figure out why value is undefined sometimes */
                            if (arg.value.value) {
                                text = arg.value.value.toString();
                            }
                            let callableArg = {
                                range: arg.range,
                                //TODO not sure what to do here
                                type: new DynamicType(), // util.valueKindToBrsType(arg.value.kind),
                                text: text,
                                expression: arg,
                                typeToken: undefined
                            };
                            //wrap the value in quotes because that's how it appears in the code
                            if (isStringType(callableArg.type)) {
                                callableArg.text = '"' + callableArg.text + '"';
                            }
                            args.push(callableArg);

                        } else {
                            args.push({
                                range: arg.range,
                                type: new DynamicType(),
                                //TODO get text from other types of args
                                text: '',
                                expression: arg,
                                typeToken: undefined
                            });
                        }
                    }
                    let functionCall: FunctionCall = {
                        range: expression.range,
                        functionScope: this.getFunctionScopeAtPosition(callee.range.start),
                        file: this,
                        name: functionName,
                        nameRange: util.createRange(callee.range.start.line, columnIndexBegin, callee.range.start.line, columnIndexEnd),
                        //TODO keep track of parameters
                        args: args,
                        expression: expression
                    };
                    functionCalls.push(functionCall);
                }
            }
            return functionCalls;
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
                    if (util.rangeContains(statement.range, position)) {
                        return statement;
                    }
                }
            });
        }
    }

    private getNamespaceDefinitions(token: Token, file: BrsFile): Location {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (!token) {
            return undefined;
        }
        let location;

        const nameParts = this.getPartialVariableName(token, [TokenKind.New]).split('.');
        const endName = nameParts[nameParts.length - 1].toLowerCase();
        const namespaceName = nameParts.slice(0, -1).join('.').toLowerCase();

        const statementHandler = (statement: NamespaceStatement) => {
            if (!location && statement.getName(ParseMode.BrighterScript).toLowerCase() === namespaceName) {
                const namespaceItemStatementHandler = (statement: ClassStatement | FunctionStatement) => {
                    if (!location && statement.tokens.name.text.toLowerCase() === endName) {
                        const uri = util.pathToUri(file.srcPath);
                        location = util.createLocation(uri, statement.range);
                    }
                };

                file.parser.ast.walk(createVisitor({
                    ClassStatement: namespaceItemStatementHandler,
                    FunctionStatement: namespaceItemStatementHandler
                }), {
                    walkMode: WalkMode.visitStatements
                });

            }
        };

        file.parser.ast.walk(createVisitor({
            NamespaceStatement: statementHandler
        }), {
            walkMode: WalkMode.visitStatements
        });

        return location;
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

    public getTokensUntil(currentToken: Token, tokenKind: TokenKind, direction: -1 | 1 = -1) {
        let tokens = [];
        for (let i = this.parser.tokens.indexOf(currentToken); direction === -1 ? i >= 0 : i === this.parser.tokens.length; i += direction) {
            currentToken = this.parser.tokens[i];
            if (currentToken.kind === TokenKind.Newline || currentToken.kind === tokenKind) {
                break;
            }
            tokens.push(currentToken);
        }
        return tokens;
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
        let left = callee as any;
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
    public calleeIsKnownNamespaceFunction(callee: Expression, namespaceName: string) {
        //if we have a variable and a namespace
        if (isVariableExpression(callee) && namespaceName) {
            let lowerCalleeName = callee?.tokens.name?.text?.toLowerCase();
            if (lowerCalleeName) {
                let scopes = this.program.getScopesForFile(this);
                for (let scope of scopes) {
                    let namespace = scope.namespaceLookup.get(namespaceName.toLowerCase());
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
            if (util.rangeContains(token.range, position)) {
                return token;
            }
            //if the position less than this token range, then this position touches no token,
            if (util.positionIsGreaterThanRange(position, token.range) === false) {
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
     */
    public getDocumentSymbols() {
        if (this.documentSymbols) {
            return this.documentSymbols;
        }

        let symbols = [] as DocumentSymbol[];

        for (const statement of this.ast.statements) {
            const symbol = this.getDocumentSymbol(statement);
            if (symbol) {
                symbols.push(symbol);
            }
        }
        this.documentSymbols = symbols;
        return symbols;
    }

    /**
     * Builds a list of workspace symbols for this file. Used by LanguageServer's onWorkspaceSymbol functionality
     */
    public getWorkspaceSymbols() {
        if (this.workspaceSymbols) {
            return this.workspaceSymbols;
        }

        let symbols = [] as SymbolInformation[];

        for (const statement of this.ast.statements) {
            for (const symbol of this.generateWorkspaceSymbols(statement)) {
                symbols.push(symbol);
            }
        }
        this.workspaceSymbols = symbols;
        return symbols;
    }

    /**
     * Builds a single DocumentSymbol object for use by LanguageServer's onDocumentSymbol functionality
     */
    private getDocumentSymbol(statement: Statement) {
        let symbolKind: SymbolKind;
        const children = [] as DocumentSymbol[];

        if (isFunctionStatement(statement)) {
            symbolKind = SymbolKind.Function;
        } else if (isMethodStatement(statement)) {
            symbolKind = SymbolKind.Method;
        } else if (isFieldStatement(statement)) {
            symbolKind = SymbolKind.Field;
        } else if (isNamespaceStatement(statement)) {
            symbolKind = SymbolKind.Namespace;
            for (const childStatement of statement.body.statements) {
                const symbol = this.getDocumentSymbol(childStatement);
                if (symbol) {
                    children.push(symbol);
                }
            }
        } else if (isClassStatement(statement)) {
            symbolKind = SymbolKind.Class;
            for (const childStatement of statement.body) {
                const symbol = this.getDocumentSymbol(childStatement);
                if (symbol) {
                    children.push(symbol);
                }
            }
        } else {
            return;
        }

        const name = isFieldStatement(statement) ? statement.tokens.name.text : statement.getName(ParseMode.BrighterScript);
        return DocumentSymbol.create(name, '', symbolKind, statement.range, statement.range, children);
    }

    /**
     * Builds a single SymbolInformation object for use by LanguageServer's onWorkspaceSymbol functionality
     */
    private generateWorkspaceSymbols(statement: Statement, containerStatement?: ClassStatement | NamespaceStatement) {
        let symbolKind: SymbolKind;
        const symbols = [];

        if (isFunctionStatement(statement)) {
            symbolKind = SymbolKind.Function;
        } else if (isMethodStatement(statement)) {
            symbolKind = SymbolKind.Method;
        } else if (isNamespaceStatement(statement)) {
            symbolKind = SymbolKind.Namespace;

            for (const childStatement of statement.body.statements) {
                for (const symbol of this.generateWorkspaceSymbols(childStatement, statement)) {
                    symbols.push(symbol);
                }
            }
        } else if (isClassStatement(statement)) {
            symbolKind = SymbolKind.Class;

            for (const childStatement of statement.body) {
                for (const symbol of this.generateWorkspaceSymbols(childStatement, statement)) {
                    symbols.push(symbol);
                }
            }
        } else {
            return symbols;
        }

        const name = statement.getName(ParseMode.BrighterScript);
        const uri = util.pathToUri(this.srcPath);
        const symbol = SymbolInformation.create(name, symbolKind, statement.range, uri, containerStatement?.getName(ParseMode.BrighterScript));
        symbols.push(symbol);
        return symbols;
    }

    /**
     * Given a position in a file, if the position is sitting on some type of identifier,
     * go to the definition of that identifier (where this thing was first defined)
     */
    public getDefinition(position: Position): Location[] {
        let results: Location[] = [];

        //get the token at the position
        const token = this.getTokenAt(position);

        // While certain other tokens are allowed as local variables (AllowedLocalIdentifiers: https://github.com/rokucommunity/brighterscript/blob/master/src/lexer/TokenKind.ts#L418), these are converted by the parser to TokenKind.Identifier by the time we retrieve the token using getTokenAt
        let definitionTokenTypes = [
            TokenKind.Identifier,
            TokenKind.StringLiteral
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !definitionTokenTypes.includes(token.kind)) {
            return results;
        }

        const scopesForFile = this.program.getScopesForFile(this);
        const [scope] = scopesForFile;

        const expression = this.getClosestExpression(position);
        if (scope && expression) {
            scope.linkSymbolTable();
            let containingNamespace = expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            const fullName = util.getAllDottedGetParts(expression)?.map(x => x.text).join('.');

            //find a constant with this name
            const constant = scope?.getConstFileLink(fullName, containingNamespace);
            if (constant) {
                results.push(
                    util.createLocation(
                        URI.file(constant.file.srcPath).toString(),
                        constant.item.tokens.name.range
                    )
                );
                return results;
            }

            if (isDottedGetExpression(expression) || isVariableExpression(expression)) {

                const enumLink = scope.getEnumFileLink(fullName, containingNamespace);
                if (enumLink) {
                    results.push(
                        util.createLocation(
                            URI.file(enumLink.file.srcPath).toString(),
                            enumLink.item.tokens.name.range
                        )
                    );
                    return results;
                }
                const enumMemberLink = scope.getEnumMemberFileLink(fullName, containingNamespace);
                if (enumMemberLink) {
                    results.push(
                        util.createLocation(
                            URI.file(enumMemberLink.file.srcPath).toString(),
                            enumMemberLink.item.tokens.name.range
                        )
                    );
                    return results;
                }

                const interfaceFileLink = scope.getInterfaceFileLink(fullName, containingNamespace);
                if (interfaceFileLink) {
                    results.push(
                        util.createLocation(
                            URI.file(interfaceFileLink.file.srcPath).toString(),
                            interfaceFileLink.item.tokens.name.range
                        )
                    );
                    return results;
                }

                const classFileLink = scope.getClassFileLink(fullName, containingNamespace);
                if (classFileLink) {
                    results.push(
                        util.createLocation(
                            URI.file(classFileLink.file.srcPath).toString(),
                            classFileLink.item.tokens.name.range
                        )
                    );
                    return results;
                }
            }
        }

        let textToSearchFor = token.text.toLowerCase();

        const previousToken = this.getTokenAt({ line: token.range.start.line, character: token.range.start.character });

        if (previousToken?.kind === TokenKind.Callfunc) {
            for (const scope of scopesForFile) {
                //to only get functions defined in interface methods
                const callable = scope.getAllCallables().find((c) => c.callable.name.toLowerCase() === textToSearchFor); // eslint-disable-line @typescript-eslint/no-loop-func
                if (callable) {
                    results.push(util.createLocation(util.pathToUri((callable.callable.file as BrsFile).srcPath), callable.callable.functionStatement.range));
                }
            }
            return results;
        }

        let classToken = this.getTokenBefore(token, TokenKind.Class);
        if (classToken) {
            let cs = this._cachedLookups.classStatements.find((cs) => cs.tokens.classKeyword.range === classToken.range);
            if (cs?.parentClassName) {
                const nameParts = cs.parentClassName.getNameParts();
                let extendedClass = this.getClassFileLink(nameParts[nameParts.length - 1], nameParts.slice(0, -1).join('.'));
                if (extendedClass) {
                    results.push(util.createLocation(util.pathToUri(extendedClass.file.srcPath), extendedClass.item.range));
                }
            }
            return results;
        }

        if (token.kind === TokenKind.StringLiteral) {
            // We need to strip off the quotes but only if present
            const startIndex = textToSearchFor.startsWith('"') ? 1 : 0;

            let endIndex = textToSearchFor.length;
            if (textToSearchFor.endsWith('"')) {
                endIndex--;
            }
            textToSearchFor = textToSearchFor.substring(startIndex, endIndex);
        }

        //look through local variables first, get the function scope for this position (if it exists)
        const functionScope = this.getFunctionScopeAtPosition(position);
        if (functionScope) {
            //find any variable or label with this name
            for (const varDeclaration of functionScope.variableDeclarations) {
                //we found a variable declaration with this token text!
                if (varDeclaration.name.toLowerCase() === textToSearchFor) {
                    const uri = util.pathToUri(this.srcPath);
                    results.push(util.createLocation(uri, varDeclaration.nameRange));
                }
            }
            if (this.tokenFollows(token, TokenKind.Goto)) {
                for (const label of functionScope.labelStatements) {
                    if (label.name.toLocaleLowerCase() === textToSearchFor) {
                        const uri = util.pathToUri(this.srcPath);
                        results.push(util.createLocation(uri, label.nameRange));
                    }
                }
            }
        }

        const filesSearched = new Set<BrsFile>();
        //look through all files in scope for matches
        for (const scope of scopesForFile) {
            for (const file of scope.getAllFiles()) {
                if (isBrsFile(file) && !filesSearched.has(file)) {
                    filesSearched.add(file);

                    if (previousToken?.kind === TokenKind.Dot && file.parseMode === ParseMode.BrighterScript) {
                        results.push(...this.getClassMemberDefinitions(textToSearchFor, file));
                        const namespaceDefinition = this.getNamespaceDefinitions(token, file);
                        if (namespaceDefinition) {
                            results.push(namespaceDefinition);
                        }
                    }
                    const statementHandler = (statement: FunctionStatement) => {
                        if (statement.getName(this.parseMode).toLowerCase() === textToSearchFor) {
                            const uri = util.pathToUri(file.srcPath);
                            results.push(util.createLocation(uri, statement.range));
                        }
                    };

                    file.parser.ast.walk(createVisitor({
                        FunctionStatement: statementHandler
                    }), {
                        walkMode: WalkMode.visitStatements
                    });
                }
            }
        }
        return results;
    }

    public getClassMemberDefinitions(textToSearchFor: string, file: BrsFile): Location[] {
        let results: Location[] = [];
        //get class fields and members
        const statementHandler = (statement: MethodStatement) => {
            if (statement.getName(file.parseMode).toLowerCase() === textToSearchFor) {
                results.push(util.createLocation(util.pathToUri(file.srcPath), statement.range));
            }
        };
        const fieldStatementHandler = (statement: FieldStatement) => {
            if (statement.tokens.name.text.toLowerCase() === textToSearchFor) {
                results.push(util.createLocation(util.pathToUri(file.srcPath), statement.range));
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

    public getReferences(position: Position) {

        const callSiteToken = this.getTokenAt(position);

        let locations = [] as Location[];

        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.program.getScopesForFile(this);

        for (const scope of scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (isBrsFile(file) && !processedFiles.has(file)) {
                    processedFiles.add(file);
                    file.ast.walk(createVisitor({
                        VariableExpression: (e) => {
                            if (e.tokens.name.text.toLowerCase() === searchFor) {
                                locations.push(util.createLocation(util.pathToUri(file.srcPath), e.range));
                            }
                        }
                    }), {
                        walkMode: WalkMode.visitExpressionsRecursive
                    });
                }
            }
        }
        return locations;
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
            transpileResult = new SourceNode(null, null, state.srcPath, this.ast.transpile(state));
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
            return new SourceNode(null, null, null, [
                transpileResult,
                //add the sourcemap reference comment
                `'//# sourceMappingURL=./${path.basename(state.srcPath)}.map`
            ]).toStringWithSourceMap();
        } else {
            return {
                code: transpileResult.toString(),
                map: undefined
            };
        }
    }

    public validationSegmenter = new AstValidationSegmenter();

    public processSymbolInformation() {
        this.validationSegmenter.processTree(this.ast);
        this.program.addFileSymbolInfo(this);
    }

    public getValidationSegments(changedSymbols: Map<SymbolTypeFlag, Set<string>>) {
        const segments = this.validationSegmenter.getSegments(changedSymbols);
        return segments;
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
                    for (const flag of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
                        // eslint-disable-next-line no-bitwise
                        if (symbol.flags & flag) {
                            if (this.providedSymbols.symbolMap.get(flag)?.has(fullSymbolKey)) {
                                // this catches namespaced things
                                continue;
                            }
                            if (!addedSymbols.get(flag)?.has(fullSymbolKey)) {
                                requiredSymbols.push(symbol);
                                addedSymbols.get(flag)?.add(fullSymbolKey);
                            }
                        }
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

    private getProvidedSymbols() {
        const symbolMap = new Map<SymbolTypeFlag, Map<string, BscSymbol>>();
        const runTimeSymbolMap = new Map<string, BscSymbol>();
        const typeTimeSymbolMap = new Map<string, BscSymbol>();

        const tablesToGetSymbolsFrom: Array<{ table: SymbolTable; namePrefixLower?: string }> = [{
            table: this.parser.symbolTable
        }];

        for (const namespaceStatement of this._cachedLookups.namespaceStatements) {
            tablesToGetSymbolsFrom.push({
                table: namespaceStatement.body.getSymbolTable(),
                namePrefixLower: namespaceStatement.getName(ParseMode.BrighterScript).toLowerCase()
            });
        }

        for (const symbolTable of tablesToGetSymbolsFrom) {
            const runTimeSymbols = symbolTable.table.getOwnSymbols(SymbolTypeFlag.runtime);
            const typeTimeSymbols = symbolTable.table.getOwnSymbols(SymbolTypeFlag.typetime);

            for (const symbol of runTimeSymbols) {
                if (!isAnyReferenceType(symbol.type)) {
                    const symbolNameLower = symbolTable.namePrefixLower
                        ? `${symbolTable.namePrefixLower}.${symbol.name.toLowerCase()}`
                        : symbol.name.toLowerCase();
                    runTimeSymbolMap.set(symbolNameLower, symbol);
                }
            }

            for (const symbol of typeTimeSymbols) {
                if (!isAnyReferenceType(symbol.type)) {
                    const symbolNameLower = symbolTable.namePrefixLower
                        ? `${symbolTable.namePrefixLower}.${symbol.name.toLowerCase()}`
                        : symbol.name.toLowerCase();
                    typeTimeSymbolMap.set(symbolNameLower, symbol);
                }
            }
        }

        symbolMap.set(SymbolTypeFlag.runtime, runTimeSymbolMap);
        symbolMap.set(SymbolTypeFlag.typetime, typeTimeSymbolMap);

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
            for (const [symbolKey, symbol] of newSymbolMapForFlag) {
                const symbolType = symbol.type;
                const previousType = oldSymbolMapForFlag?.get(symbolKey)?.type;
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
            changes: changes
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
                        nameRange: namespaceStatement.nameExpression.range,
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
        const programNode = new SourceNode(null, null, this.srcPath, typedef);
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
