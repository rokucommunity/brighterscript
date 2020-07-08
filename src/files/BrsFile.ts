import * as path from 'path';
import { SourceNode } from 'source-map';
import { CompletionItem, CompletionItemKind, Hover, Position, Range } from 'vscode-languageserver';
import chalk from 'chalk';
import { Scope } from '../Scope';
import { diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, CallableArg, CallableParam, CommentFlag, FunctionCall, BsDiagnostic, FileReference } from '../interfaces';
import { Deferred } from '../deferred';
import { FunctionParameter } from '../brsTypes';
import { Lexer, Token, TokenKind, Identifier, AllowedLocalIdentifiers, Keywords } from '../lexer';
import { Parser, ParseMode } from '../parser';
import { AALiteralExpression, DottedGetExpression, FunctionExpression, LiteralExpression, CallExpression, VariableExpression, Expression } from '../parser/Expression';
import { AssignmentStatement, CommentStatement, FunctionStatement, IfStatement, LibraryStatement, Body, ImportStatement } from '../parser/Statement';
import { Program } from '../Program';
import { BrsType } from '../types/BrsType';
import { DynamicType } from '../types/DynamicType';
import { FunctionType } from '../types/FunctionType';
import { StringType } from '../types/StringType';
import { VoidType } from '../types/VoidType';
import { standardizePath as s, util } from '../util';
import { TranspileState } from '../parser/TranspileState';
import { ClassStatement } from '../parser/ClassStatement';
import { parseManifest } from '../preprocessor/Manifest';
import * as fsExtra from 'fs-extra';
import { Preprocessor } from '../preprocessor/Preprocessor';
import { LogLevel } from '../Logger';
import { serializeError } from 'serialize-error';

/**
 * Holds all details about this file within the scope of the whole program
 */
