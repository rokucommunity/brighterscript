import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Hover, Position } from 'vscode-languageserver';
import { CompletionItemKind, SymbolKind, Location, SignatureInformation, ParameterInformation, DocumentSymbol, SymbolInformation, TextEdit } from 'vscode-languageserver';
import chalk from 'chalk';
import * as path from 'path';
import type { NamespaceContainer, Scope } from '../Scope';
import { DiagnosticCodeMap, diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import type { Callable, CallableArg, CommentFlag, FunctionCall, BsDiagnostic, FileReference, FileLink } from '../interfaces';
import type { Token } from '../lexer/Token';
import { isToken } from '../lexer/Token';
import { Lexer } from '../lexer/Lexer';
import { TokenKind, AllowedLocalIdentifiers, Keywords } from '../lexer/TokenKind';
import type { TokenChainMember } from '../parser/Parser';
import { Parser, ParseMode, getBscTypeFromExpression, TokenUsage } from '../parser/Parser';
import type { FunctionExpression, VariableExpression, Expression, DottedGetExpression } from '../parser/Expression';
import type { ClassStatement, FunctionStatement, NamespaceStatement, ClassMethodStatement, LibraryStatement, ImportStatement, Statement, ClassFieldStatement } from '../parser/Statement';
import type { Program, SignatureInfoObj } from '../Program';
import { DynamicType } from '../types/DynamicType';
import { standardizePath as s, util } from '../util';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { Preprocessor } from '../preprocessor/Preprocessor';
import { LogLevel } from '../Logger';
import { serializeError } from 'serialize-error';
import { isClassMethodStatement, isClassStatement, isCommentStatement, isDottedGetExpression, isFunctionStatement, isFunctionType, isLibraryStatement, isNamespaceStatement, isStringType, isVariableExpression, isXmlFile, isImportStatement, isClassFieldStatement, isEnumStatement, isArrayType, isCustomType, isDynamicType, isObjectType, isPrimitiveType, isRegexLiteralExpression, isUniversalFunctionType } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyGraph } from '../DependencyGraph';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import type { BscType, SymbolContainer } from '../types/BscType';
import { getTypeFromContext } from '../types/BscType';
import { UninitializedType } from '../types/UninitializedType';
import { InvalidType } from '../types/InvalidType';
import type { SymbolTable } from '../SymbolTable';

/**
 * Holds all details about this file within the scope of the whole program
 */
