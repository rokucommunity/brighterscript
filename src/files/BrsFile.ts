import type { CodeWithSourceMap } from 'source-map';
import { SourceNode } from 'source-map';
import type { CompletionItem, Hover, Position } from 'vscode-languageserver';
import { CompletionItemKind, SymbolKind, Location, SignatureInformation, ParameterInformation, DocumentSymbol, SymbolInformation, TextEdit } from 'vscode-languageserver';
import chalk from 'chalk';
import * as path from 'path';
import type { NamespaceContainer, Scope } from '../Scope';
import { DiagnosticCodeMap, diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import type { Callable, CallableArg, CommentFlag, FunctionCall, BsDiagnostic, FileReference } from '../interfaces';
import type { Token } from '../lexer';
import { Lexer, TokenKind, AllowedLocalIdentifiers, Keywords, isToken } from '../lexer';
import { Parser, ParseMode, getBscTypeFromExpression } from '../parser';
import type { FunctionExpression, VariableExpression, Expression } from '../parser/Expression';
import type { ClassStatement, FunctionStatement, NamespaceStatement, ClassMethodStatement, LibraryStatement, ImportStatement, Statement, ClassFieldStatement } from '../parser/Statement';
import type { FileLink, Program, SignatureInfoObj } from '../Program';
import { standardizePath as s, util } from '../util';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { Preprocessor } from '../preprocessor/Preprocessor';
import { LogLevel } from '../Logger';
import { serializeError } from 'serialize-error';
import { isClassMethodStatement, isClassStatement, isCommentStatement, isDottedGetExpression, isFunctionStatement, isFunctionType, isLibraryStatement, isNamespaceStatement, isStringType, isVariableExpression, isXmlFile, isImportStatement, isClassFieldStatement, isCustomType } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import type { DependencyGraph } from '../DependencyGraph';
import { CommentFlagProcessor } from '../CommentFlagProcessor';
import type { BscType } from '../types/BscType';
import type { CustomType } from '../types/CustomType';
import { UninitializedType } from '../types/UninitializedType';
import { InvalidType } from '../types/InvalidType';

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
     * The all-lowercase extension for this file (including the leading dot)
     */
    public extension: string;

    /**
     * Indicates whether this file needs to be validated.
     */
    public isValidated = false;

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
            } catch (error) {
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

            this.findAndValidateImportAndImportStatements();

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

    public validate() { }

    public findAndValidateImportAndImportStatements() {
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
            //register import statements
            if (isImportStatement(result) && result.filePathToken) {
                this.ownScriptImports.push({
                    filePathRange: result.filePathToken.range,
                    pkgPath: util.getPkgPathFromTarget(this.pkgPath, result.filePath),
                    sourceFile: this,
                    text: result.filePathToken?.text
                });
            }

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

                    let impliedType = getBscTypeFromExpression(arg, func);
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
                            argText = arg.value.value.toString();
                        }

                        //wrap the value in quotes because that's how it appears in the code
                        if (isStringType(impliedType)) {
                            argText = '"' + argText + '"';
                        }
                    }
                    args.push({
                        range: arg.range,
                        type: impliedType,
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

        let namespaceCompletions = this.getNamespaceCompletions(currentToken, this.parseMode, scope);
        if (namespaceCompletions.length > 0) {
            return namespaceCompletions;
        }
        //determine if cursor is inside a function
        let functionExpression = this.getFunctionExpressionAtPosition(position);
        if (!functionExpression) {
            //we aren't in any function scope, so return the keyword completions and namespaces
            if (this.parser.getTokenBefore(currentToken, TokenKind.New)) {
                // there's a new keyword, so only class types are viable here
                return [...this.getGlobalClassStatementCompletions(currentToken, this.parseMode)];
            } else {
                return [...KeywordCompletions, ...this.getGlobalClassStatementCompletions(currentToken, this.parseMode), ...namespaceCompletions];
            }
        }

        const classNameCompletions = this.getGlobalClassStatementCompletions(currentToken, this.parseMode);
        const newToken = this.parser.getTokenBefore(currentToken, TokenKind.New);
        if (newToken) {
            //we are after a new keyword; so we can only be namespaces or classes at this point
            result.push(...classNameCompletions);
            result.push(...namespaceCompletions);
            return result;
        }

        if (this.parser.tokenFollows(currentToken, TokenKind.Goto)) {
            return this.getLabelCompletion(functionExpression);
        }

        if (this.parser.isPositionNextToTokenKind(position, TokenKind.Dot)) {
            if (namespaceCompletions.length > 0) {
                //if we matched a namespace, after a dot, it can't be anything else but something from our namespace completions
                return namespaceCompletions;
            }

            const selfClassMemberCompletions = this.getClassMemberCompletions(position, currentToken, functionExpression, scope);

            if (selfClassMemberCompletions.size > 0) {
                return [...selfClassMemberCompletions.values()].filter((i) => i.label !== 'new');
            }
            const foundClassLink = this.getClassFromToken(currentToken, functionExpression, scope);
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
            for (let symbol of functionExpression.symbolTable.ownSymbols) {
                const symbolNameLower = symbol.name.toLowerCase();
                //skip duplicate variable names
                if (names[symbolNameLower]) {
                    continue;
                }
                names[symbolNameLower] = true;
                result.push({
                    //TODO does this work?
                    label: symbol.name,
                    //TODO find type for local vars
                    kind: CompletionItemKind.Variable
                    // kind: isFunctionType(variable.type) ? CompletionItemKind.Function : CompletionItemKind.Variable
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
                for (let member of [...cs?.item?.fields, ...cs?.item?.methods]) {
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
        const currentClass = this.getSymbolTypeFromToken(currentToken, functionExpression, scope)?.currentClass;

        if (currentClass) {
            return { item: currentClass, file: this };
        }
        return undefined;
    }


    private findNamespaceFromTokenChain(tokenChain: Token[], scope: Scope): NamespacedTokenChain {
        let namespaceTokens: Token[] = [];
        let startsWithNamespace = '';
        let namespaceContainer: NamespaceContainer;
        while (tokenChain[0]) {
            const namespaceNameToCheck = `${startsWithNamespace}${startsWithNamespace.length > 0 ? '.' : ''}${tokenChain[0].text}`.toLowerCase();
            const foundNamespace = scope.namespaceLookup[namespaceNameToCheck];

            if (foundNamespace) {
                namespaceContainer = foundNamespace;
                namespaceTokens.push(tokenChain[0]);
                startsWithNamespace = namespaceTokens.map(token => token.text).join('.');
                tokenChain.shift();
            } else {
                break;
            }
        }
        if (namespaceTokens.length > 0) {
            namespaceContainer = scope.namespaceLookup[startsWithNamespace.toLowerCase()];
        }
        return { namespaceContainer: namespaceContainer, tokenChain: tokenChain };
    }

    private checkForSpecialClassSymbol(currentToken: Token, scope: Scope): TokenSymbolLookup {
        let containingClass = this.parser.references.getContainingClass(currentToken);
        let symbolType: BscType;
        let currentClassRef: ClassStatement;

        if (containingClass) {
            // Special cases for a single token inside a class
            let expandedText = '';
            let useExpandedTextOnly = false;
            if (containingClass.name === currentToken) {
                symbolType = containingClass.getCustomType();
                expandedText = `class ${containingClass.getName(ParseMode.BrighterScript)}`;
                useExpandedTextOnly = true;
                currentClassRef = containingClass;
            } else if (currentToken.text.toLowerCase() === 'm') {
                symbolType = containingClass.getCustomType();
                expandedText = currentToken.text;
                currentClassRef = containingClass;
            } else if (currentToken.text.toLowerCase() === 'super') {
                symbolType = containingClass.symbolTable.getSymbolType(currentToken.text.toLowerCase(), true);
                if (isFunctionType(symbolType)) {
                    currentClassRef = scope?.getClass(((symbolType.returnType as any).name?.toLowerCase()));
                }
            } else {
                currentClassRef = containingClass;
                symbolType = containingClass?.symbolTable.getSymbolType(currentToken.text.toLowerCase(), true, { file: this, scope: scope });
                expandedText = [containingClass.getName(ParseMode.BrighterScript), currentToken.text].join('.');
            }
            if (symbolType) {
                return { type: symbolType, expandedTokenText: expandedText, currentClass: currentClassRef, useExpandedTextOnly: useExpandedTextOnly };
            }
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
        const nameSpacedTokenChain = this.findNamespaceFromTokenChain(this.parser.getTokenChain(currentToken), scope);
        const tokenChain = nameSpacedTokenChain.tokenChain;
        if (nameSpacedTokenChain.namespaceContainer && tokenChain.length === 0) {
            //currentToken was part of a namespace
            return {
                type: null,
                expandedTokenText: `namespace ${nameSpacedTokenChain.namespaceContainer.fullName}`,
                useExpandedTextOnly: true
            };
        }
        const specialCase = tokenChain.length === 1 ? this.checkForSpecialClassSymbol(tokenChain[0], scope) : null;
        if (specialCase) {
            return specialCase;
        }

        let containingClass = this.parser.references.getContainingClass(currentToken);
        let currentSymbolTable = nameSpacedTokenChain.namespaceContainer?.symbolTable ?? functionExpression?.symbolTable;
        let tokenFoundCount = 0;
        let symbolType: BscType;
        let tokenText = [];
        let currentClassRef: ClassStatement;

        for (const token of tokenChain) {
            const tokenLowerText = token.text.toLowerCase();

            if (containingClass && tokenFoundCount === 0) {
                /// Special cases for first item in chain inside a class
                if (tokenLowerText === 'm') {
                    // find the current class for tokenChains starting with "m" - e.g. m.someMethod()
                    // use the position in the file to determine the current class
                    currentClassRef = containingClass;
                    currentSymbolTable = currentClassRef.symbolTable;
                } else if (tokenLowerText === 'super') {
                    currentClassRef = scope?.getParentClass(containingClass);
                    currentSymbolTable = currentClassRef?.symbolTable;
                    if (currentClassRef && currentSymbolTable) {
                        tokenText.push(currentClassRef.getName(ParseMode.BrighterScript));
                        tokenFoundCount++;
                        continue;
                    }
                }
            }
            if (!currentSymbolTable) {
                // uh oh... no symbol table to continue to check
                break;
            }
            symbolType = currentSymbolTable.getSymbolType(tokenLowerText, true, { file: this, scope: scope });
            if (symbolType) {
                // found this symbol, and it's valid. increase found counter
                tokenFoundCount++;
            }
            let funcReturnType: BscType;
            if (isFunctionType(symbolType)) {
                // this is a function, and it is in the start or middle of the chain
                // the next symbol to check will be the return value of this function
                funcReturnType = symbolType.returnType;

            }
            if (isCustomType(symbolType) || isCustomType(funcReturnType)) {
                const classSymbolType = (funcReturnType || symbolType) as CustomType;
                // we're currently looking at a customType, that has it's own symbol table
                if (tokenLowerText === 'm' && tokenChain.length === 1) {
                    // put "m" as the text for chains that are only "m"
                    tokenText.push(tokenLowerText);
                } else {
                    // else use the name of the custom type
                    // TODO: get proper parent name for methods/fields defined in super classes
                    tokenText.push(tokenChain.length === 1 ? token.text : classSymbolType.name);

                    // this is a CustomType and it is not "m", so we need to look up the class from the classMap
                    currentClassRef = scope?.getClassMap().get(classSymbolType.name.toLowerCase())?.item;
                    currentSymbolTable = currentClassRef?.symbolTable;
                }
            } else {
                // This is not a customType, so there is no class
                currentClassRef = undefined;
                tokenText.push(token.text);
                break;
            }
            if (tokenText.length > 2) {
                tokenText.shift(); // only care about last two symbols
            }
        }
        if (tokenFoundCount === tokenChain.length) {
            // did we complete the chain? if so, we have a valid token at the end
            return { type: symbolType, expandedTokenText: tokenText.join('.'), currentClass: currentClassRef };
        }
        let backUpReturnType: BscType;
        if (tokenChain.length === 1) {
            // variable that has not been assigned
            backUpReturnType = new UninitializedType();
        } else if (tokenFoundCount === tokenChain.length - 1) {
            // member field that is not known
            backUpReturnType = new InvalidType();
        }
        return { type: backUpReturnType, expandedTokenText: tokenText.join('.') };
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
            // let viableKeys = [...classMap.keys()].filter((k) => k.startsWith(completionName));
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

    private getNamespaceCompletions(currentToken: Token, parseMode: ParseMode, scope: Scope): CompletionItem[] {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (parseMode === ParseMode.BrightScript) {
            return [];
        }

        let completionName = this.getPartialVariableName(currentToken, [TokenKind.New]);
        if (!completionName) {
            return [];
        }
        //remove any trailing identifer and then any trailing dot, to give us the
        //name of its immediate parent namespace
        let closestParentNamespaceName = completionName.replace(/\.([a-z0-9_]*)?$/gi, '');
        let newToken = this.parser.getTokenBefore(currentToken, TokenKind.New);

        let namespaceLookup = scope.namespaceLookup;
        let result = new Map<string, CompletionItem>();
        for (let key in namespaceLookup) {
            let namespace = namespaceLookup[key.toLowerCase()];
            //completionName = "NameA."
            //completionName = "NameA.Na
            //NameA
            //NameA.NameB
            //NameA.NameB.NameC
            if (namespace.fullName.toLowerCase() === closestParentNamespaceName.toLowerCase()) {
                //add all of this namespace's immediate child namespaces, bearing in mind if we are after a new keyword
                for (let childKey in namespace.namespaces) {
                    const ns = namespace.namespaces[childKey];
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
                        if (!result.has(stmt.name.text)) {
                            result.set(stmt.name.text, {
                                label: stmt.name.text,
                                kind: CompletionItemKind.Class
                            });
                        }
                    } else if (isFunctionStatement(stmt) && !newToken) {
                        if (!result.has(stmt.name.text)) {
                            result.set(stmt.name.text, {
                                label: stmt.name.text,
                                kind: CompletionItemKind.Function
                            });
                        }
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
                if (scope.namespaceLookup[lowerName]) {
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
                    let namespace = scope.namespaceLookup[namespaceName.toLowerCase()];
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
        for (const symbol of func.symbolTable.ownSymbols) {
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
                for (const labelStatement of func?.labelStatements) {
                    if (labelStatement.tokens.identifier.text.toLocaleLowerCase() === lowerTokenText) {
                        return {
                            range: token.range,
                            contents: `${labelStatement.tokens.identifier.text}: label`
                        };
                    }
                }
            }
            const typeTexts: string[] = [];

            for (const scope of this.program.getScopesForFile(this)) {
                scope.linkSymbolTable();
                const typeTextPair = this.getSymbolTypeFromToken(token, func, scope);
                if (typeTextPair) {
                    let scopeTypeText = '';

                    if (isFunctionType(typeTextPair.type)) {
                        scopeTypeText = typeTextPair.type.toString();
                    } else if (typeTextPair.useExpandedTextOnly) {
                        scopeTypeText = typeTextPair.expandedTokenText;
                    } else {
                        scopeTypeText = `${typeTextPair.expandedTokenText} as ${typeTextPair.type.toString()}`;
                    }

                    if (!typeTexts.includes(scopeTypeText)) {
                        typeTexts.push(scopeTypeText);
                    }
                }
                scope.unlinkSymbolTable();
            }

            const typeText = typeTexts.join(' | ');
            if (typeText) {
                return {
                    range: token.range,
                    contents: typeText
                };
            }
        }

        //look through all callables in relevant scopes
        {
            let scopes = this.program.getScopesForFile(this);
            for (let scope of scopes) {
                let callable = scope.getCallableByName(lowerTokenText);
                if (callable) {
                    return {
                        range: token.range,
                        contents: callable.type.toString()
                    };
                }
            }
        }
    }

    public getSignatureHelpForNamespaceMethods(callableName: string, dottedGetText: string, scope: Scope): { key: string; signature: SignatureInformation }[] {
        if (!dottedGetText) {
            return [];
        }
        let namespaceLookup = scope.namespaceLookup;
        let resultsMap = new Map<string, SignatureInfoObj>();
        for (let key in namespaceLookup) {
            let namespace = namespaceLookup[key.toLowerCase()];
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
        //TODO - this could be solved with symbolTable?
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
    tokenChain: Token[];
}

interface TokenSymbolLookup {
    type: BscType;
    expandedTokenText: string;
    currentClass?: ClassStatement;
    useExpandedTextOnly?: boolean;
}