export class BrsFile {
    constructor(
        public pathAbsolute: string,
        /**
         * The full pkg path to this file
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.pathAbsolute = s`${this.pathAbsolute}`;
        this.pkgPath = s`${this.pkgPath}`;
        this.dependencyGraphKey = this.pkgPath.toLowerCase();

        this.extension = path.extname(pathAbsolute).toLowerCase();

        //all BrighterScript files need to be transpiled
        if (this.extension === '.bs') {
            this.needsTranspiled = true;
        }
    }

    /**
     * The key used to identify this file in the dependency graph
     */
    public dependencyGraphKey: string;
    /**
     * The extension for this file
     */
    public extension: string;

    private parseDeferred = new Deferred();

    /**
     * Indicates that the file is completely ready for interaction
     */
    public isReady() {
        return this.parseDeferred.promise;
    }

    private diagnostics = [] as BsDiagnostic[];

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public commentFlags = [] as CommentFlag[];

    public callables = [] as Callable[];

    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

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
    private ast: Body;

    /**
     * Get the token at the specified position
     * @param position
     */
    private getTokenAt(position: Position) {
        for (let token of this.parser.tokens) {
            if (util.rangeContains(token.range, position)) {
                return token;
            }
        }
    }

    public parser: Parser;

    public fileContents: string;

    /**
     * Calculate the AST for this file
     * @param fileContents
     */
    public async parse(fileContents: string) {
        await this.program.logger.time(LogLevel.info, ['parse', chalk.green(this.pathAbsolute)], async (pause, resume) => {
            try {
                this.fileContents = fileContents;
                if (this.parseDeferred.isCompleted) {
                    throw new Error(`File was already processed. Create a new instance of BrsFile instead. ${this.pathAbsolute}`);
                }

                //tokenize the input file
                let lexer = this.program.logger.time(LogLevel.debug, ['lexer.lex', chalk.green(this.pathAbsolute)], () => {
                    return Lexer.scan(fileContents, {
                        includeWhitespace: false
                    });
                });

                this.getIgnores(lexer.tokens);

                //remove all code inside false-resolved conditional compilation statements
                //load the manifest file
                let manifestPath = path.join(this.program.options.rootDir, 'manifest');

                let contents: string;
                try {
                    pause();
                    //TODO don't load the manifest for every brs file
                    contents = await fsExtra.readFile(manifestPath, 'utf-8');
                } catch (err) {
                    return new Map();
                }
                resume();
                let manifest = this.program.logger.time(LogLevel.debug, ['parseManifest', chalk.green(this.pathAbsolute)], () => {
                    return parseManifest(contents);
                });
                let preprocessor = new Preprocessor();

                //currently the preprocessor throws exceptions on syntax errors...so we need to catch it
                try {
                    this.program.logger.time(LogLevel.debug, ['preprocessor.process', chalk.green(this.pathAbsolute)], () => {
                        preprocessor.process(lexer.tokens, manifest);
                    });
                } catch (error) {
                    //if the thrown error is DIFFERENT than any errors from the preprocessor, add that error to the list as well
                    if (this.diagnostics.find((x) => x === error) === undefined) {
                        this.diagnostics.push(error);
                    }
                }

                //if the preprocessor generated tokens, use them.
                let tokens = preprocessor.processedTokens.length > 0 ? preprocessor.processedTokens : lexer.tokens;

                this.parser = new Parser();
                this.program.logger.time(LogLevel.debug, ['parser.parse', chalk.green(this.pathAbsolute)], () => {
                    this.parser.parse(tokens, {
                        mode: this.extension === '.brs' ? ParseMode.BrightScript : ParseMode.BrighterScript,
                        logger: this.program.logger
                    });
                });

                //absorb all lexing/preprocessing/parsing diagnostics
                this.diagnostics.push(
                    ...lexer.diagnostics as BsDiagnostic[],
                    ...preprocessor.diagnostics as BsDiagnostic[],
                    ...this.parser.diagnostics as BsDiagnostic[]
                );

                this.ast = this.parser.ast;

                //extract all callables from this file
                this.findCallables();

                //traverse the ast and find all functions and create a scope object
                this.createFunctionScopes();

                //find all places where a sub/function is being called
                this.findFunctionCalls();

                //scan the full text for any word that looks like a variable
                this.findPropertyNameCompletions();

                this.findAndValidateImportAndImportStatements();

                //attach this file to every diagnostic
                for (let diagnostic of this.diagnostics) {
                    diagnostic.file = this;
                }
            } catch (e) {
                this.parser = new Parser();
                this.diagnostics.push({
                    file: this,
                    range: Range.create(0, 0, 0, Number.MAX_VALUE),
                    ...DiagnosticMessages.genericParserMessage('Critical error parsing file: ' + JSON.stringify(serializeError(e)))
                });
            }
        });
        this.parseDeferred.resolve();
    }

    public findAndValidateImportAndImportStatements() {
        let topOfFileIncludeStatements = [] as Array<LibraryStatement | ImportStatement>;

        for (let stmt of this.ast.statements) {
            //skip comments
            if (stmt instanceof CommentStatement) {
                continue;
            }
            //if we found a non-library statement, this statement is not at the top of the file
            if (stmt instanceof LibraryStatement || stmt instanceof ImportStatement) {
                topOfFileIncludeStatements.push(stmt);
            } else {
                //break out of the loop, we found all of our library statements
                break;
            }
        }

        let statements = [
            ...this.parser.libraryStatements,
            ...this.parser.importStatements
        ];
        for (let result of statements) {
            //register import statements
            if (result instanceof ImportStatement && result.filePathToken) {
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
                if (result instanceof LibraryStatement) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.libraryStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this
                    });
                } else if (result instanceof ImportStatement) {
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
     * Find a class by its full namespace-prefixed name.
     * Returns undefined if not found.
     * @param namespaceName - the namespace to resolve relative classes from.
     */
    public getClassByName(className: string, namespaceName?: string) {
        let scopes = this.program.getScopesForFile(this);
        let lowerClassName = className.toLowerCase();

        //if the class is namespace-prefixed, look only for this exact name
        if (className.includes('.')) {
            for (let scope of scopes) {
                let cls = scope.classLookup[lowerClassName];
                if (cls) {
                    return cls;
                }
            }

            //we have a class name without a namespace prefix.
        } else {
            let globalClass: ClassStatement;
            let namespacedClass: ClassStatement;
            for (let scope of scopes) {
                //get the global class if it exists
                let possibleGlobalClass = scope.classLookup[lowerClassName];
                if (possibleGlobalClass && !globalClass) {
                    globalClass = possibleGlobalClass;
                }
                if (namespaceName) {
                    let possibleNamespacedClass = scope.classLookup[namespaceName.toLowerCase() + '.' + lowerClassName];
                    if (possibleNamespacedClass) {
                        namespacedClass = possibleNamespacedClass;
                        break;
                    }
                }

            }

            if (namespacedClass) {
                return namespacedClass;
            } else if (globalClass) {
                return globalClass;
            }
        }
    }

    public findPropertyNameCompletions() {
        //Find every identifier in the whole file
        let identifiers = util.findAllDeep<Identifier>(this.ast.statements, (x) => {
            return x && x.kind === TokenKind.Identifier;
        });

        this.propertyNameCompletions = [];
        let names = {};
        for (let identifier of identifiers) {
            let ancestors = this.getAncestors(identifier.key);
            let parent = ancestors[ancestors.length - 1];

            let isObjectProperty = !!ancestors.find(x => (x instanceof DottedGetExpression) || (x instanceof AALiteralExpression));

            //filter out certain text items
            if (
                //don't filter out any object properties
                isObjectProperty === false && (
                    //top-level functions (they are handled elsewhere)
                    parent instanceof FunctionStatement ||
                    //local variables created or used by assignments
                    ancestors.find(x => x instanceof AssignmentStatement) ||
                    //local variables used in conditional statements
                    ancestors.find(x => x instanceof IfStatement) ||
                    //the 'as' keyword (and parameter types) when used in a type statement
                    ancestors.find(x => x instanceof FunctionParameter)
                )
            ) {
                continue;
            }

            let name = identifier.value.text;

            //filter duplicate names
            if (names[name]) {
                continue;
            }

            names[name] = true;
            this.propertyNameCompletions.push({
                label: name,
                kind: CompletionItemKind.Text
            });
        }
    }

    public propertyNameCompletions = [] as CompletionItem[];

    /**
     * Find all comment flags in the source code. These enable or disable diagnostic messages.
     * @param lines - the lines of the program
     */
    public getIgnores(tokens: Token[]) {
        //TODO use the comment statements found in the AST for this instead of text search
        let allCodesExcept1014 = diagnosticCodes.filter((x) => x !== DiagnosticMessages.unknownDiagnosticCode(0).code);
        this.commentFlags = [];
        for (let token of tokens) {
            let tokenized = util.tokenizeBsDisableComment(token);
            if (!tokenized) {
                continue;
            }

            let affectedRange: Range;
            if (tokenized.disableType === 'line') {
                affectedRange = Range.create(token.range.start.line, 0, token.range.start.line, token.range.start.character);
            } else if (tokenized.disableType === 'next-line') {
                affectedRange = Range.create(token.range.start.line + 1, 0, token.range.start.line + 1, Number.MAX_SAFE_INTEGER);
            }

            let commentFlag: CommentFlag;

            //statement to disable EVERYTHING
            if (tokenized.codes.length === 0) {
                commentFlag = {
                    file: this,
                    //null means all codes
                    codes: null,
                    range: token.range,
                    affectedRange: affectedRange
                };

                //disable specific diagnostic codes
            } else {
                let codes = [] as number[];
                for (let codeToken of tokenized.codes) {
                    let codeInt = parseInt(codeToken.code);
                    //add a warning for unknown codes
                    if (diagnosticCodes.includes(codeInt)) {
                        codes.push(codeInt);
                    } else {
                        this.diagnostics.push({
                            ...DiagnosticMessages.unknownDiagnosticCode(codeInt),
                            file: this,
                            range: codeToken.range
                        });
                    }
                }
                if (codes.length > 0) {
                    commentFlag = {
                        file: this,
                        codes: codes,
                        range: token.range,
                        affectedRange: affectedRange
                    };
                }
            }

            if (commentFlag) {
                this.commentFlags.push(commentFlag);

                //add an ignore for everything in this comment except for Unknown_diagnostic_code_1014
                this.commentFlags.push({
                    affectedRange: commentFlag.range,
                    range: commentFlag.range,
                    codes: allCodesExcept1014,
                    file: this
                });
            }
        }
    }

    public scopesByFunc = new Map<FunctionExpression, FunctionScope>();

    /**
     * Create a scope for every function in this file
     */
    private createFunctionScopes() {
        //find every function
        let functions = this.parser.functionExpressions;

        //create a functionScope for every function
        for (let func of functions) {
            let scope = new FunctionScope(func);

            //find parent function, and add this scope to it if found
            {
                let parentScope = this.scopesByFunc.get(func.parentFunction);

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
                    nameRange: param.name.range,
                    lineIndex: param.name.range.start.line,
                    name: param.name.text,
                    type: util.valueKindToBrsType(param.type.kind)
                });
            }

            this.scopesByFunc.set(func, scope);

            //find every statement in the scope
            this.functionScopes.push(scope);
        }

        //find every variable assignment in the whole file
        let assignmentStatements = this.parser.assignmentStatements;

        for (let statement of assignmentStatements) {

            //find this statement's function scope
            let scope = this.scopesByFunc.get(statement.containingFunction);

            //skip variable declarations that are outside of any scope
            if (scope) {
                scope.variableDeclarations.push({
                    nameRange: statement.name.range,
                    lineIndex: statement.name.range.start.line,
                    name: statement.name.text,
                    type: this.getBRSTypeFromAssignment(statement, scope)
                });
            }
        }
    }