export class BrsFile {
    constructor(
        /**
         * The absolute path to the source file on disk (e.g. '/usr/you/projects/RokuApp/source/main.brs' or 'c:/projects/RokuApp/source/main.brs').
         */
        public srcPath: string,
        /**
         * The full pkg path (i.e. `pkg:/path/to/file.brs`)
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.srcPath = s`${this.srcPath}`;
        this.dependencyGraphKey = this.pkgPath.toLowerCase();

        this.extension = util.getExtension(this.srcPath);

        //all BrighterScript files need to be transpiled
        if (this.extension?.endsWith('.bs')) {
            this.needsTranspiled = true;
            this.parseMode = ParseMode.BrighterScript;
        }
        this.isTypedef = this.extension === '.d.bs';
        if (!this.isTypedef) {
            this.typedefSrcPath = util.getTypedefPath(this.srcPath);
        }

        //global file doesn't have a program, so only resolve typedef info if we have a program
        if (this.program) {
            this.resolveTypedef();
        }
    }

    /**
     * The parseMode used for the parser for this file
     */
    public parseMode = ParseMode.BrightScript;

    /**
     * The key used to identify this file in the dependency graph
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

    private diagnostics = [] as BsDiagnostic[];

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public addDiagnostics(diagnostics: BsDiagnostic[]) {
        this.diagnostics.push(...diagnostics);
    }

    public commentFlags = [] as CommentFlag[];

    public callables = [] as Callable[];

    public functionCalls = [] as FunctionCall[];

    /**
     * files referenced by import statements
     */
    public ownScriptImports = [] as FileReference[];

    /**
     * Does this file need to be transpiled?
     */
    public needsTranspiled = false;

    /**
     * The AST for this file
     */
    public get ast() {
        return this.parser.ast;
    }

    private documentSymbols: DocumentSymbol[];

    private workspaceSymbols: SymbolInformation[];

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
     * The srcPath to the potential typedef file for this file.
     * A falsey value means this file is ineligable for a typedef
     */
    public typedefSrcPath?: string;

    /**
     * If the file was given type definitions during parse
     */
    public hasTypedef;

    /**
     * A reference to the typedef file (if one exists)
     */
    public typedefFile?: BrsFile;

    /**
     * An unsubscribe function for the dependencyGraph subscription
     */
    private unsubscribeFromDependencyGraph: () => void;

    /**
     * Find and set the typedef variables (if a matching typedef file exists)
     */
    private resolveTypedef() {
        this.typedefFile = this.program.getFile<BrsFile>(this.typedefSrcPath);
        this.hasTypedef = !!this.typedefFile;
    }

    /**
     * Attach the file to the dependency graph so it can monitor changes.
     * Also notify the dependency graph of our current dependencies so other dependents can be notified.
     */
    public attachDependencyGraph(dependencyGraph: DependencyGraph) {
        if (this.unsubscribeFromDependencyGraph) {
            this.unsubscribeFromDependencyGraph();
        }

        //event that fires anytime a dependency changes
        this.unsubscribeFromDependencyGraph = dependencyGraph.onchange(this.dependencyGraphKey, () => {
            this.resolveTypedef();
        });

        const dependencies = this.ownScriptImports.filter(x => !!x.pkgPath).map(x => x.pkgPath.toLowerCase());

        //if this is a .brs file, watch for typedef changes
        if (this.extension === '.brs') {
            dependencies.push(
                util.getTypedefPath(this.pkgPath)
            );
        }
        dependencyGraph.addOrReplace(this.dependencyGraphKey, dependencies);
    }

    /**
     * Calculate the AST for this file
     * @param fileContents
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

            //extract all callables from this file
            this.findCallables();

            //find all places where a sub/function is being called
            this.findFunctionCalls();

            //register all import statements for use in the rest of the program
            this.registerImports();

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

    private registerImports() {
        for (const statement of this.parser?.references?.importStatements ?? []) {
            //register import statements
            if (isImportStatement(statement) && statement.filePathToken) {
                this.ownScriptImports.push({
                    filePathRange: statement.filePathToken.range,
                    pkgPath: util.getPkgPathFromTarget(this.pkgPath, statement.filePath),
                    sourceFile: this,
                    text: statement.filePathToken?.text
                });
            }
        }
    }

    public validate() {
        //only validate the file if it was actually parsed (skip files containing typedefs)
        if (!this.hasTypedef) {
            this.validateImportStatements();
        }
    }

    private validateImportStatements() {
        let topOfFileIncludeStatements = [] as Array<LibraryStatement | ImportStatement>;
        for (let stmt of this.ast.statements) {
            //skip comments
            if (isCommentStatement(stmt)) {
                continue;
            }
            //if we found a non-library statement, this statement is not at the top of the file
            if (isLibraryStatement(stmt) || isImportStatement(stmt)) {
                topOfFileIncludeStatements.push(stmt);
            } else {
                //break out of the loop, we found all of our library statements
                break;
            }
        }

        let statements = [
            ...this._parser.references.libraryStatements,
            ...this._parser.references.importStatements
        ];
        for (let result of statements) {
            //if this statement is not one of the top-of-file statements,
            //then add a diagnostic explaining that it is invalid
            if (!topOfFileIncludeStatements.includes(result)) {
                if (isLibraryStatement(result)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.libraryStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this
                    });
                } else if (isImportStatement(result)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.importStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this
                    });
                }
            }
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
        const { propertyHints } = this.parser.references;
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
     * @param lines - the lines of the program
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

    private findCallables() {
        for (let statement of this.parser.references.functionStatements ?? []) {

            let functionType = statement.func.getFunctionType();
            functionType.setName(statement.name.text);

            this.callables.push({
                isSub: statement.func.functionType.text.toLowerCase() === 'sub',
                name: statement.name.text,
                nameRange: statement.name.range,
                file: this,
                params: functionType.params,
                range: statement.func.range,
                type: functionType,
                getName: statement.getName.bind(statement),
                hasNamespace: !!statement.namespaceName,
                functionStatement: statement
            });
        }
    }

    private findFunctionCalls() {
        this.functionCalls = [];
        //for every function in the file
        for (let func of this._parser.references.functionExpressions) {
            //for all function calls in this function
            for (let expression of func.callExpressions) {
                if (
                    //filter out method calls on method calls for now (i.e. getSomething().getSomethingElse())
                    (expression.callee as any).callee ||
                    //filter out method calls on regexp literals for now
                    isRegexLiteralExpression((expression.callee as DottedGetExpression)?.obj) ||
                    //filter out callees without a name (immediately-invoked function expressions)
                    !(expression.callee as any).name
                ) {
                    continue;
                }
                //Flag dotted function invocations (i.e. object.doSomething())
                const dottedInvocation = (expression.callee as any).obj;
                let functionName = (expression.callee as any).name as Token;

                //callee is the name of the function being called
                let callee = expression.callee as VariableExpression;

                let columnIndexBegin = callee.range.start.character;
                let columnIndexEnd = callee.range.end.character;

                let args = [] as CallableArg[];
                //TODO convert if stmts to use instanceof instead
                for (let arg of expression.args as any) {

                    let inferredType = getBscTypeFromExpression(arg, func);
                    let argText = '';

                    // Get the text to display for the arg
                    if (arg.token) {
                        argText = arg.token.text;
                        //is a function call being passed into argument
                    } else if (arg.name) {
                        if (isToken(arg.name)) {
                            argText = arg.name.text;
                        }

                    } else if (arg.value) {
                        /* istanbul ignore next: TODO figure out why value is undefined sometimes */
                        if (arg.value.value) {
                            if (arg.value.value.toString) {
                                argText = arg.value.value.toString();
                            }
                        }

                        //wrap the value in quotes because that's how it appears in the code
                        if (argText && isStringType(inferredType)) {
                            argText = '"' + argText + '"';
                        }
                    }
                    args.push({
                        range: arg.range,
                        type: inferredType,
                        text: argText
                    });
                }
                let functionCall: FunctionCall = {
                    range: util.createRangeFromPositions(expression.range.start, expression.closingParen.range.end),
                    functionExpression: this.getFunctionExpressionAtPosition(callee.range.start),
                    file: this,
                    name: functionName,
                    nameRange: util.createRange(callee.range.start.line, columnIndexBegin, callee.range.start.line, columnIndexEnd),
                    args: args,
                    isDottedInvocation: dottedInvocation
                };

                this.functionCalls.push(functionCall);
            }
        }
    }

    /**
     * Find the function expression at the given position.
     */
    public getFunctionExpressionAtPosition(position: Position, functionExpressions?: FunctionExpression[]): FunctionExpression {
        if (!functionExpressions) {
            functionExpressions = this.parser.references.functionExpressions;
        }
        for (let functionExpression of functionExpressions) {
            if (util.rangeContains(functionExpression.range, position)) {
                //see if any of that scope's children match the position also, and give them priority
                let childFunc = this.getFunctionExpressionAtPosition(position, functionExpression.childFunctionExpressions);
                if (childFunc) {
                    return childFunc;
                } else {
                    return functionExpression;
                }
            }
        }
    }

    /**
     * Find the NamespaceStatement enclosing the given position
     * @param position
     * @param functionScopes
     */
    public getNamespaceStatementForPosition(position: Position): NamespaceStatement {
        if (position) {
            for (const statement of this.parser.references.namespaceStatements) {
                if (util.rangeContains(statement.range, position)) {
                    return statement;
                }
            }
        }
    }

    /**
     * Get completions available at the given cursor. This aggregates all values from this file and the current scope.
     */
    public getCompletions(position: Position, scope?: Scope): CompletionItem[] {
        let result = [] as CompletionItem[];

        //a map of lower-case names of all added options
        let names = {} as Record<string, boolean>;

        //handle script import completions
        let scriptImport = util.getScriptImportAtPosition(this.ownScriptImports, position);
        if (scriptImport) {
            return this.program.getScriptImportCompletions(this.pkgPath, scriptImport);
        }

        //if cursor is within a comment, disable completions
        let currentToken = this.parser.getTokenAt(position);
        const tokenKind = currentToken?.kind;
        if (tokenKind === TokenKind.Comment) {
            return [];
        } else if (tokenKind === TokenKind.StringLiteral || tokenKind === TokenKind.TemplateStringQuasi) {
            const match = /^("?)(pkg|libpkg):/.exec(currentToken.text);
            if (match) {
                const [, openingQuote, fileProtocol] = match;
                //include every pkgPath from this scope
                for (const file of scope.getAllFiles()) {
                    const pkgPath = `${fileProtocol}:/${file.pkgPath.replace('pkg:/', '')}`;
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

        const namespaceCompletions = this.getNamespaceCompletions(currentToken, this.parseMode, scope);
        if (namespaceCompletions.length > 0) {
            return [...namespaceCompletions];
        }

        const enumMemberCompletions = this.getEnumMemberStatementCompletions(currentToken, this.parseMode, scope);
        if (enumMemberCompletions.length > 0) {
            // no other completion is valid in this case
            return enumMemberCompletions;
        }

        //determine if cursor is inside a function
        let functionExpression = this.getFunctionExpressionAtPosition(position);
        if (!functionExpression) {
            //we aren't in any function scope, so return the keyword completions and namespaces
            if (this.parser.getTokenBefore(currentToken, TokenKind.New)) {
                // there's a new keyword, so only class types are viable here
                return [...this.getGlobalClassStatementCompletions(currentToken, this.parseMode)];
            } else {
                return [
                    ...KeywordCompletions,
                    ...this.getGlobalClassStatementCompletions(currentToken, this.parseMode),
                    ...namespaceCompletions,
                    ...this.getNonNamespacedEnumStatementCompletions(currentToken, this.parseMode, scope)
                ];
            }
        }

        const classNameCompletions = this.getGlobalClassStatementCompletions(currentToken, this.parseMode);
        const newToken = this.parser.getTokenBefore(currentToken, TokenKind.New);
        if (newToken) {
            //we are after a new keyword; so we can only be top-level namespaces or classes at this point
            result.push(...classNameCompletions);
            result.push(...namespaceCompletions);
            return result;
        }

        if (this.parser.tokenFollows(currentToken, TokenKind.Goto)) {
            return this.getLabelCompletion(functionExpression);
        }

        if (this.parser.isPositionNextToTokenKind(position, TokenKind.Dot)) {

            const selfClassMemberCompletions = this.getClassMemberCompletions(position, currentToken, functionExpression, scope);

            if (selfClassMemberCompletions.size > 0) {
                return [...selfClassMemberCompletions.values()].filter((i) => i.label !== 'new');
            }
            const tokenLookup = this.getSymbolTypeFromToken(currentToken, functionExpression, scope);
            if (tokenLookup.symbolContainer?.memberTable) {
                return this.getCompletionsFromSymbolTable(tokenLookup.symbolContainer.memberTable);
            }
            const foundClassLink = this.getClassFromTokenLookup(tokenLookup, scope);
            if (!foundClassLink) {
                //and anything from any class in scope to a non m class
                let classMemberCompletions = scope.getAllClassMemberCompletions();
                result.push(...classMemberCompletions.values());
                result.push(...scope.getPropertyNameCompletions().filter((i) => !classMemberCompletions.has(i.label)));
            } else {
                result.push(...scope.getPropertyNameCompletions());
            }
        } else {
            //include namespaces
            result.push(...namespaceCompletions);

            //include class names
            result.push(...classNameCompletions);

            //include enums
            result.push(...this.getNonNamespacedEnumStatementCompletions(currentToken, this.parseMode, scope));

            //include the global callables
            result.push(...scope.getCallablesAsCompletions(this.parseMode));

            //add `m` because that's always valid within a function
            result.push({
                label: 'm',
                kind: CompletionItemKind.Variable
            });
            names.m = true;

            result.push(...KeywordCompletions);

            //include local variables
            for (let symbol of functionExpression.symbolTable.getOwnSymbols()) {
                const symbolNameLower = symbol.name.toLowerCase();
                //skip duplicate variable names
                if (names[symbolNameLower]) {
                    continue;
                }
                names[symbolNameLower] = true;
                // TODO TYPES (This may be a performance hit?)
                // const foundType = getTypeFromContext(symbol.type, { scope: scope, file: this });

                result.push({
                    //TODO does this work?
                    label: symbol.name,
                    //TODO TYPES find type for local vars - SEE above
                    kind: CompletionItemKind.Variable
                    // kind: isFunctionType(foundType) ? CompletionItemKind.Function : CompletionItemKind.Variable
                });
            }

            if (this.parseMode === ParseMode.BrighterScript) {
                //include the first part of namespaces
                let namespaces = scope.getAllNamespaceStatements();
                for (let stmt of namespaces) {
                    let firstPart = stmt.nameExpression.getNameParts().shift();
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

    private getCompletionsFromSymbolTable(symbolTable: SymbolTable) {
        return symbolTable.getAllSymbols().map(bscType => {
            return {
                label: bscType.name,
                kind: isFunctionType(bscType.type) ? CompletionItemKind.Method : CompletionItemKind.Field
            };
        });
    }

    private getLabelCompletion(func: FunctionExpression) {
        return func.labelStatements.map(label => ({
            label: label.tokens.identifier.text,
            kind: CompletionItemKind.Reference
        }));
    }

    private getClassMemberCompletions(position: Position, currentToken: Token, functionExpression: FunctionExpression, scope: Scope) {

        let classStatement = this.getClassFromToken(currentToken, functionExpression, scope);
        let results = new Map<string, CompletionItem>();
        if (classStatement) {
            let classes = scope.getClassHierarchy(classStatement.item.getName(ParseMode.BrighterScript).toLowerCase());
            for (let cs of classes) {
                for (let member of [...cs?.item?.fields ?? [], ...cs?.item?.methods ?? []]) {
                    if (!results.has(member.name.text.toLowerCase())) {
                        results.set(member.name.text.toLowerCase(), {
                            label: member.name.text,
                            kind: isClassFieldStatement(member) ? CompletionItemKind.Field : CompletionItemKind.Function
                        });
                    }
                }
            }
        }
        return results;
    }

    /**
     * Gets the class (if any) of a given token based on the scope
     * @param currentToken token in question
     * @param functionExpression current functionExpression
     * @param scope the current scope
     * @returns A fileLink of the ClassStatement, if it is a class, otherwise undefined
     */
    public getClassFromToken(currentToken: Token, functionExpression: FunctionExpression, scope: Scope): FileLink<ClassStatement> | undefined {
        const tokenLookup = this.getSymbolTypeFromToken(currentToken, functionExpression, scope);
        return this.getClassFromTokenLookup(tokenLookup, scope);
    }

    /**
     * Gets the class (if any) of a given token based on the scope
     * @param currentToken token in question
     * @param functionExpression current functionExpression
     * @param scope the current scope
     * @returns A fileLink of the ClassStatement, if it is a class, otherwise undefined
     */
    public getClassFromTokenLookup(tokenLookup: TokenSymbolLookup, scope: Scope): FileLink<ClassStatement> | undefined {
        const currentClass = tokenLookup?.symbolContainer;

        if (isClassStatement(currentClass as any)) {
            return { item: currentClass as ClassStatement, file: this };
        } else if (isCustomType(currentClass)) {
            const foundClass = scope.getClass(currentClass.name);
            if (foundClass) {
                return { item: foundClass, file: this };
            }
        }
        return undefined;
    }


    private findNamespaceFromTokenChain(originalTokenChain: TokenChainMember[], scope: Scope): NamespacedTokenChain {
        let namespaceTokens: Token[] = [];
        let startsWithNamespace = '';
        let namespaceContainer: NamespaceContainer;
        let tokenChain = [...originalTokenChain];
        while (tokenChain[0] && tokenChain[0].usage === TokenUsage.Direct) {
            const namespaceNameToCheck = `${startsWithNamespace}${startsWithNamespace.length > 0 ? '.' : ''}${tokenChain[0].token.text}`.toLowerCase();
            const foundNamespace = scope.namespaceLookup.get(namespaceNameToCheck);

            if (foundNamespace) {
                namespaceContainer = foundNamespace;
                namespaceTokens.push(tokenChain[0].token);
                startsWithNamespace = namespaceTokens.map(token => token.text).join('.');
                tokenChain.shift();
            } else {
                break;
            }
        }
        if (namespaceTokens.length > 0) {
            namespaceContainer = scope.namespaceLookup.get(startsWithNamespace.toLowerCase());
        }
        return { namespaceContainer: namespaceContainer, tokenChain: tokenChain };
    }

    private checkForSpecialClassSymbol(currentToken: Token, scope: Scope, func?: FunctionExpression): TokenSymbolLookup {
        const containingClass = this.parser.getContainingClass(currentToken);
        let symbolType: BscType;
        let currentClassRef: ClassStatement;
        const currentTokenLower = currentToken.text.toLowerCase();
        const typeContext = { file: this, scope: scope, position: currentToken.range.start };
        if (containingClass) {
            // Special cases for a single token inside a class
            let expandedText = '';
            let useExpandedTextOnly = false;
            if (containingClass.name === currentToken) {
                symbolType = containingClass.getCustomType();
                expandedText = `class ${containingClass.getName(ParseMode.BrighterScript)}`;
                useExpandedTextOnly = true;
                currentClassRef = containingClass;
            } else if (currentTokenLower === 'm') {
                symbolType = containingClass.getCustomType();
                expandedText = currentToken.text;
                currentClassRef = containingClass;
            } else if (currentTokenLower === 'super') {
                symbolType = getTypeFromContext(containingClass.symbolTable.getSymbolType(currentTokenLower, true, typeContext), typeContext);
                if (isFunctionType(symbolType)) {
                    currentClassRef = scope.getParentClass(containingClass);
                }
            } else if (func?.functionStatement?.name === currentToken) {
                // check if this is a method declaration
                currentClassRef = containingClass;
                symbolType = containingClass?.memberTable.getSymbolType(currentTokenLower, true, { file: this, scope: scope });
                expandedText = [containingClass.getName(ParseMode.BrighterScript), currentToken.text].join('.');
            } else if (!func) {
                // check if this is a field  declaration
                currentClassRef = containingClass;
                symbolType = containingClass?.memberTable.getSymbolType(currentTokenLower, true, { file: this, scope: scope });
                expandedText = [containingClass.getName(ParseMode.BrighterScript), currentToken.text].join('.');
            }
            if (symbolType) {
                return { type: symbolType, expandedTokenText: expandedText, symbolContainer: currentClassRef, useExpandedTextOnly: useExpandedTextOnly };
            }
        }
    }

    private checkForSpecialCaseToken(nameSpacedTokenChain: NamespacedTokenChain, functionExpression: FunctionExpression, scope: Scope): TokenSymbolLookup {
        const tokenChain = nameSpacedTokenChain.tokenChain ?? [];
        if (nameSpacedTokenChain.namespaceContainer && tokenChain.length === 0) {
            //currentToken was part of a namespace
            return {
                type: null,
                expandedTokenText: `namespace ${nameSpacedTokenChain.namespaceContainer.fullName}`,
                useExpandedTextOnly: true
            };
        }
        const specialCase = tokenChain.length === 1 ? this.checkForSpecialClassSymbol(tokenChain[0].token, scope, functionExpression) : null;
        if (specialCase) {
            return specialCase;
        }
    }

    /**
     * Checks previous tokens for the start of a symbol chain (eg. m.property.subProperty.method())
     * @param currentToken  The token to check
     * @param functionExpression The current function context
     * @param scope use this scope for finding class maps
     * @returns the BscType, expanded text (e.g <Class.field>) and classStatement (if available) for the token
     */
    public getSymbolTypeFromToken(currentToken: Token, functionExpression: FunctionExpression, scope: Scope): TokenSymbolLookup {
        if (!scope || !currentToken) {
            return undefined;
        }
        const cachedSymbolData = scope.symbolCache.get(currentToken);
        if (cachedSymbolData) {
            return cachedSymbolData;
        }
        const tokenChainResponse = this.parser.getTokenChain(currentToken);
        if (tokenChainResponse.includesUnknowableTokenType) {
            const symbolData = { type: new DynamicType(), expandedTokenText: currentToken.text };
            scope.symbolCache.set(currentToken, symbolData);
            return symbolData;
        }
        const nameSpacedTokenChain = this.findNamespaceFromTokenChain(tokenChainResponse.chain, scope);
        const specialCase = this.checkForSpecialCaseToken(nameSpacedTokenChain, functionExpression, scope);
        if (specialCase) {
            scope.symbolCache.set(currentToken, specialCase);
            return specialCase;
        }
        const tokenChain = nameSpacedTokenChain.tokenChain;
        let symbolContainer: SymbolContainer = this.parser.getContainingAA(currentToken) || this.parser.getContainingClass(currentToken);
        let currentSymbolTable = nameSpacedTokenChain.namespaceContainer?.symbolTable ?? functionExpression?.symbolTable;
        let tokenFoundCount = 0;
        let symbolTypeBeforeReference: BscType;
        let symbolType: BscType;
        let tokenText = [];
        let justReturnDynamic = false;
        const typeContext = { file: this, scope: scope, position: tokenChain[0]?.token.range.start };
        for (const tokenChainMember of tokenChain) {
            const token = tokenChainMember?.token;
            const tokenUsage = tokenChainMember?.usage;
            const tokenLowerText = token.text.toLowerCase();

            if (tokenLowerText === 'super' && isClassStatement(symbolContainer as any) && tokenFoundCount === 0) {
                /// Special cases for first item in chain inside a class
                symbolContainer = scope?.getParentClass(symbolContainer as ClassStatement);
                currentSymbolTable = (symbolContainer as ClassStatement)?.memberTable;
                if (symbolContainer && currentSymbolTable) {
                    tokenText.push((symbolContainer as ClassStatement).getName(ParseMode.BrighterScript));
                    tokenFoundCount++;
                    continue;
                }

            }
            if (!currentSymbolTable) {
                // uh oh... no symbol table to continue to check
                break;
            }
            symbolType = currentSymbolTable.getSymbolType(tokenLowerText, true, typeContext);
            if (tokenFoundCount === 0 && !symbolType) {
                //check for global callable
                symbolType = scope.getGlobalCallableByName(tokenLowerText)?.type;
            }
            if (symbolType) {
                // found this symbol, and it's valid. increase found counter
                tokenFoundCount++;
            }
            symbolTypeBeforeReference = symbolType;
            if (isFunctionType(symbolType)) {
                // this is a function, and it is in the start or middle of the chain
                // the next symbol to check will be the return value of this function
                symbolType = getTypeFromContext(symbolType.returnType, typeContext);
                if (tokenFoundCount < tokenChain.length) {
                    // We still have more tokens, but remember the last known reference
                    symbolTypeBeforeReference = symbolType;
                }
            }

            if (isArrayType(symbolType) && tokenUsage === TokenUsage.ArrayReference) {
                symbolType = getTypeFromContext(symbolType.getDefaultType(typeContext), typeContext);
            }

            if (symbolType?.memberTable) {
                if (isCustomType(symbolType)) {
                    // we're currently looking at a customType, that has it's own symbol table
                    // use the name of the custom type
                    // TODO TYPES: get proper parent name for methods/fields defined in super classes
                    tokenText.push(tokenChain.length === 1 ? token.text : symbolType.name);
                } else {
                    justReturnDynamic = true;
                    tokenText.push(token.text);
                }

                symbolContainer = symbolType as SymbolContainer;
                currentSymbolTable = symbolContainer?.memberTable;
            } else if (isObjectType(symbolType) || isArrayType(symbolType) || isDynamicType(symbolType)) {
                // this is an object that has no member table
                // this could happen if a parameter is marked as object
                // assume all fields are dynamic
                symbolContainer = undefined;
                tokenText.push(token.text);
                justReturnDynamic = true;
                break;
            } else {
                // No further symbol tables were found
                symbolContainer = undefined;
                tokenText.push(token.text);
                break;
            }

        }
        if (tokenText.length > 2) {
            // TokenText is used for hovers. We only need the last two tokens for a hover
            // So in a long chain (e.g. klass.getData()[0].anotherKlass.property), the hover
            // for the last token should just be "AnotherKlass.property", not the whole chain
            tokenText = tokenText.slice(-2);
        }
        let expandedTokenText = tokenText.join('.');
        let backUpReturnType: BscType;
        if (tokenFoundCount === tokenChain.length) {
            // did we complete the chain? if so, we have a valid token at the end
            const symbolData = { type: symbolTypeBeforeReference, expandedTokenText: tokenText.join('.'), symbolContainer: symbolContainer };
            scope.symbolCache.set(currentToken, symbolData);
            return symbolData;
        }
        if (isDynamicType(symbolTypeBeforeReference) || isArrayType(symbolTypeBeforeReference) || justReturnDynamic) {
            // last type in chain is dynamic... so currentToken could be anything.
            backUpReturnType = new DynamicType();
            expandedTokenText = currentToken.text;
        } else if (isPrimitiveType(symbolTypeBeforeReference)) {
            // last type in chain is dynamic... so currentToken could be anything.
            backUpReturnType = new DynamicType();
            expandedTokenText = currentToken.text;
        } else if (tokenChain.length === 1) {
            // variable that has not been assigned
            expandedTokenText = currentToken.text;
            backUpReturnType = new UninitializedType();
        } else if (tokenFoundCount === tokenChain.length - 1) {
            // member field that is not known
            if (symbolContainer) {
                backUpReturnType = new InvalidType();
            } else {
                // TODO TYPES: once we have stricter object/node member type checking, we could say this is invalid, but until then, call it dynamic
                backUpReturnType = new DynamicType();
                expandedTokenText = currentToken.text;

            }
        }
        const symbolData = { type: backUpReturnType, expandedTokenText: expandedTokenText };
        scope.symbolCache.set(currentToken, symbolData);
        return symbolData;
    }

    private getGlobalClassStatementCompletions(currentToken: Token, parseMode: ParseMode): CompletionItem[] {
        if (parseMode === ParseMode.BrightScript) {
            return [];
        }
        let results = new Map<string, CompletionItem>();
        let completionName = this.getPartialVariableName(currentToken, [TokenKind.New])?.toLowerCase();
        if (completionName?.includes('.')) {
            return [];
        }
        let scopes = this.program.getScopesForFile(this);
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

    private getNonNamespacedEnumStatementCompletions(currentToken: Token, parseMode: ParseMode, scope: Scope): CompletionItem[] {
        if (parseMode !== ParseMode.BrighterScript) {
            return [];
        }
        const containingNamespaceName = this.getNamespaceStatementForPosition(currentToken?.range?.start)?.name + '.';
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

    private getEnumMemberStatementCompletions(currentToken: Token, parseMode: ParseMode, scope: Scope): CompletionItem[] {
        if (parseMode === ParseMode.BrightScript || !currentToken) {
            return [];
        }
        const results = new Map<string, CompletionItem>();
        const completionName = this.getPartialVariableName(currentToken)?.toLowerCase();
        //if we don't have a completion name, or if there's no period in the name, then this is not to the right of an enum name
        if (!completionName || !completionName.includes('.')) {
            return [];
        }
        const enumNameLower = completionName?.split(/\.(\w+)?$/)[0]?.toLowerCase();
        const namespaceNameLower = this.getNamespaceStatementForPosition(currentToken.range.end)?.name.toLowerCase();
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

    private getNamespaceCompletions(currentToken: Token, parseMode: ParseMode, scope: Scope): CompletionItem[] {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (parseMode === ParseMode.BrightScript) {
            return [];
        }

        const completionName = this.getPartialVariableName(currentToken, [TokenKind.New]);
        //if we don't have a completion name, or if there's no period in the name, then this is not a namespaced variable
        if (!completionName || !completionName.includes('.')) {
            return [];
        }
        //remove any trailing identifer and then any trailing dot, to give us the
        //name of its immediate parent namespace
        let closestParentNamespaceName = completionName.replace(/\.([a-z0-9_]*)?$/gi, '').toLowerCase();
        let newToken = this.parser.getTokenBefore(currentToken, TokenKind.New);

        let result = new Map<string, CompletionItem>();
        for (let [, namespace] of scope.namespaceLookup) {
            //completionName = "NameA."
            //completionName = "NameA.Na
            //NameA
            //NameA.NameB
            //NameA.NameB.NameC
            if (namespace.fullName.toLowerCase() === closestParentNamespaceName) {
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
                    }
                }
            }
        }
        return [...result.values()];
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
                    if (!location && statement.name.text.toLowerCase() === endName) {
                        const uri = util.pathToUri(file.srcPath);
                        location = Location.create(uri, statement.range);
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
            let lowerName = left.name.text.toLowerCase();
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
            let lowerCalleeName = callee?.name?.text?.toLowerCase();
            if (lowerCalleeName) {
                let scopes = this.program.getScopesForFile(this);
                for (let scope of scopes) {
                    let namespace = scope.namespaceLookup.get(namespaceName.toLowerCase());
                    if (namespace.functionStatements[lowerCalleeName]) {
                        return true;
                    }
                }
            }
        }
        return false;
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
        } else if (isClassMethodStatement(statement)) {
            symbolKind = SymbolKind.Method;
        } else if (isClassFieldStatement(statement)) {
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

        const name = isClassFieldStatement(statement) ? statement.name.text : statement.getName(ParseMode.BrighterScript);
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
        } else if (isClassMethodStatement(statement)) {
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
    public getDefinition(position: Position) {
        let results: Location[] = [];

        //get the token at the position
        const token = this.parser.getTokenAt(position);

        // While certain other tokens are allowed as local variables (AllowedLocalIdentifiers: https://github.com/rokucommunity/brighterscript/blob/master/src/lexer/TokenKind.ts#L418), these are converted by the parser to TokenKind.Identifier by the time we retrieve the token using getTokenAt
        let definitionTokenTypes = [
            TokenKind.Identifier,
            TokenKind.StringLiteral
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !definitionTokenTypes.includes(token.kind)) {
            return results;
        }

        let textToSearchFor = token.text.toLowerCase();

        const previousToken = this.parser.getTokenAt({ line: token.range.start.line, character: token.range.start.character });

        if (previousToken?.kind === TokenKind.Callfunc) {
            for (const scope of this.program.getScopes()) {
                //to only get functions defined in interface methods
                const callable = scope.getAllCallables().find((c) => c.callable.name.toLowerCase() === textToSearchFor); // eslint-disable-line @typescript-eslint/no-loop-func
                if (callable) {
                    results.push(Location.create(util.pathToUri((callable.callable.file as BrsFile).srcPath), callable.callable.functionStatement.range));
                }
            }
            return results;
        }

        let classToken = this.parser.getTokenBefore(token, TokenKind.Class);
        if (classToken) {
            let cs = this.parser.references.classStatements.find((cs) => cs.classKeyword.range === classToken.range);
            if (cs?.parentClassName) {
                const nameParts = cs.parentClassName.getNameParts();
                let extendedClass = this.getClassFileLink(nameParts[nameParts.length - 1], nameParts.slice(0, -1).join('.'));
                if (extendedClass) {
                    results.push(Location.create(util.pathToUri(extendedClass.file.srcPath), extendedClass.item.range));
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

        const func = this.getFunctionExpressionAtPosition(position);
        //look through local variables first
        //find any variable with this name
        for (const symbol of func.symbolTable.getOwnSymbols()) {
            //we found a variable declaration with this token text
            if (symbol.name.toLowerCase() === textToSearchFor) {
                const uri = util.pathToUri(this.srcPath);
                results.push(Location.create(uri, symbol.range));
            }
        }
        if (this.parser.tokenFollows(token, TokenKind.Goto)) {
            for (const label of func.labelStatements) {
                if (label.tokens.identifier.text.toLocaleLowerCase() === textToSearchFor) {
                    const uri = util.pathToUri(this.srcPath);
                    results.push(Location.create(uri, label.tokens.identifier.range));
                }
            }
        }

        const filesSearched = new Set<BrsFile>();
        //look through all files in scope for matches
        for (const scope of this.program.getScopesForFile(this)) {
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || filesSearched.has(file)) {
                    continue;
                }
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
                        results.push(Location.create(uri, statement.range));
                    }
                };

                file.parser.ast.walk(createVisitor({
                    FunctionStatement: statementHandler
                }), {
                    walkMode: WalkMode.visitStatements
                });
            }
        }
        return results;
    }

    public getClassMemberDefinitions(textToSearchFor: string, file: BrsFile): Location[] {
        let results: Location[] = [];
        //get class fields and members
        const statementHandler = (statement: ClassMethodStatement) => {
            if (statement.getName(file.parseMode).toLowerCase() === textToSearchFor) {
                results.push(Location.create(util.pathToUri(file.srcPath), statement.range));
            }
        };
        const fieldStatementHandler = (statement: ClassFieldStatement) => {
            if (statement.name.text.toLowerCase() === textToSearchFor) {
                results.push(Location.create(util.pathToUri(file.srcPath), statement.range));
            }
        };
        file.parser.ast.walk(createVisitor({
            ClassMethodStatement: statementHandler,
            ClassFieldStatement: fieldStatementHandler
        }), {
            walkMode: WalkMode.visitStatements
        });

        return results;
    }

    public getHover(position: Position): Hover {
        const fence = (code: string) => util.mdFence(code, 'brightscript');
        //get the token at the position
        let token = this.parser.getTokenAt(position);

        let hoverTokenTypes = [
            TokenKind.Identifier,
            TokenKind.Function,
            TokenKind.EndFunction,
            TokenKind.Sub,
            TokenKind.EndSub
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || !hoverTokenTypes.includes(token.kind)) {
            return null;
        }

        let lowerTokenText = token.text.toLowerCase();

        //look through local variables first
        {
            const func = this.getFunctionExpressionAtPosition(position);
            if (func) {
                // this identifier could possibly be a class field, so no function expression is available
                for (const labelStatement of func?.labelStatements ?? []) {
                    if (labelStatement.tokens.identifier.text.toLocaleLowerCase() === lowerTokenText) {
                        return {
                            range: token.range,
                            contents: `${labelStatement.tokens.identifier.text}: label`
                        };
                    }
                }
            }
            const typeTexts = new Set<string>();
            const fileScopes = this.program.getScopesForFile(this).sort((a, b) => a.dependencyGraphKey?.localeCompare(b.dependencyGraphKey));
            const callables = [] as Callable[];
            for (const scope of fileScopes) {
                scope.linkSymbolTable();
                const typeContext = { file: this, scope: scope, position: position };
                const typeTextPair = this.getSymbolTypeFromToken(token, func, scope);
                if (typeTextPair) {
                    let scopeTypeText = '';

                    if (isFunctionType(typeTextPair.type)) {
                        scopeTypeText = typeTextPair.type?.toString(typeContext);
                        //keep unique references to the callables for this function
                        if (!typeTexts.has(scopeTypeText)) {
                            callables.push(
                                scope.getCallableByName(lowerTokenText)
                            );
                        }
                    } else if (typeTextPair.useExpandedTextOnly) {
                        scopeTypeText = typeTextPair.expandedTokenText;
                    } else {
                        scopeTypeText = `${typeTextPair.expandedTokenText} as ${typeTextPair.type?.toString(typeContext)}`;
                    }

                    if (scopeTypeText) {
                        typeTexts.add(scopeTypeText);
                    }
                }
                scope.unlinkSymbolTable();
            }

            if (callables.length === typeTexts.size) {
                //this is a function in all scopes, so build the function hover
                return {
                    range: token.range,
                    contents: this.getCallableDocumentation([...typeTexts], callables)
                };
            } else if (typeTexts?.size > 0) {
                const typeText = [...typeTexts].join(' | ');
                return {
                    range: token.range,
                    contents: fence(typeText)
                };
            }
        }

        // //look through all callables in relevant scopes
        // {
        //     let scopes = this.program.getScopesForFile(this);
        //     for (let scope of scopes) {
        //         let callable = scope.getCallableByName(lowerTokenText);
        //         if (callable) {
        //             return {
        //                 range: token.range,
        //                 contents: this.getCallableDocumentation(callables)
        //             };
        //         }
        //     }
        // }
    }

    /**
     * Build a hover documentation for a callable.
     */
    private getCallableDocumentation(typeTexts: string[], callables: Callable[]) {
        const callable = callables[0];
        const typeText = typeTexts[0];

        const comments = [] as Token[];
        const tokens = callable?.file.parser.tokens as Token[];
        const idx = tokens?.indexOf(callable.functionStatement?.func.functionType);
        for (let i = idx - 1; i >= 0; i--) {
            const token = tokens[i];
            //skip whitespace and newline chars
            if (token.kind === TokenKind.Comment) {
                comments.push(token);
            } else if (token.kind === TokenKind.Newline || token.kind === TokenKind.Whitespace) {
                //skip these tokens
                continue;

                //any other token means there are no more comments
            } else {
                break;
            }
        }
        //message indicating if there are variations. example: (+3 variations) if there are 4 unique function signatures
        const multiText = callables.length > 1 ? ` (+${callables.length - 1} variations)` : '';
        let result = util.mdFence(typeText + multiText, 'brightscript');
        if (comments.length > 0) {
            result += '\n***\n' + comments.reverse().map(x => x.text.replace(/^('|rem)/i, '')).join('\n');
        }
        return result;
    }

    public getSignatureHelpForNamespaceMethods(callableName: string, dottedGetText: string, scope: Scope): { key: string; signature: SignatureInformation }[] {
        if (!dottedGetText) {
            return [];
        }
        let resultsMap = new Map<string, SignatureInfoObj>();
        for (let [, namespace] of scope.namespaceLookup) {
            //completionName = "NameA."
            //completionName = "NameA.Na
            //NameA
            //NameA.NameB
            //NameA.NameB.NameC
            if (namespace.fullName.toLowerCase() === dottedGetText.toLowerCase()) {
                //add function and class statement completions
                for (let stmt of namespace.statements) {
                    if (isFunctionStatement(stmt) && stmt.name.text.toLowerCase() === callableName.toLowerCase()) {
                        const result = (namespace.file as BrsFile)?.getSignatureHelpForStatement(stmt);
                        if (!resultsMap.has(result.key)) {
                            resultsMap.set(result.key, result);
                        }
                    }
                }

            }
        }

        return [...resultsMap.values()];
    }

    public getSignatureHelpForStatement(statement: Statement): SignatureInfoObj {
        if (!isFunctionStatement(statement) && !isClassMethodStatement(statement)) {
            return undefined;
        }
        const func = statement.func;
        const funcStartPosition = func.range.start;

        // Get function comments in reverse order
        let currentToken = this.parser.getTokenAt(funcStartPosition);
        let functionComments = [] as string[];
        while (currentToken) {
            currentToken = this.parser.getPreviousToken(currentToken);

            if (!currentToken) {
                break;
            }
            if (currentToken.range.start.line + 1 < funcStartPosition.line) {
                if (functionComments.length === 0) {
                    break;
                }
            }

            const kind = currentToken.kind;
            if (kind === TokenKind.Comment) {
                // Strip off common leading characters to make it easier to read
                const commentText = currentToken.text.replace(/^[' *\/]+/, '');
                functionComments.unshift(commentText);
            } else if (kind === TokenKind.Newline) {
                if (functionComments.length === 0) {
                    continue;
                }
                // if we already had a new line as the last token then exit out
                if (functionComments[0] === currentToken.text) {
                    break;
                }
                functionComments.unshift(currentToken.text);
            } else {
                break;
            }
        }

        const documentation = functionComments.join('').trim();

        const lines = util.splitIntoLines(this.fileContents);
        let key = statement.name.text + documentation;
        const params = [] as ParameterInformation[];
        for (const param of func.parameters) {
            params.push(ParameterInformation.create(param.name.text));
            key += param.name.text;
        }

        const label = util.getTextForRange(lines, util.createRangeFromPositions(func.functionType.range.start, func.body.range.start)).trim();
        const signature = SignatureInformation.create(label, documentation, ...params);
        const index = 1;
        return { key: key, signature: signature, index: index };
    }

    private getClassMethod(classStatement: ClassStatement, name: string, walkParents = true): ClassMethodStatement | undefined {
        //TODO - would like to write this with getClassHierarchy; but got stuck on working out the scopes to use... :(
        //TODO types - this could be solved with symbolTable?
        let statement;
        const statementHandler = (e) => {
            if (!statement && e.name.text.toLowerCase() === name.toLowerCase()) {
                statement = e;
            }
        };
        while (classStatement) {
            classStatement.walk(createVisitor({
                ClassMethodStatement: statementHandler
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

    public getClassSignatureHelp(classStatement: ClassStatement): SignatureInfoObj | undefined {
        const classConstructor = this.getClassMethod(classStatement, 'new');
        let sigHelp = classConstructor ? this.getSignatureHelpForStatement(classConstructor) : undefined;
        if (sigHelp) {
            sigHelp.key = classStatement.getName(ParseMode.BrighterScript);
            sigHelp.signature.label = sigHelp.signature.label.replace(/(function|sub) new/, sigHelp.key);
        }
        return sigHelp;
    }

    public getReferences(position: Position) {

        const callSiteToken = this.parser.getTokenAt(position);

        let locations = [] as Location[];

        const searchFor = callSiteToken.text.toLowerCase();

        const scopes = this.program.getScopesForFile(this);

        for (const scope of scopes) {
            const processedFiles = new Set<BrsFile>();
            for (const file of scope.getAllFiles()) {
                if (isXmlFile(file) || processedFiles.has(file)) {
                    continue;
                }
                processedFiles.add(file);
                file.ast.walk(createVisitor({
                    VariableExpression: (e) => {
                        if (e.name.text.toLowerCase() === searchFor) {
                            locations.push(Location.create(util.pathToUri(file.srcPath), e.range));
                        }
                    }
                }), {
                    walkMode: WalkMode.visitExpressionsRecursive
                });
            }
        }
        return locations;
    }

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile(): CodeWithSourceMap {
        const state = new BrsTranspileState(this);
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

    public getTypedef() {
        const state = new BrsTranspileState(this);
        const typedef = this.ast.getTypedef(state);
        const programNode = new SourceNode(null, null, this.srcPath, typedef);
        return programNode.toString();
    }

    public dispose() {
        this._parser?.dispose();
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


interface NamespacedTokenChain {
    namespaceContainer?: NamespaceContainer;
    tokenChain: TokenChainMember[];
}

export interface TokenSymbolLookup {
    type: BscType;
    expandedTokenText: string;
    symbolContainer?: SymbolContainer;
    useExpandedTextOnly?: boolean;
}
