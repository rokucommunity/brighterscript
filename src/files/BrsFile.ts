import * as path from 'path';
import { SourceNode } from 'source-map';
import { CompletionItem, CompletionItemKind, Hover, Position, Range } from 'vscode-languageserver';

import { Scope } from '../Scope';
import { diagnosticCodes, DiagnosticMessages } from '../DiagnosticMessages';
import { FunctionScope } from '../FunctionScope';
import { Callable, CallableArg, CallableParam, CommentFlag, FunctionCall, BsDiagnostic } from '../interfaces';
import { Deferred } from '../deferred';
import { FunctionParameter } from '../brsTypes';
import { Lexer, Token, TokenKind, Identifier } from '../lexer';
import { Parser, ParseMode } from '../parser';
import { AALiteralExpression, DottedGetExpression, FunctionExpression, LiteralExpression, CallExpression, VariableExpression } from '../parser/Expression';
import { AssignmentStatement, CommentStatement, FunctionStatement, IfStatement, Statement } from '../parser/Statement';
import { Program } from '../Program';
import { BrsType } from '../types/BrsType';
import { DynamicType } from '../types/DynamicType';
import { FunctionType } from '../types/FunctionType';
import { StringType } from '../types/StringType';
import { VoidType } from '../types/VoidType';
import util from '../util';
import { TranspileState } from '../parser/TranspileState';
import { ClassStatement } from '../parser/ClassStatement';
import { getManifest } from '../preprocessor/Manifest';
import { Preprocessor } from '../preprocessor/Preprocessor';

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

    private diagnostics = [] as BsDiagnostic[];

    public getDiagnostics() {
        return [...this.diagnostics];
    }

    public commentFlags = [] as CommentFlag[];

    public callables = [] as Callable[];

    public functionCalls = [] as FunctionCall[];

    public functionScopes = [] as FunctionScope[];

    public classStatements = [] as ClassStatement[];

    /**
     * Does this file need to be transpiled?
     */
    public needsTranspiled = false;

    /**
     * The AST for this file
     */
    private ast = [] as Statement[];

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

    private parser: Parser;

    /**
     * Calculate the AST for this file
     * @param fileContents
     */
    public async parse(fileContents: string) {
        if (this.parseDeferred.isCompleted) {
            throw new Error(`File was already processed. Create a new instance of BrsFile instead. ${this.pathAbsolute}`);
        }

        //split the text into lines
        let lines = util.getLines(fileContents);

        this.getIgnores(lines);

        //tokenize the input file
        let lexer = Lexer.scan(fileContents, {
            includeWhitespace: false
        });

        //remove all code inside false-resolved conditional compilation statements
        let manifest = await getManifest(this.program.rootDir);
        let preprocessor = new Preprocessor();

        //currently the preprocessor throws exceptions on syntax errors...so we need to catch it
        try {
            preprocessor.process(lexer.tokens, manifest);
        } catch (error) {
            //if the thrown error is DIFFERENT than any errors from the preprocessor, add that error to the list as well
            if (this.diagnostics.find((x) => x === error) === undefined) {
                this.diagnostics.push(error);
            }
        }

        //if the preprocessor generated tokens, use them.
        let tokens = preprocessor.processedTokens.length > 0 ? preprocessor.processedTokens : lexer.tokens;

        this.parser = Parser.parse(tokens, {
            mode: this.extension === 'brs' ? ParseMode.brightscript : ParseMode.brighterscript
        });

        //absorb all lexing/preprocessing/parsing diagnostics
        this.diagnostics.push(
            ...lexer.diagnostics as BsDiagnostic[],
            ...preprocessor.diagnostics as BsDiagnostic[],
            ...this.parser.diagnostics as BsDiagnostic[]
        );

        //attach this file to every diagnostic
        for (let diagnostic of this.diagnostics) {
            diagnostic.file = this;
        }

        //convert the brs library's errors into our format

        this.ast = this.parser.statements;

        //extract all callables from this file
        this.findCallables();

        //traverse the ast and find all functions and create a scope object
        this.createFunctionScopes(this.ast);

        //find all places where a sub/function is being called
        this.findFunctionCalls();

        //scan the full text for any word that looks like a variable
        this.findPropertyNameCompletions();

        this.findClassStatements();

        this.parseDeferred.resolve();
    }

    /**
     * Loop through all of the class statements and add them to `this.classStatements`
     */
    public findClassStatements() {
        for (let stmt of this.ast) {
            if (stmt instanceof ClassStatement) {
                this.classStatements.push(stmt);
            }
        }
    }

    /**
     * Find a class by its name.
     * Returns undefined if not found.
     */
    public getClassByName(className: string) {
        for (let stmt of this.classStatements) {
            if (stmt.name.text === className) {
                return stmt;
            }
        }
    }

    public findPropertyNameCompletions() {
        //Find every identifier in the whole file
        let identifiers = util.findAllDeep<Identifier>(this.ast, (x) => {
            return x && x.kind === TokenKind.Identifier;
        });

        this.propertyNameCompletions = [];
        let names = {};
        for (let identifier of identifiers) {
            let ancestors = this.getAncestors(this.ast, identifier.key);
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
    public getIgnores(lines: string[]) {
        //TODO use the comment statements found in the AST for this instead of text search
        let allCodesExcept1014 = diagnosticCodes.filter((x) => x !== DiagnosticMessages.unknownDiagnosticCode(0).code);
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
                        } else if (stmt.startsWith(':')) {
                            stmt = stmt.replace(':', '');
                            let codes = [] as number[];
                            //starting position + search.text length + 1 for the colon
                            let offset = idx + search.text.length + 1;
                            let codeTokens = util.tokenizeByWhitespace(stmt);
                            for (let codeToken of codeTokens) {
                                let codeInt = parseInt(codeToken.text);
                                //add a warning for unknown codes
                                if (!diagnosticCodes.includes(codeInt)) {
                                    this.diagnostics.push({
                                        ...DiagnosticMessages.unknownDiagnosticCode(codeInt),
                                        file: this,
                                        range: Range.create(lineIndex, offset + codeToken.startIndex, lineIndex, offset + codeToken.startIndex + codeToken.text.length)
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
            }
        }
    }

    public scopesByFunc = new Map<FunctionExpression, FunctionScope>();

    /**
     * Create a scope for every function in this file
     */
    private createFunctionScopes(statements: any) {
        //find every function
        let functions = util.findAllDeep<FunctionExpression>(this.ast, (x) => x instanceof FunctionExpression);

        //create a functionScope for every function
        for (let kvp of functions) {
            let func = kvp.value;
            let scope = new FunctionScope(func);

            let ancestors = this.getAncestors(statements, kvp.key);

            let parentFunc: FunctionExpression;
            //find parent function, and add this scope to it if found
            {
                for (let i = ancestors.length - 1; i >= 0; i--) {
                    if (ancestors[i] instanceof FunctionExpression) {
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
        let assignmentStatements = util.findAllDeep<AssignmentStatement>(this.ast, (x) => x instanceof AssignmentStatement);

        for (let kvp of assignmentStatements) {
            let statement = kvp.value;
            //find this statement's function scope
            let scope = this.getFunctionScopeAtPosition(statement.name.range.start);

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
    private getAncestors(statements: any[], key: string) {
        let parts = key.split('.');
        //throw out the last part (because that's the "child")
        parts.pop();

        let current = statements;
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
        this.callables = [];
        for (let statement of this.ast as any) {
            if (!(statement instanceof FunctionStatement)) {
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
                nameRange: statement.name.range,
                file: this,
                params: params,
                range: statement.func.range,
                type: functionType
            });
        }
    }

    private findFunctionCalls() {
        this.functionCalls = [];

        //for now, just dig into top-level function declarations.
        for (let statement of this.ast as any) {
            if (!statement.func) {
                continue;
            }
            let bodyStatements = statement.func.body.statements;
            for (let bodyStatement of bodyStatements) {
                if (bodyStatement.expression && bodyStatement.expression instanceof CallExpression) {
                    let expression: CallExpression = bodyStatement.expression;

                    //filter out dotted function invocations (i.e. object.doSomething()) (not currently supported. TODO support it)
                    if (bodyStatement.expression.callee.obj) {
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

        //wait for the file to finish processing
        await this.isReady();
        let names = {};

        //determine if cursor is inside a function
        let functionScope = this.getFunctionScopeAtPosition(position);
        if (!functionScope) {
            //we aren't in any function scope, so just return an empty list
            return result;
        }

        //if cursor is within a comment, disable completions
        let currentToken = this.getTokenAt(position);
        if (currentToken && currentToken.kind === TokenKind.Comment) {
            return [];
        }

        //is next to a period (or an identifier that is next to a period). include the property names
        if (this.isPositionNextToDot(position)) {
            result.push(...scope.getPropertyNameCompletions());

            //is NOT next to period
        } else {
            //include the global callables
            result.push(...scope.getCallablesAsCompletions());

            //include local variables
            let variables = functionScope.variableDeclarations;
            for (let variable of variables) {
                //skip duplicate variable names
                if (names[variable.name]) {
                    continue;
                }
                names[variable.name] = true;
                result.push({
                    label: variable.name,
                    kind: variable.type instanceof FunctionType ? CompletionItemKind.Function : CompletionItemKind.Variable
                });
            }
        }

        return result;
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
        let chunks = [] as Array<string | SourceNode>;
        for (let i = 0; i < this.ast.length; i++) {
            let statement = this.ast[i];
            let previousStatement = this.ast[i - 1];
            let nextStatement = this.ast[i + 1];


            if (!previousStatement) {
                //this is the first statement. do nothing related to spacing and newlines

                //if comment is on same line as prior sibling
            } else if (statement instanceof CommentStatement && previousStatement && statement.range.start.line === previousStatement.range.end.line) {
                chunks.push(
                    ' '
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
        let programNode = new SourceNode(null, null, this.pathAbsolute, chunks);
        let result = programNode.toStringWithSourceMap({
            file: this.pathAbsolute
        });
        return result;
    }

    public dispose() {
    }
}
