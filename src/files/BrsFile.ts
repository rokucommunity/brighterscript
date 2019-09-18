import * as path from 'path';
import { SourceNode } from 'source-map';
import { CompletionItem, CompletionItemKind, Hover, Position, Range } from 'vscode-languageserver';

import { Context } from '../Context';
import { diagnosticCodes, diagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, CallableArg, CallableParam, CommentFlag, Diagnostic, FunctionCall } from '../interfaces';
import * as brs from '../parser';
const Lexeme = brs.lexer.Lexeme;
import { Deferred } from '../deferred';
import { BrsError, ParseError } from '../parser/Error';
import { Lexer } from '../parser/lexer';
import { Parser } from '../parser/parser';
import { CommentStatement, FunctionStatement } from '../parser/parser/Statement';
import { Program } from '../Program';
import { BrsType } from '../types/BrsType';
import { DynamicType } from '../types/DynamicType';
import { FunctionType } from '../types/FunctionType';
import { StringType } from '../types/StringType';
import { VoidType } from '../types/VoidType';
import util from '../util';

/**
 * Holds all details about this file within the context of the whole program
 */
export class BrsFile {
    constructor(
        public pathAbsolute: string,
        /**
         * The absolute path to the file, relative to the pkg
         */
        public pkgPath: string,
        public program: Program
    ) {
        this.extension = path.extname(pathAbsolute).toLowerCase();

        //all BrighterScript files need to be transpiled
        if (this.extension === '.bs') {
            this.needsTranspiled = true;
        }
    }

    /**
     * The extension for this file
     */
    public extension: string;

    /**
     * The file needs to know when the program has settled (i.e. the `file-added` event has finished).
     * After calling this, the file is ready to be interacted with
     */
    public setFinishedLoading() {
        this.finishedLoadingDeferred.resolve();
    }
    private finishedLoadingDeferred = new Deferred();

    private parseDeferred = new Deferred();

    /**
     * Indicates that the file is completely ready for interaction
     */
    public isReady() {
        return Promise.all([this.finishedLoadingDeferred.promise, this.parseDeferred.promise]);
    }

    private diagnostics = [] as Diagnostic[];

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public commentFlags = [] as CommentFlag[];

    public callables = [] as Callable[];

    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

    /**
     * Does this file need to be transpiled?
     */
    public needsTranspiled = false;

    /**
     * The AST for this file
     */
    private ast = [] as brs.parser.Stmt.Statement[];
    private tokens = [] as brs.lexer.Token[];

    /**
     * Get the token at the specified position
     * @param position
     */
    private getTokenAt(position: Position) {
        for (let token of this.tokens) {
            if (util.rangeContains(util.locationToRange(token.location), position)) {
                return token;
            }
        }
    }

    private static idCounter = 1;
    private id = BrsFile.idCounter++;

    /**
     * Calculate the AST for this file
     * @param fileContents
     */
    public async parse(fileContents: string) {
        if (this.parseDeferred.isCompleted) {
            throw new Error(`File was already processed. Create a new file instead. ${this.pathAbsolute}`);
        }

        //split the text into lines
        let lines = util.getLines(fileContents);

        this.getIgnores(lines);

        let lexResult = Lexer.scan(fileContents);

        let tokens = lexResult.tokens;

        //remove all code inside false-resolved conditional compilation statements
        let manifest = await brs.preprocessor.getManifest(this.program.rootDir);
        let preprocessor = new brs.preprocessor.Preprocessor();
        let preprocessorResults = {
            errors: [] as Array<BrsError | ParseError>,
            processedTokens: []
        };
        let preprocessorWasSuccessful: boolean;
        let handle;
        //currently the preprocessor throws exceptions on syntax errors...so we need to catch it
        try {
            handle = preprocessor.onError((err) => {
                preprocessorResults.errors.push(err);
            });
            preprocessorResults = <any>preprocessor.preprocess(tokens, manifest);
            preprocessorWasSuccessful = true;
        } catch (e) {
            preprocessorWasSuccessful = false;
            //if the thrown error is DIFFERENT than any errors from the preprocessor, add that error to the list as well
            if (preprocessorResults.errors.find((ex) => ex === e) === undefined) {
                preprocessorResults.errors.push(e as any);
            }
        }
        //dispose of the onError event listener
        if (handle) {
            handle.dispose();
        }
        //TODO have brs change the type of `processedTokens` to not be readonly array
        this.tokens = preprocessorWasSuccessful ? (preprocessorResults.processedTokens as any) : lexResult.tokens;

        let parser = new Parser();
        let parseResult = parser.parse(this.tokens, this.extension === 'brs' ? 'brightscript' : 'brighterscript');

        let errors = [...lexResult.errors, ...<any>parseResult.errors, ...<any>preprocessorResults.errors];

        //convert the brs library's errors into our format
        this.diagnostics.push(...this.standardizeLexParseErrors(errors, lines));

        this.ast = <any>parseResult.statements;

        //extract all callables from this file
        this.findCallables(lines);

        //traverse the ast and find all functions and create a scope object
        this.createFunctionScopes(lines, this.ast);

        //find all places where a sub/function is being called
        this.findFunctionCalls(lines);

        this.parseDeferred.resolve();
    }