    /**
     * Get all ancenstors of an object with the given key
     * @param statements
     * @param key
     */
    private getAncestors(key: string) {
        let parts = key.split('.');
        //throw out the last part (because that's the "child")
        parts.pop();

        let current = this.ast.statements;
        let ancestors = [];
        for (let part of parts) {
            current = current[part];
            ancestors.push(current);
        }
        return ancestors;
    }

    private getBRSTypeFromAssignment(assignment: AssignmentStatement, scope: FunctionScope): BrsType {
        try {
            //function
            if (assignment.value instanceof FunctionExpression) {
                let functionType = new FunctionType(util.valueKindToBrsType(assignment.value.returns));
                functionType.isSub = assignment.value.functionType.text === 'sub';
                if (functionType.isSub) {
                    functionType.returnType = new VoidType();
                }

                functionType.setName(assignment.name.text);
                for (let argument of assignment.value.parameters) {
                    let isRequired = !argument.defaultValue;
                    //TODO compute optional parameters
                    functionType.addParameter(argument.name.text, util.valueKindToBrsType(argument.type.kind), isRequired);
                }
                return functionType;

                //literal
            } else if (assignment.value instanceof LiteralExpression) {
                return util.valueKindToBrsType((assignment.value as any).value.kind);

                //function call
            } else if (assignment.value instanceof CallExpression) {
                let calleeName = (assignment.value.callee as any).name.text;
                if (calleeName) {
                    let func = this.getCallableByName(calleeName);
                    if (func) {
                        return func.type.returnType;
                    }
                }
            } else if (assignment.value instanceof VariableExpression) {
                let variableName = assignment.value.name.text;
                let variable = scope.getVariableByName(variableName);
                return variable.type;
            }
        } catch (e) {
            //do nothing. Just return dynamic
        }
        //fallback to dynamic
        return new DynamicType();
    }

    private getCallableByName(name: string) {
        name = name ? name.toLowerCase() : undefined;
        if (!name) {
            return;
        }
        for (let func of this.callables) {
            if (func.name.toLowerCase() === name) {
                return func;
            }
        }
    }

    private findCallables() {
        for (let statement of this.parser.functionStatements) {

            let functionType = new FunctionType(util.valueKindToBrsType(statement.func.returns));
            functionType.setName(statement.name.text);
            functionType.isSub = statement.func.functionType.text.toLowerCase() === 'sub';
            if (functionType.isSub) {
                functionType.returnType = new VoidType();
            }

            //extract the parameters
            let params = [] as CallableParam[];
            for (let param of statement.func.parameters) {
                let callableParam = {
                    name: param.name.text,
                    type: util.valueKindToBrsType(param.type.kind),
                    isOptional: !!param.defaultValue,
                    isRestArgument: false
                };
                params.push(callableParam);
                let isRequired = !param.defaultValue;
                functionType.addParameter(callableParam.name, callableParam.type, isRequired);
            }

            this.callables.push({
                isSub: statement.func.functionType.text.toLowerCase() === 'sub',
                name: statement.name.text,
                nameRange: statement.name.range,
                file: this,
                params: params,
                range: statement.func.range,
                type: functionType,
                getName: statement.getName.bind(statement),
                hasNamespace: !!statement.namespaceName
            });
        }
    }