    public standardizeLexParseErrors(errors: ParseError[], lines: string[]) {
        let standardizedDiagnostics = [] as Diagnostic[];
        for (let error of errors) {
            let diagnostic = <Diagnostic>{
                code: 1000,
                location: util.locationToRange(error.location),
                file: this,
                severity: 'error',
                message: error.message
            };
            standardizedDiagnostics.push(diagnostic);
        }

        return standardizedDiagnostics;
    }

    /**
     * Find all comment flags in the source code. These enable or disable diagnostic messages.
     * @param lines - the lines of the program
     */
    public getIgnores(lines: string[]) {
        let allCodesExcept1014 = diagnosticCodes.filter((x) => x !== diagnosticMessages.Unknown_diagnostic_code_1014(0).code);
        this.commentFlags = [];
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            let line = lines[lineIndex];
            let nextLineLength = lines[lineIndex + 1] ? lines[lineIndex + 1].length : Number.MAX_SAFE_INTEGER;

            //bs:disable-next-line and bs:disable-line
            {
                let searches = [{
                    text: `'bs:disable-next-line`,
                    lineOffset: 1,
                    getAffectedRange: () => {
                        return Range.create(lineIndex + 1, 0, lineIndex + 1, nextLineLength);
                    }
                }, {
                    text: `'bs:disable-line`,
                    lineOffset: 0,
                    getAffectedRange: (idx: number) => {
                        return Range.create(lineIndex, 0, lineIndex, idx);
                    }
                }];

                for (let search of searches) {
                    //find the disable-next-line
                    let idx = line.indexOf(search.text);
                    if (idx > -1) {
                        let affectedRange = search.getAffectedRange(idx);
                        let stmt = line.substring(idx).trim();
                        stmt = stmt.replace(search.text, '');
                        stmt = stmt.trim();

                        let commentFlag: CommentFlag;

                        //statement to disable EVERYTHING
                        if (stmt.length === 0) {
                            commentFlag = {
                                file: this,
                                //null means all codes
                                codes: null,
                                range: Range.create(lineIndex, idx, lineIndex, idx + search.text.length),
                                affectedRange: affectedRange
                            };

                            //disable specific rules on the next line
                        } else if (stmt.indexOf(':') === 0) {
                            stmt = stmt.replace(':', '');
                            let codes = [] as number[];
                            //starting position + search.text length + 1 for the colon
                            let offset = idx + search.text.length + 1;
                            let codeTokens = util.tokenizeByWhitespace(stmt);
                            for (let codeToken of codeTokens) {
                                let codeInt = parseInt(codeToken.text);
                                //add a warning for unknown codes
                                if (diagnosticCodes.indexOf(codeInt) === -1) {
                                    this.diagnostics.push({
                                        ...diagnosticMessages.Unknown_diagnostic_code_1014(codeInt),
                                        file: this,
                                        location: Range.create(lineIndex, offset + codeToken.startIndex, lineIndex, offset + codeToken.startIndex + codeToken.text.length),
                                        severity: 'warning'
                                    });
                                } else {
                                    codes.push(codeInt);
                                }
                            }
                            if (codes.length > 0) {
                                commentFlag = {
                                    file: this,
                                    codes: codes,
                                    range: Range.create(lineIndex, idx, lineIndex, line.length),
                                    affectedRange: affectedRange,
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
            }
        }
    }

    public scopesByFunc = new Map<brs.parser.Expr.FunctionExpression, FunctionScope>();

    /**
     * Create a scope for every function in this file
     */
    private createFunctionScopes(lines: string[], statements: any, parent?: FunctionScope) {
        //find every function
        let functions = util.findAllDeep<brs.parser.Expr.FunctionExpression>(this.ast, (x) => x instanceof brs.parser.Expr.FunctionExpression);

        //create a functionScope for every function
        for (let kvp of functions) {
            let func = kvp.value;
            let scope = new FunctionScope(func);

            let ancestors = this.getAncestors(statements, kvp.key);

            let parentFunc: brs.parser.Expr.FunctionExpression;
            //find parent function, and add this scope to it if found
            {
                for (let i = ancestors.length - 1; i >= 0; i--) {
                    if (ancestors[i] instanceof brs.parser.Expr.FunctionExpression) {
                        parentFunc = ancestors[i];
                        break;
                    }
                }
                let parentScope = this.scopesByFunc.get(parentFunc);

                //add this child scope to its parent
                if (parentScope) {
                    parentScope.childrenScopes.push(scope);
                }
                //store the parent scope for this scope
                scope.parentScope = parentScope;
            }

            //compute the range of this func
            scope.bodyRange = util.getBodyRangeForFunc(func);
            scope.range = Range.create(
                func.functionType.location.start.line - 1,
                func.functionType.location.start.column,
                func.end.location.end.line - 1,
                func.end.location.end.column
            );

            //add every parameter
            for (let param of func.parameters) {
                scope.variableDeclarations.push({
                    nameRange: util.locationToRange(param.name.location),
                    lineIndex: param.name.location.start.line - 1,
                    name: param.name.text,
                    type: util.valueKindToBrsType(param.type.kind)
                });
            }

            this.scopesByFunc.set(func, scope);

            //find every statement in the scope
            this.functionScopes.push(scope);
        }

        //find every variable assignment in the whole file
        let assignmentStatements = util.findAllDeep<brs.parser.Stmt.AssignmentStatement>(this.ast, (x) => x instanceof brs.parser.Stmt.AssignmentStatement);

        for (let kvp of assignmentStatements) {
            let statement = kvp.value;
            let nameRange = util.locationToRange(statement.name.location);

            //find this statement's function scope
            let scope = this.getFunctionScopeAtPosition(nameRange.start);

            //skip variable declarations that are outside of any scope
            if (scope) {
                scope.variableDeclarations.push({
                    nameRange: nameRange,
                    lineIndex: statement.name.location.start.line - 1,
                    name: statement.name.text,
                    type: this.getBRSTypeFromAssignment(statement, scope)
                });
            }
        }
    }

    /**
     * Given a set of statements and top-level ast,
     * find the closest function ancestor for the given key
     * @param statements
     * @param key
     */
    private getAncestors(statements: any[], key: string) {
        let parts = key.split('.');
        //throw out the last part, because that is already a func (it's the "child")
        parts.pop();

        let current = statements;
        let ancestors = [];
        for (let part of parts) {
            current = current[part];
            ancestors.push(current);
        }
        return ancestors;
    }

    private getBRSTypeFromAssignment(assignment: brs.parser.Stmt.AssignmentStatement, scope: FunctionScope): BrsType {
        try {
            //function
            if (assignment.value instanceof brs.parser.Expr.FunctionExpression) {
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
            } else if (assignment.value instanceof brs.parser.Expr.Literal) {
                return util.valueKindToBrsType((assignment.value as any).value.kind);

                //function call
            } else if (assignment.value instanceof brs.parser.Expr.Call) {
                let calleeName = (assignment.value.callee as any).name.text;
                if (calleeName) {
                    let func = this.getCallableByName(calleeName);
                    if (func) {
                        return func.type.returnType;
                    }
                }
            } else if (assignment.value instanceof brs.parser.Expr.Variable) {
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

    private findCallables(lines: string[]) {
        this.callables = [];
        for (let statement of this.ast as any) {
            if (!(statement instanceof brs.parser.Stmt.FunctionStatement)) {
                continue;
            }

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
                nameRange: util.locationToRange(statement.name.location),
                file: this,
                params: params,
                //the function body starts on the next line (since we can't have one-line functions)
                bodyRange: util.getBodyRangeForFunc(statement.func),
                type: functionType
            });
        }
    }

    private findFunctionCalls(lines: string[]) {
        this.functionCalls = [];

        //for now, just dig into top-level function declarations.
        for (let statement of this.ast as any) {
            if (!statement.func) {
                continue;
            }
            let bodyStatements = statement.func.body.statements;
            for (let bodyStatement of bodyStatements) {
                if (bodyStatement.expression && bodyStatement.expression instanceof brs.parser.Expr.Call) {
                    let expression: brs.parser.Expr.Call = bodyStatement.expression;

                    //filter out dotted function invocations (i.e. object.doSomething()) (not currently supported. TODO support it)
                    if (bodyStatement.expression.callee.obj) {
                        continue;
                    }
                    let functionName = (expression.callee as any).name.text;

                    //callee is the name of the function being called
                    let callee = expression.callee as brs.parser.Expr.Variable;

                    let calleeRange = util.locationToRange(callee.location);

                    let columnIndexBegin = calleeRange.start.character;
                    let columnIndexEnd = calleeRange.end.character;

                    let args = [] as CallableArg[];
                    //TODO convert if stmts to use instanceof instead
                    for (let arg of expression.args as any) {
                        //is variable being passed into argument
                        if (arg.name) {
                            args.push({
                                range: util.locationToRange(arg.location),
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
                                range: util.locationToRange(arg.location),
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
                                range: util.locationToRange(arg.location),
                                type: new DynamicType(),
                                //TODO get text from other types of args
                                text: ''
                            });
                        }
                    }
                    let functionCall: FunctionCall = {
                        range: util.brsRangeFromPositions(expression.location.start, expression.closingParen.location.end),
                        functionScope: this.getFunctionScopeAtPosition(Position.create(calleeRange.start.line, calleeRange.start.character)),
                        file: this,
                        name: functionName,
                        nameRange: Range.create(calleeRange.start.line, columnIndexBegin, calleeRange.start.line, columnIndexEnd),
                        //TODO keep track of parameters
                        args: args
                    };
                    this.functionCalls.push(functionCall);
                }
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

    public async getCompletions(position: Position, context?: Context) {
        let result = {
            completions: [] as CompletionItem[],
            includeContextCallables: true,
        };

        let id = this.id;
        id = id;
        //wait for the file to finish processing
        await this.parseDeferred.promise;

        //determine if cursor is inside a function
        let functionScope = this.getFunctionScopeAtPosition(position);
        if (!functionScope) {
            result.includeContextCallables = false;
            //we aren't in any function scope, so just return an empty list
            return result;
        }

        //TODO: if cursor is within a comment, disable completions

        let variables = functionScope.variableDeclarations;
        let names = {};
        for (let variable of variables) {
            //skip duplicate variable names
            if (names[variable.name]) {
                continue;
            }
            names[variable.name] = true;
            result.completions.push({
                label: variable.name,
                kind: variable.type instanceof FunctionType ? CompletionItemKind.Function : CompletionItemKind.Variable
            });
        }
        return result;
    }

    public getHover(position: Position): Hover {
        //get the token at the position
        let token = this.getTokenAt(position);

        let hoverTokenTypes = [
            Lexeme.Identifier,
            Lexeme.Function,
            Lexeme.EndFunction,
            Lexeme.Sub,
            Lexeme.EndSub
        ];

        //throw out invalid tokens and the wrong kind of tokens
        if (!token || hoverTokenTypes.indexOf(token.kind) === -1) {
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
                            range: util.locationToRange(token.location),
                            //append the variable name to the front for context
                            contents: typeText
                        };
                    }
                }
            }
        }

        //look through all callables in relevant contexts
        {
            let contexts = this.program.getContextsForFile(this);
            for (let context of contexts) {
                let callable = context.getCallableByName(lowerTokenText);
                if (callable) {
                    return {
                        range: util.locationToRange(token.location),
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
        let chunks = [] as Array<string | SourceNode>;
        let state = {
            pkgPath: this.pkgPath,
            blockDepth: 0,
            lineage: []
        };
        for (let i = 0; i < this.ast.length; i++) {
            let statement = this.ast[i];
            let previousStatement = this.ast[i - 1];
            let nextStatement = this.ast[i + 1];

            //if comment is on same line as prior sibling
            if (statement instanceof CommentStatement && previousStatement && statement.location.start.line === previousStatement.location.end.line) {
                chunks.push(
                    ' ',
                );

                //add double newline if this is a comment, and next is a function
            } else if (statement instanceof CommentStatement && nextStatement && nextStatement instanceof FunctionStatement) {
                chunks.push('\n\n');

                //add double newline if is function not preceeded by a comment
            } else if (statement instanceof FunctionStatement && previousStatement && !(previousStatement instanceof CommentStatement)) {
                chunks.push('\n\n');
            } else {
                //separate statements by a single newline
                chunks.push('\n');
            }

            chunks.push(...statement.transpile(state));
        }
        let programNode = new SourceNode(null, null, this.pkgPath, chunks);
        return programNode.toStringWithSourceMap({
            file: this.pkgPath
        });
    }

    public dispose() {
    }
}