    private findFunctionCalls() {
        this.functionCalls = [];
        //for every function in the file
        for (let func of this.parser.functionExpressions) {
            //for all function calls in this function
            for (let expression of func.callExpressions) {

                if (
                    //filter out dotted function invocations (i.e. object.doSomething()) (not currently supported. TODO support it)
                    (expression.callee as any).obj ||
                    //filter out method calls on method calls for now (i.e. getSomething().getSomethingElse())
                    (expression.callee as any).callee
                ) {
                    continue;
                }
                let functionName = (expression.callee as any).name.text;

                //callee is the name of the function being called
                let callee = expression.callee as VariableExpression;

                let columnIndexBegin = callee.range.start.character;
                let columnIndexEnd = callee.range.end.character;

                let args = [] as CallableArg[];
                //TODO convert if stmts to use instanceof instead
                for (let arg of expression.args as any) {
                    //is variable being passed into argument
                    if (arg.name) {
                        args.push({
                            range: arg.range,
                            //TODO - look up the data type of the actual variable
                            type: new DynamicType(),
                            text: arg.name.text
                        });
                    } else if (arg.value) {
                        let text = '';
                        /* istanbul ignore next: TODO figure out why value is undefined sometimes */
                        if (arg.value.value) {
                            text = arg.value.value.toString();
                        }
                        let callableArg = {
                            range: arg.range,
                            type: util.valueKindToBrsType(arg.value.kind),
                            text: text
                        };
                        //wrap the value in quotes because that's how it appears in the code
                        if (callableArg.type instanceof StringType) {
                            callableArg.text = '"' + callableArg.text + '"';
                        }
                        args.push(callableArg);
                    } else {
                        args.push({
                            range: arg.range,
                            type: new DynamicType(),
                            //TODO get text from other types of args
                            text: ''
                        });
                    }
                }
                let functionCall: FunctionCall = {
                    range: Range.create(expression.range.start, expression.closingParen.range.end),
                    functionScope: this.getFunctionScopeAtPosition(Position.create(callee.range.start.line, callee.range.start.character)),
                    file: this,
                    name: functionName,
                    nameRange: Range.create(callee.range.start.line, columnIndexBegin, callee.range.start.line, columnIndexEnd),
                    //TODO keep track of parameters
                    args: args
                };
                this.functionCalls.push(functionCall);
            }
        }
    }

    /**
     * Find the function scope at the given position.
     * @param position
     * @param functionScopes
     */
    public getFunctionScopeAtPosition(position: Position, functionScopes?: FunctionScope[]): FunctionScope {
        if (!functionScopes) {
            functionScopes = this.functionScopes;
        }
        for (let scope of functionScopes) {
            if (util.rangeContains(scope.range, position)) {
                //see if any of that scope's children match the position also, and give them priority
                let childScope = this.getFunctionScopeAtPosition(position, scope.childrenScopes);
                if (childScope) {
                    return childScope;
                } else {
                    return scope;
                }
            }
        }
    }

    /**
     * Get completions available at the given cursor. This aggregates all values from this file and the current scope.
     */
    public async getCompletions(position: Position, scope?: Scope): Promise<CompletionItem[]> {
        let result = [] as CompletionItem[];
        let parseMode = this.getParseMode();

        //wait for the file to finish processing
        await this.isReady();
        //a map of lower-case names of all added options
        let names = {};

        //handle script import completions
        let scriptImport = util.getScriptImportAtPosition(this.ownScriptImports, position);
        if (scriptImport) {
            return this.program.getScriptImportCompletions(this.pkgPath, scriptImport);
        }

        //if cursor is within a comment, disable completions
        let currentToken = this.getTokenAt(position);
        if (currentToken && currentToken.kind === TokenKind.Comment) {
            return [];
        }

        //determine if cursor is inside a function
        let functionScope = this.getFunctionScopeAtPosition(position);
        if (!functionScope) {
            //we aren't in any function scope, so return the keyword completions
            return KeywordCompletions;
        }

        //is next to a period (or an identifier that is next to a period). include the property names
        if (this.isPositionNextToDot(position)) {
            let namespaceCompletions = this.getNamespaceCompletions(currentToken, parseMode, scope);
            //if the text to the left of the dot is a part of a known namespace, complete with additional namespace information
            if (namespaceCompletions.length > 0) {
                result.push(...namespaceCompletions);
            } else {
                result.push(...scope.getPropertyNameCompletions());
            }

        } else {
            //include the global callables
            result.push(...scope.getCallablesAsCompletions(parseMode));

            //add `m` because that's always valid within a function
            result.push({
                label: 'm',
                kind: CompletionItemKind.Variable
            });
            names['m'] = true;

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
                    kind: variable.type instanceof FunctionType ? CompletionItemKind.Function : CompletionItemKind.Variable
                });
            }

            if (parseMode === ParseMode.BrighterScript) {
                //include the first part of namespaces
                let namespaces = scope.getNamespaceStatements();
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

    private getNamespaceCompletions(currentToken: Token, parseMode: ParseMode, scope: Scope) {
        //BrightScript does not support namespaces, so return an empty list in that case
        if (parseMode === ParseMode.BrightScript) {
            return [];
        }

        let completionName = this.getPartialVariableName(currentToken);
        //remove any trailing identifer and then any trailing dot, to give us the
        //name of its immediate parent namespace
        let closestParentNamespaceName = completionName.replace(/\.([a-z0-9_]*)?$/gi, '');

        let namespaceLookup = scope.namespaceLookup;
        let result = [] as CompletionItem[];
        for (let key in namespaceLookup) {
            let namespace = namespaceLookup[key.toLowerCase()];
            //completionName = "NameA."
            //completionName = "NameA.Na
            //NameA
            //NameA.NameB
            //NameA.NameB.NameC
            if (namespace.fullName.toLowerCase() === closestParentNamespaceName.toLowerCase()) {
                //add all of this namespace's immediate child namespaces
                for (let childKey in namespace.namespaces) {
                    result.push({
                        label: namespace.namespaces[childKey].lastPartName,
                        kind: CompletionItemKind.Module
                    });
                }

                //add function and class statement completions
                for (let stmt of namespace.statements) {
                    if (stmt instanceof ClassStatement) {
                        result.push({
                            label: stmt.name.text,
                            kind: CompletionItemKind.Class
                        });
                    } else if (stmt instanceof FunctionStatement) {
                        result.push({
                            label: stmt.name.text,
                            kind: CompletionItemKind.Function
                        });
                    }

                }

            }
        }

        return result;
    }
    /**
     * Given a current token, walk
     */
    private getPartialVariableName(currentToken: Token) {
        let identifierAndDotKinds = [TokenKind.Identifier, ...AllowedLocalIdentifiers, TokenKind.Dot];

        //consume tokens backwards until we find someting other than a dot or an identifier
        let tokens = [];
        for (let i = this.parser.tokens.indexOf(currentToken); i >= 0; i--) {
            currentToken = this.parser.tokens[i];
            if (identifierAndDotKinds.includes(currentToken.kind)) {
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
     * Determine if this file is a brighterscript file
     */
    private getParseMode() {
        return this.pathAbsolute.toLowerCase().endsWith('.bs') ? ParseMode.BrighterScript : ParseMode.BrightScript;
    }

    private isPositionNextToDot(position: Position) {
        let closestToken = this.getClosestToken(position);
        let previousToken = this.getPreviousToken(closestToken);
        //next to a dot
        if (closestToken.kind === TokenKind.Dot) {
            return true;
        } else if (closestToken.kind === TokenKind.Newline || previousToken.kind === TokenKind.Newline) {
            return false;
            //next to an identifier, which is next to a dot
        } else if (closestToken.kind === TokenKind.Identifier && previousToken.kind === TokenKind.Dot) {
            return true;
        } else {
            return false;
        }
    }

    public getPreviousToken(token: Token) {
        let idx = this.parser.tokens.indexOf(token);
        return this.parser.tokens[idx - 1];
    }

    /**
     * Find the first scope that has a namespace with this name.
     * Returns false if no namespace was found with that name
     */
    public calleeStartsWithNamespace(callee: Expression) {
        let left = callee as any;
        while (left instanceof DottedGetExpression) {
            left = left.obj;
        }

        if (left instanceof VariableExpression) {
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
        if (callee instanceof VariableExpression && namespaceName) {
            let lowerCalleeName = callee.name.text.toLowerCase();
            let scopes = this.program.getScopesForFile(this);
            for (let scope of scopes) {
                let namespace = scope.namespaceLookup[namespaceName.toLowerCase()];
                if (namespace.functionStatements[lowerCalleeName]) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the token closest to the position. if no token is found, the previous token is returned
     * @param position
     * @param tokens
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

    public async getHover(position: Position): Promise<Hover> {
        await this.isReady();
        //get the token at the position
        let token = this.getTokenAt(position);

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
            //get the function scope for this position (if exists)
            let functionScope = this.getFunctionScopeAtPosition(position);
            if (functionScope) {
                //find any variable with this name
                for (let varDeclaration of functionScope.variableDeclarations) {
                    //we found a variable declaration with this token text!
                    if (varDeclaration.name.toLowerCase() === lowerTokenText) {
                        let typeText: string;
                        if (varDeclaration.type instanceof FunctionType) {
                            typeText = varDeclaration.type.toString();
                        } else {
                            typeText = `${varDeclaration.name} as ${varDeclaration.type.toString()}`;
                        }
                        return {
                            range: token.range,
                            //append the variable name to the front for scope
                            contents: typeText
                        };
                    }
                }
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

    /**
     * Convert the brightscript/brighterscript source code into valid brightscript
     */
    public transpile() {
        const state = new TranspileState(this);
        if (this.needsTranspiled) {
            let programNode = new SourceNode(null, null, this.pathAbsolute, this.ast.transpile(state));
            let result = programNode.toStringWithSourceMap({
                file: this.pathAbsolute
            });
            return result;
        } else {
            //create a source map from the original source code
            let chunks = [] as (SourceNode | string)[];
            let lines = this.fileContents.split(/\r?\n/g);
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                let line = lines[lineIndex];
                chunks.push(
                    lineIndex > 0 ? '\n' : '',
                    new SourceNode(lineIndex + 1, 0, state.pathAbsolute, line)
                );
            }
            return new SourceNode(null, null, state.pathAbsolute, chunks).toStringWithSourceMap();
        }
    }

    public dispose() {
        this.parser?.dispose();
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
