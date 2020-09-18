import {
    TokenKind,
    Token,
    Identifier,
    BlockTerminator,
    AllowedLocalIdentifiers,
    AssignmentOperators,
    DisallowedLocalIdentifiersText,
    AllowedProperties,
    Lexer,
    BrighterScriptSourceLiterals
} from '../lexer';

import {
    BrsInvalid,
    BrsBoolean,
    BrsString,
    Int32,
    ValueKind,
    Argument,
    StdlibArgument,
    FunctionParameter,
    valueKindFromString
} from '../brsTypes';
import {
    Statement,
    FunctionStatement,
    CommentStatement,
    PrintSeparatorTab,
    PrintSeparatorSpace,
    AssignmentStatement,
    WhileStatement,
    ExitWhileStatement,
    ForStatement,
    ForEachStatement,
    ExitForStatement,
    LibraryStatement,
    Block,
    IfStatement,
    ElseIf,
    DottedSetStatement,
    IndexedSetStatement,
    ExpressionStatement,
    IncrementStatement,
    ReturnStatement,
    EndStatement,
    PrintStatement,
    LabelStatement,
    GotoStatement,
    StopStatement,
    NamespaceStatement,
    Body,
    ImportStatement
} from './Statement';
import { DiagnosticMessages, DiagnosticInfo } from '../DiagnosticMessages';
import { util } from '../util';
import {
    AALiteralExpression,
    AAMemberExpression,
    ArrayLiteralExpression,
    BinaryExpression,
    CallExpression,
    CallfuncExpression,
    DottedGetExpression,
    Expression,
    FunctionExpression,
    GroupingExpression,
    IndexedGetExpression,
    LiteralExpression,
    NamespacedVariableNameExpression,
    NewExpression,
    UnaryExpression,
    VariableExpression,
    XmlAttributeGetExpression,
    TemplateStringExpression,
    EscapedCharCodeLiteral,
    TemplateStringQuasiExpression,
    TaggedTemplateStringExpression,
    SourceLiteralExpression
} from './Expression';
import { Diagnostic, Range } from 'vscode-languageserver';
import { ClassFieldStatement, ClassMethodStatement, ClassStatement } from './ClassStatement';
import { Logger } from '../Logger';

export class Parser {
    /**
     * The array of tokens passed to `parse()`
     */
    public tokens: Token[];

    /**
     * The current token index
     */
    public current: number;

    /**
     * The list of statements for the parsed file
     */
    public ast: Body;

    //TODO remove this once we have verified all of the tests.
    public statements: Statement[];

    /**
     * The list of diagnostics found during the parse process
     */
    public diagnostics: Diagnostic[];

    /**
     * The depth of the calls to function declarations. Helps some checks know if they are at the root or not.
     */
    private namespaceAndFunctionDepth: number;

    /**
     * The options used to parse the file
     */
    public options: ParseOptions;

    private globalTerminators = [] as TokenKind[][];

    /**
     * All function expressions defined in this file
     */
    public functionExpressions = [] as FunctionExpression[];

    /**
     * All `new <ClassName>` expressions defined in this file
     */
    public newExpressions = [] as NewExpression[];

    /**
     * All assignment statements in this file
     */
    public assignmentStatements = [] as AssignmentStatement[];

    /**
     * When a namespace has been started, this gets set. When it's done, this gets unset.
     * It is useful for passing the namespace into certain statements that need it
     */
    private currentNamespaceName: NamespacedVariableNameExpression;

    /**
     * When a FunctionExpression has been started, this gets set. When it's done, this gets unset.
     * It's useful for passing the function into statements and expressions that need to be located
     * by function later on.
     */
    private currentFunctionExpression: FunctionExpression;

    /**
     * A list of allowed local identifiers. We store this in a property because we augment the list in the constructor
     * based on the parse mode
     */
    private allowedLocalIdentifiers: TokenKind[];

    /**
     * Get the currently active global terminators
     */
    private peekGlobalTerminators() {
        return this.globalTerminators[this.globalTerminators.length - 1] ?? [];
    }

    /**
     * Static wrapper around creating a new parser and parsing a list of tokens
     */
    public static parse(source: string, options?: ParseOptions): Parser;
    public static parse(tokens: Token[], options?: ParseOptions): Parser;
    public static parse(toParse: Token[] | string, options?: ParseOptions): Parser {
        let tokens: Token[];
        if (typeof toParse === 'string') {
            tokens = Lexer.scan(toParse).tokens;
        } else {
            tokens = toParse;
        }
        return new Parser().parse(tokens, options);
    }

    /**
     * Parses an array of `Token`s into an abstract syntax tree
     * @param toParse the array of tokens to parse. May not contain any whitespace tokens
     * @returns the same instance of the parser which contains the diagnostics and statements
     */
    public parse(tokens: Token[], options?: ParseOptions) {
        this.logger = options?.logger ?? new Logger();
        this.tokens = tokens;
        this.options = this.sanitizeParseOptions(options);
        this.allowedLocalIdentifiers = [
            ...AllowedLocalIdentifiers,
            //when in plain brightscript mode, the BrighterScript source literals can be used as regular variables
            ...(this.options.mode === ParseMode.BrightScript ? BrighterScriptSourceLiterals : [])
        ];
        this.current = 0;
        this.diagnostics = [];
        this.namespaceAndFunctionDepth = 0;

        this.ast = this.body();
        this.statements = this.ast.statements;

        return this;
    }

    private logger: Logger;

    private body() {
        let body = new Body([]);
        if (this.tokens.length > 0) {
            try {
                while (
                    //not at end of tokens
                    !this.isAtEnd() &&
                    //the next token is not one of the end terminators
                    !this.check(...this.peekGlobalTerminators())
                ) {
                    let dec = this.declaration();
                    if (dec) {
                        body.statements.push(dec);
                    }
                }
            } catch (parseError) {
                //do nothing with the parse error for now. perhaps we can remove this?
                console.error(parseError);
            }
        }
        return body;
    }

    private sanitizeParseOptions(options: ParseOptions) {
        return {
            mode: 'brightscript',
            ...(options || {})
        } as ParseOptions;
    }

    /**
     * Determine if the parser is currently parsing tokens at the root level.
     */
    private isAtRootLevel() {
        return this.namespaceAndFunctionDepth === 0;
    }

    /**
     * Throws an error if the input file type is not BrighterScript
     */
    private warnIfNotBrighterScriptMode(featureName: string) {
        if (this.options.mode !== ParseMode.BrighterScript) {
            let diagnostic = {
                ...DiagnosticMessages.bsFeatureNotSupportedInBrsFiles(featureName),
                range: this.peek().range
            } as Diagnostic;
            this.diagnostics.push(diagnostic);
        }
    }

    /**
     * Throws an exception using the last diagnostic message
     */
    private lastDiagnosticAsError() {
        let error = new Error(this.diagnostics[this.diagnostics.length - 1]?.message);
        (error as any).isDiagnostic = true;
        return error;
    }

    private declaration(...additionalTerminators: BlockTerminator[]): Statement | undefined {
        try {
            // consume any leading newlines
            while (this.match(TokenKind.Newline)) { }

            if (this.check(TokenKind.Class)) {
                return this.classDeclaration();
            }

            if (this.check(TokenKind.Sub, TokenKind.Function)) {
                return this.functionDeclaration(false);
            }

            if (this.checkLibrary()) {
                return this.libraryStatement();
            }

            if (this.check(TokenKind.Namespace)) {
                return this.namespaceStatement();
            }

            // BrightScript is like python, in that variables can be declared without a `var`,
            // `let`, (...) keyword. As such, we must check the token *after* an identifier to figure
            // out what to do with it.
            if (
                this.check(TokenKind.Identifier, ...this.allowedLocalIdentifiers) &&
                this.checkNext(...AssignmentOperators)
            ) {
                return this.assignment(...additionalTerminators);
            }

            if (this.check(TokenKind.Comment)) {
                let stmt = this.commentStatement();
                //scrap consecutive newlines
                while (this.match(TokenKind.Newline)) {

                }
                return stmt;
            }

            //catch certain global terminators to prevent unnecessary lookahead (i.e. like `end namespace`, no need to continue)
            if (this.check(...this.peekGlobalTerminators())) {
                return;
            }

            return this.statement(...additionalTerminators);
        } catch (error) {
            //if the error is not a diagnostic, then log the error for debugging purposes
            if (!error.isDiagnostic) {
                this.logger.error(error);
            }
            this.synchronize();
        }
    }

    /**
     * A BrighterScript class declaration
     */
    private classDeclaration(): ClassStatement {
        this.warnIfNotBrighterScriptMode('class declarations');
        let classKeyword = this.consume(
            DiagnosticMessages.expectedClassKeyword(),
            TokenKind.Class
        );
        let extendsKeyword: Token;
        let parentClassName: NamespacedVariableNameExpression;

        //get the class name
        let className = this.tryConsume(DiagnosticMessages.expectedIdentifierAfterKeyword('class'), TokenKind.Identifier, ...this.allowedLocalIdentifiers) as Identifier;

        //see if the class inherits from parent
        if (this.peek().text.toLowerCase() === 'extends') {
            extendsKeyword = this.advance();

            parentClassName = this.getNamespacedVariableNameExpression();
            //the only thing allowed after a class declaration is a comment or a newline
            this.flagUntil(TokenKind.Comment, TokenKind.Newline);
        }
        let body = [] as Statement[];

        //consume any trailing comments on the class declaration line
        if (this.check(TokenKind.Comment)) {
            body.push(this.commentStatement());
        }

        //consume newlines (at least one)
        while (this.match(TokenKind.Newline)) {
        }

        //gather up all class members (Fields, Methods)
        while (this.check(TokenKind.Public, TokenKind.Protected, TokenKind.Private, TokenKind.Function, TokenKind.Sub, TokenKind.Comment, TokenKind.Identifier, ...AllowedProperties)) {
            try {
                let accessModifier: Token;
                if (this.check(TokenKind.Public, TokenKind.Protected, TokenKind.Private)) {
                    //use actual access modifier
                    accessModifier = this.advance();
                }

                let overrideKeyword: Token;
                if (this.peek().text.toLowerCase() === 'override') {
                    overrideKeyword = this.advance();
                }

                //methods (function/sub keyword OR identifier followed by opening paren)
                if (this.check(TokenKind.Function, TokenKind.Sub) || (this.check(TokenKind.Identifier, ...AllowedProperties) && this.checkNext(TokenKind.LeftParen))) {
                    let funcDeclaration = this.functionDeclaration(false);

                    //remove this function from the lists because it's a class method
                    this.functionExpressions.pop();

                    //if we have an overrides keyword AND this method is called 'new', that's not allowed
                    if (overrideKeyword && funcDeclaration.name.text.toLowerCase() === 'new') {
                        this.diagnostics.push({
                            ...DiagnosticMessages.cannotUseOverrideKeywordOnConstructorFunction(),
                            range: overrideKeyword.range
                        });
                    }
                    body.push(
                        new ClassMethodStatement(
                            accessModifier,
                            funcDeclaration.name,
                            funcDeclaration.func,
                            overrideKeyword
                        )
                    );

                    //fields
                } else if (this.check(TokenKind.Identifier, ...AllowedProperties)) {
                    body.push(
                        this.classFieldDeclaration(accessModifier)
                    );

                    //class fields cannot be overridden
                    if (overrideKeyword) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.classFieldCannotBeOverridden(),
                            range: overrideKeyword.range
                        });
                    }

                    //comments
                } else if (this.check(TokenKind.Comment)) {
                    body.push(
                        this.commentStatement()
                    );
                }
            } catch (e) {
                //throw out any failed members and move on to the next line
                this.flagUntil(TokenKind.Newline, TokenKind.Eof);
            }

            if (this.check(TokenKind.Comment)) {
                body.push(
                    this.commentStatement()
                );
            }

            //if the previous token was NOT a newline, then
            //there shouldn't be anything else after the method / field declaration, so flag extra stuff
            if (!this.checkPrevious(TokenKind.Newline)) {
                this.flagUntil(TokenKind.Newline, TokenKind.Eof);
            }

            //consume trailing newlines
            while (this.match(TokenKind.Newline)) { }
        }

        //consume trailing newlines
        while (this.match(TokenKind.Newline)) { }

        let endingKeyword = this.advance();
        if (endingKeyword.kind !== TokenKind.EndClass) {
            this.diagnostics.push({
                ...DiagnosticMessages.couldNotFindMatchingEndKeyword('class'),
                range: endingKeyword.range
            });
        }
        //consume any trailing newlines
        while (this.match(TokenKind.Newline)) {

        }

        const result = new ClassStatement(
            classKeyword,
            className,
            body,
            endingKeyword,
            extendsKeyword,
            parentClassName,
            this.currentNamespaceName
        );
        return result;
    }

    private classFieldDeclaration(accessModifier: Token | null) {
        let name = this.consume(
            DiagnosticMessages.expectedClassFieldIdentifier(),
            TokenKind.Identifier,
            ...AllowedProperties
        ) as Identifier;
        let asToken: Token;
        let fieldType: Token;
        //look for `as SOME_TYPE`
        if (this.check(TokenKind.As)) {
            asToken = this.advance();
            fieldType = this.advance();

            //no field type specified
            if (!valueKindFromString(`${fieldType.text}`) && !this.check(TokenKind.Identifier)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedValidTypeToFollowAsKeyword(),
                    range: this.peek().range
                });
            }
        }

        let initialValue: Expression;
        let equal: Token;
        //if there is a field initializer
        if (this.check(TokenKind.Equal)) {
            equal = this.advance();
            initialValue = this.expression();
        }

        return new ClassFieldStatement(
            accessModifier,
            name,
            asToken,
            fieldType,
            equal,
            initialValue
        );
    }

    /**
     * An array of CallExpression for the current function body
     */
    private callExpressions = [];

    private functionDeclaration(isAnonymous: true): FunctionExpression;
    private functionDeclaration(isAnonymous: false): FunctionStatement;
    private functionDeclaration(isAnonymous: boolean) {
        let previousCallExpressions = this.callExpressions;
        this.callExpressions = [];
        try {
            //track depth to help certain statements need to know if they are contained within a function body
            this.namespaceAndFunctionDepth++;
            let functionType: Token;
            if (this.check(TokenKind.Sub, TokenKind.Function)) {
                functionType = this.advance();
            } else {
                this.diagnostics.push({
                    ...DiagnosticMessages.missingCallableKeyword(),
                    range: this.peek().range
                });
                functionType = {
                    isReserved: true,
                    kind: TokenKind.Function,
                    text: 'function',
                    //zero-length location means derived
                    range: {
                        start: this.peek().range.start,
                        end: this.peek().range.start
                    }
                };
            }
            let isSub = functionType && functionType.kind === TokenKind.Sub;
            let functionTypeText = isSub ? 'sub' : 'function';
            let name: Identifier;
            let returnType: ValueKind;
            let leftParen: Token;

            if (isSub) {
                returnType = ValueKind.Void;
            } else {
                returnType = ValueKind.Dynamic;
            }

            if (isAnonymous) {
                leftParen = this.consume(
                    DiagnosticMessages.expectedLeftParenAfterCallable(functionTypeText),
                    TokenKind.LeftParen
                );
            } else {
                name = this.consume(
                    DiagnosticMessages.expectedNameAfterCallableKeyword(functionTypeText),
                    TokenKind.Identifier,
                    ...AllowedProperties
                ) as Identifier;
                leftParen = this.consume(
                    DiagnosticMessages.expectedLeftParenAfterCallableName(functionTypeText),
                    TokenKind.LeftParen
                );

                //prevent functions from ending with type designators
                let lastChar = name.text[name.text.length - 1];
                if (['$', '%', '!', '#', '&'].includes(lastChar)) {
                    //don't throw this error; let the parser continue
                    this.diagnostics.push({
                        ...DiagnosticMessages.functionNameCannotEndWithTypeDesignator(functionTypeText, name.text, lastChar),
                        range: name.range
                    });
                }
            }

            let params: FunctionParameter[] = [];
            let asToken: Token;
            let typeToken: Token;
            if (!this.check(TokenKind.RightParen)) {
                do {
                    if (params.length >= CallExpression.MaximumArguments) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.tooManyCallableParameters(params.length, CallExpression.MaximumArguments),
                            range: this.peek().range
                        });
                    }

                    params.push(this.functionParameter());
                } while (this.match(TokenKind.Comma));
            }
            let rightParen = this.advance();

            if (this.check(TokenKind.As)) {
                asToken = this.advance();

                typeToken = this.advance();
                let typeString = typeToken.text || '';
                let maybeReturnType = valueKindFromString(typeString);

                if (!maybeReturnType) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.invalidFunctionReturnType(typeString),
                        range: typeToken.range
                    });
                }

                returnType = maybeReturnType;
            }

            params.reduce((haveFoundOptional: boolean, arg: Argument) => {
                if (haveFoundOptional && !arg.defaultValue) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.requiredParameterMayNotFollowOptionalParameter(arg.name.text),
                        range: arg.range
                    });
                }

                return haveFoundOptional || !!arg.defaultValue;
            }, false);
            let comment: CommentStatement;
            //get a comment if available
            if (this.check(TokenKind.Comment)) {
                comment = this.commentStatement();
            }

            this.consume(
                DiagnosticMessages.expectedNewlineOrColonAfterCallableSignature(functionTypeText),
                TokenKind.Newline,
                TokenKind.Colon
            );
            while (this.match(TokenKind.Newline)) { }
            let func = new FunctionExpression(
                params,
                returnType,
                undefined, //body
                functionType,
                undefined, //ending keyword
                leftParen,
                rightParen,
                asToken,
                typeToken,
                this.currentFunctionExpression
            );
            //if there is a parent function, register this function with the parent
            if (this.currentFunctionExpression) {
                this.currentFunctionExpression.childFunctionExpressions.push(func);
            }

            this.functionExpressions.push(func);

            let previousFunctionExpression = this.currentFunctionExpression;
            this.currentFunctionExpression = func;

            //make sure to restore the currentFunctionExpression even if the body block fails to parse
            try {
                //support ending the function with `end sub` OR `end function`
                func.body = this.block(TokenKind.EndSub, TokenKind.EndFunction);
            } finally {
                this.currentFunctionExpression = previousFunctionExpression;
            }

            if (!func.body) {
                this.diagnostics.push({
                    ...DiagnosticMessages.callableBlockMissingEndKeyword(functionTypeText),
                    range: this.peek().range
                });
                throw this.lastDiagnosticAsError();
            }
            //prepend comment to body
            if (comment) {
                func.body.statements.unshift(comment);
            }
            // consume 'end sub' or 'end function'
            func.end = this.advance();
            let expectedEndKind = isSub ? TokenKind.EndSub : TokenKind.EndFunction;

            //if `function` is ended with `end sub`, or `sub` is ended with `end function`, then
            //add an error but don't hard-fail so the AST can continue more gracefully
            if (func.end.kind !== expectedEndKind) {
                this.diagnostics.push({
                    ...DiagnosticMessages.mismatchedEndCallableKeyword(functionTypeText, func.end.text),
                    range: this.peek().range
                });
            }
            func.callExpressions = this.callExpressions;

            if (isAnonymous) {
                return func;
            } else {
                // only consume trailing newlines in the statement context; expressions
                // expect to handle their own trailing whitespace
                while (this.match(TokenKind.Newline)) {
                }
                let result = new FunctionStatement(name, func, this.currentNamespaceName);
                func.functionStatement = result;
                return result;
            }
        } finally {
            this.namespaceAndFunctionDepth--;
            //restore the previous CallExpression list
            this.callExpressions = previousCallExpressions;
        }
    }

    private functionParameter(): FunctionParameter {
        if (!this.check(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedParameterNameButFound(this.peek().text),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }

        let name = this.advance() as Identifier;
        // force the name into an identifier so the AST makes some sense
        name.kind = TokenKind.Identifier;

        let type: ValueKind = ValueKind.Dynamic;
        let typeToken: Token | undefined;
        let defaultValue;

        // parse argument default value
        if (this.match(TokenKind.Equal)) {
            // it seems any expression is allowed here -- including ones that operate on other arguments!
            defaultValue = this.expression();
        }

        let asToken = null;
        if (this.check(TokenKind.As)) {
            asToken = this.advance();

            typeToken = this.advance();
            let typeValueKind = valueKindFromString(typeToken.text);

            if (!typeValueKind) {
                this.diagnostics.push({
                    ...DiagnosticMessages.functionParameterTypeIsInvalid(name.text, typeToken.text),
                    range: typeToken.range
                });
                throw this.lastDiagnosticAsError();
            }

            type = typeValueKind;
        }

        return new FunctionParameter(
            name,
            {
                kind: type,
                range: typeToken ? typeToken.range : StdlibArgument.InternalRange
            },
            typeToken,
            defaultValue,
            asToken
        );
    }

    private assignment(...additionalterminators: TokenKind[]): AssignmentStatement {
        let name = this.advance() as Identifier;
        //add diagnostic if name is a reserved word that cannot be used as an identifier
        if (DisallowedLocalIdentifiersText.has(name.text.toLowerCase())) {
            this.diagnostics.push({
                ...DiagnosticMessages.cannotUseReservedWordAsIdentifier(name.text),
                range: name.range
            });
        }
        let operator = this.consume(
            DiagnosticMessages.expectedOperatorAfterIdentifier(AssignmentOperators, name.text),
            ...AssignmentOperators
        );

        let value = this.expression();
        if (!this.check(...additionalterminators, TokenKind.Comment)) {
            this.consume(
                DiagnosticMessages.expectedNewlineOrColonAfterAssignment(),
                TokenKind.Newline,
                TokenKind.Colon,
                TokenKind.Eof,
                ...additionalterminators
            );
        }
        while (this.match(TokenKind.Newline)) { }

        let result: AssignmentStatement;
        if (operator.kind === TokenKind.Equal) {
            result = new AssignmentStatement(operator, name, value, this.currentFunctionExpression);
        } else {
            result = new AssignmentStatement(
                operator,
                name,
                new BinaryExpression(new VariableExpression(name, this.currentNamespaceName), operator, value),
                this.currentFunctionExpression
            );
        }
        this.assignmentStatements.push(result);
        return result;
    }

    private checkLibrary() {
        let isLibraryToken = this.check(TokenKind.Library);

        //if we are at the top level, any line that starts with "library" should be considered a library statement
        if (this.isAtRootLevel() && isLibraryToken) {
            return true;

            //not at root level, library statements are all invalid here, but try to detect if the tokens look
            //like a library statement (and let the libraryStatement function handle emitting the diagnostics)
        } else if (isLibraryToken && this.checkNext(TokenKind.StringLiteral)) {
            return true;

            //definitely not a library statement
        } else {
            return false;
        }
    }

    private statement(...additionalterminators: BlockTerminator[]): Statement | undefined {
        if (this.checkLibrary()) {
            return this.libraryStatement();
        }

        if (this.check(TokenKind.Import)) {
            return this.importStatement();
        }

        if (this.check(TokenKind.Stop)) {
            return this.stopStatement();
        }

        if (this.check(TokenKind.If)) {
            return this.ifStatement();
        }

        if (this.check(TokenKind.Print)) {
            return this.printStatement(...additionalterminators);
        }

        if (this.check(TokenKind.While)) {
            return this.whileStatement();
        }

        if (this.check(TokenKind.ExitWhile)) {
            return this.exitWhile();
        }

        if (this.check(TokenKind.For)) {
            return this.forStatement();
        }

        if (this.check(TokenKind.ForEach)) {
            return this.forEachStatement();
        }

        if (this.check(TokenKind.ExitFor)) {
            return this.exitFor();
        }

        if (this.check(TokenKind.End)) {
            return this.endStatement();
        }

        if (this.match(TokenKind.Return)) {
            return this.returnStatement();
        }

        if (this.check(TokenKind.Goto)) {
            return this.gotoStatement();
        }

        //does this line look like a label? (i.e.  `someIdentifier:` )
        if (this.check(TokenKind.Identifier) && this.checkNext(TokenKind.Colon)) {
            return this.labelStatement();
        }

        // TODO: support multi-statements
        return this.setStatement(...additionalterminators);
    }

    private whileStatement(): WhileStatement {
        const whileKeyword = this.advance();
        const condition = this.expression();

        let comment: CommentStatement;
        if (this.check(TokenKind.Comment)) {
            comment = this.commentStatement();
        }

        this.consume(
            DiagnosticMessages.expectedNewlineAfterWhileCondition(),
            TokenKind.Newline
        );
        while (this.match(TokenKind.Newline)) { }
        const whileBlock = this.block(TokenKind.EndWhile);
        if (!whileBlock) {
            this.diagnostics.push({
                ...DiagnosticMessages.couldNotFindMatchingEndKeyword('while'),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }

        //set comment as first statement in block
        if (comment) {
            whileBlock.statements.unshift(comment);
        }

        const endWhile = this.advance();
        while (this.match(TokenKind.Newline)) {
        }

        return new WhileStatement(
            { while: whileKeyword, endWhile: endWhile },
            condition,
            whileBlock
        );
    }

    private exitWhile(): ExitWhileStatement {
        let keyword = this.advance();

        if (this.check(TokenKind.Newline, TokenKind.Comment) === false) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedNewlineAfterExitWhile(),
                range: this.peek().range
            });
        }
        while (this.match(TokenKind.Newline)) { }
        return new ExitWhileStatement({ exitWhile: keyword });
    }

    private forStatement(): ForStatement {
        const forKeyword = this.advance();
        const initializer = this.assignment(TokenKind.To);
        const to = this.advance();
        const finalValue = this.expression();
        let increment: Expression | undefined;
        let step: Token | undefined;

        if (this.check(TokenKind.Step)) {
            step = this.advance();
            increment = this.expression();
        } else {
            // BrightScript for/to/step loops default to a step of 1 if no `step` is provided
            increment = new LiteralExpression(new Int32(1), this.peek().range);
        }
        while (this.match(TokenKind.Newline)) {

        }

        let body = this.block(TokenKind.EndFor, TokenKind.Next);
        if (!body) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndForOrNextToTerminateForLoop(),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }
        let endFor = this.advance();
        while (this.match(TokenKind.Newline)) { }

        // WARNING: BrightScript doesn't delete the loop initial value after a for/to loop! It just
        // stays around in scope with whatever value it was when the loop exited.
        return new ForStatement(
            {
                for: forKeyword,
                to: to,
                step: step,
                endFor: endFor
            },
            initializer,
            finalValue,
            increment,
            body
        );
    }

    private forEachStatement(): ForEachStatement {
        let forEach = this.advance();
        let name = this.advance();

        let maybeIn = this.peek();
        if (this.check(TokenKind.Identifier) && maybeIn.text.toLowerCase() === 'in') {
            this.advance();
        } else {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedInAfterForEach(name.text),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }

        let target = this.expression();
        if (!target) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedExpressionAfterForEachIn(),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }
        let comment: CommentStatement;
        if (this.check(TokenKind.Comment)) {
            comment = this.commentStatement();
        }
        this.advance();
        while (this.match(TokenKind.Newline)) {

        }

        let body = this.block(TokenKind.EndFor, TokenKind.Next);
        if (!body) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndForOrNextToTerminateForLoop(),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }

        //add comment to beginning of block of avaiable
        if (comment) {
            body.statements.unshift(comment);
        }
        let endFor = this.advance();
        while (this.match(TokenKind.Newline)) { }

        return new ForEachStatement(
            {
                forEach: forEach,
                in: maybeIn,
                endFor: endFor
            },
            name,
            target,
            body
        );
    }

    private exitFor(): ExitForStatement {
        let keyword = this.advance();
        if (!this.check(TokenKind.Comment)) {
            this.consume(
                DiagnosticMessages.expectedNewlineAfterExitFor(),
                TokenKind.Newline
            );
            while (this.match(TokenKind.Newline)) { }
        }
        return new ExitForStatement({ exitFor: keyword });
    }

    private commentStatement() {
        //if this comment is on the same line as the previous statement,
        //then this comment should be treated as a single-line comment
        let prev = this.previous();
        if (prev && prev.range.end.line === this.peek().range.start.line) {
            return new CommentStatement([this.advance()]);
        } else {
            let comments = [this.advance()];
            while (this.check(TokenKind.Newline)) {
                //absorb newlines
                while (this.match(TokenKind.Newline)) { }

                //if this is a comment, and it's the next line down from the previous comment
                if (this.check(TokenKind.Comment) && comments[comments.length - 1].range.end.line === this.peek().range.start.line - 1) {
                    comments.push(this.advance());
                } else {
                    break;
                }
            }
            return new CommentStatement(comments);
        }
    }

    private namespaceStatement(): NamespaceStatement | undefined {
        this.warnIfNotBrighterScriptMode('namespace');
        let keyword = this.advance();

        if (!this.isAtRootLevel()) {
            this.diagnostics.push({
                ...DiagnosticMessages.keywordMustBeDeclaredAtRootLevel('namespace'),
                range: keyword.range
            });
        }
        this.namespaceAndFunctionDepth++;

        let name = this.getNamespacedVariableNameExpression();
        //the only thing allowed after a namespace declaration is a comment or a newline
        this.flagUntil(TokenKind.Comment, TokenKind.Newline);

        //set the current namespace name
        this.currentNamespaceName = name;

        this.globalTerminators.push([TokenKind.EndNamespace]);
        let body = this.body();
        this.globalTerminators.pop();

        //unset the current namespace name
        this.currentNamespaceName = undefined;

        let endKeyword: Token;
        if (this.check(TokenKind.EndNamespace)) {
            endKeyword = this.advance();
        } else {
            //the `end namespace` keyword is missing. add a diagnostic, but keep parsing
            this.diagnostics.push({
                ...DiagnosticMessages.couldNotFindMatchingEndKeyword('namespace'),
                range: keyword.range
            });
        }

        //scrap newlines
        while (this.match(TokenKind.Newline)) { }

        this.namespaceAndFunctionDepth--;
        let result = new NamespaceStatement(keyword, name, body, endKeyword);

        return result;
    }

    /**
     * Get an expression with identifiers separated by periods. Useful for namespaces and class extends
     */
    private getNamespacedVariableNameExpression() {
        let firstIdentifier = this.consume(
            DiagnosticMessages.expectedIdentifierAfterKeyword(this.previous().text),
            TokenKind.Identifier,
            ...this.allowedLocalIdentifiers
        ) as Identifier;

        let expr: DottedGetExpression | VariableExpression;

        if (firstIdentifier) {
            // force it into an identifier so the AST makes some sense
            firstIdentifier.kind = TokenKind.Identifier;
            expr = new VariableExpression(firstIdentifier, null);

            //consume multiple dot identifiers (i.e. `Name.Space.Can.Have.Many.Parts`)
            while (this.check(TokenKind.Dot)) {
                let dot = this.tryConsume(
                    DiagnosticMessages.foundUnexpectedToken(this.peek().text),
                    TokenKind.Dot
                );
                if (!dot) {
                    break;
                }
                let identifier = this.tryConsume(
                    DiagnosticMessages.expectedIdentifier(),
                    TokenKind.Identifier,
                    ...this.allowedLocalIdentifiers,
                    ...AllowedProperties
                ) as Identifier;
                // force it into an identifier so the AST makes some sense
                identifier.kind = TokenKind.Identifier;

                if (!identifier) {
                    break;
                }
                expr = new DottedGetExpression(expr, identifier, dot);
            }
        }
        return new NamespacedVariableNameExpression(expr);
    }

    /**
     * Add an 'unexpected token' diagnostic for any token found between current and the first stopToken found.
     */
    private flagUntil(...stopTokens: TokenKind[]) {
        while (!this.check(...stopTokens) && !this.isAtEnd()) {
            let token = this.advance();
            this.diagnostics.push({
                ...DiagnosticMessages.foundUnexpectedToken(token.text),
                range: token.range
            });
        }
    }

    /**
     * Consume tokens until one of the `stopTokenKinds` is encountered
     * @param tokenKinds
     * @return - the list of tokens consumed, EXCLUDING the `stopTokenKind` (you can use `this.peek()` to see which one it was)
     */
    private consumeUntil(...stopTokenKinds: TokenKind[]) {
        let result = [] as Token[];
        //take tokens until we encounter one of the stopTokenKinds
        while (!stopTokenKinds.includes(this.peek().kind)) {
            result.push(this.advance());
        }
        return result;
    }

    private libraryStatement(): LibraryStatement | undefined {
        let libStatement = new LibraryStatement({
            library: this.advance(),
            //grab the next token only if it's a string
            filePath: this.tryConsume(
                DiagnosticMessages.expectedStringLiteralAfterKeyword('library'),
                TokenKind.StringLiteral
            )
        });

        //consume all tokens until the end of the line
        this.flagUntil(TokenKind.Newline, TokenKind.Eof, TokenKind.Colon, TokenKind.Comment);

        //consume to the next newline, eof, or colon
        while (this.match(TokenKind.Newline, TokenKind.Eof, TokenKind.Colon)) { }
        return libStatement;
    }

    private importStatement() {
        this.warnIfNotBrighterScriptMode('import statements');
        let importStatement = new ImportStatement(
            this.advance(),
            //grab the next token only if it's a string
            this.tryConsume(
                DiagnosticMessages.expectedStringLiteralAfterKeyword('import'),
                TokenKind.StringLiteral
            )
        );

        //consume all tokens until the end of the line
        this.flagUntil(TokenKind.Newline, TokenKind.Eof, TokenKind.Colon, TokenKind.Comment);

        //consume to the next newline, eof, or colon
        while (this.match(TokenKind.Newline, TokenKind.Eof, TokenKind.Colon)) { }
        return importStatement;
    }

    private templateString(isTagged: boolean): TemplateStringExpression | TaggedTemplateStringExpression {
        this.warnIfNotBrighterScriptMode('template string');

        //get the tag name
        let tagName: Identifier;
        if (isTagged) {
            tagName = this.consume(DiagnosticMessages.expectedIdentifier(), TokenKind.Identifier, ...AllowedProperties) as Identifier;
            // force it into an identifier so the AST makes some sense
            tagName.kind = TokenKind.Identifier;
        }

        let quasis = [] as TemplateStringQuasiExpression[];
        let expressions = [];
        let openingBacktick = this.peek();
        this.advance();
        let currentQuasiExpressionParts = [];
        while (!this.isAtEnd() && !this.check(TokenKind.BackTick)) {
            let next = this.peek();
            if (next.kind === TokenKind.TemplateStringQuasi) {
                //a quasi can actually be made up of multiple quasis when it includes char literals
                currentQuasiExpressionParts.push(
                    new LiteralExpression(next.literal, next.range)
                );
                this.advance();
            } else if (next.kind === TokenKind.EscapedCharCodeLiteral) {
                currentQuasiExpressionParts.push(
                    new EscapedCharCodeLiteral(<any>next)
                );
                this.advance();
            } else {
                //finish up the current quasi
                quasis.push(
                    new TemplateStringQuasiExpression(currentQuasiExpressionParts)
                );
                currentQuasiExpressionParts = [];

                if (next.kind === TokenKind.TemplateStringExpressionBegin) {
                    this.advance();
                }
                //now keep this expression
                expressions.push(this.expression());
                if (!this.isAtEnd() && this.check(TokenKind.TemplateStringExpressionEnd)) {
                    //TODO is it an error if this is not present?
                    this.advance();
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.unterminatedTemplateExpression(),
                        range: util.getRange(openingBacktick, this.peek())
                    });
                    throw this.lastDiagnosticAsError();
                }
            }
        }

        //store the final set of quasis
        quasis.push(
            new TemplateStringQuasiExpression(currentQuasiExpressionParts)
        );

        if (this.isAtEnd()) {
            //error - missing backtick
            this.diagnostics.push({
                ...DiagnosticMessages.unterminatedTemplateStringAtEndOfFile(),
                range: util.getRange(openingBacktick, this.peek())
            });
            throw this.lastDiagnosticAsError();

        } else {
            let closingBacktick = this.advance();
            if (isTagged) {
                return new TaggedTemplateStringExpression(tagName, openingBacktick, quasis, expressions, closingBacktick);
            } else {
                return new TemplateStringExpression(openingBacktick, quasis, expressions, closingBacktick);
            }
        }
    }

    private ifStatement(): IfStatement {
        const ifToken = this.advance();
        const startingRange = ifToken.range;

        const condition = this.expression();
        let thenBranch: Block;
        let elseIfBranches: ElseIf[] = [];
        let elseBranch: Block | undefined;

        let thenToken: Token | undefined;
        let endIfToken: Token | undefined;
        let elseToken: Token | undefined;

        if (this.check(TokenKind.Then)) {
            // `then` is optional after `if ...condition...`, so only advance to the next token if `then` is present
            thenToken = this.advance();
        }

        let comment: CommentStatement;
        if (this.check(TokenKind.Comment)) {
            comment = this.commentStatement();
        }

        if (this.match(TokenKind.Newline) || this.match(TokenKind.Colon)) {
            //consume until no more colons
            while (this.check(TokenKind.Colon)) {
                this.advance();
            }

            //consume exactly 1 newline, if found
            if (this.check(TokenKind.Newline)) {
                this.advance();
            }

            //keep track of the current error count, because if the then branch fails,
            //we will trash them in favor of a single error on if
            let diagnosticsLengthBeforeBlock = this.diagnostics.length;

            // we're parsing a multi-line ("block") form of the BrightScript if/then/else and must find
            // a trailing "end if"

            let maybeThenBranch = this.block(TokenKind.EndIf, TokenKind.Else, TokenKind.ElseIf);
            if (!maybeThenBranch) {
                //throw out any new diagnostics created as a result of a `then` block parse failure.
                //the block() function will discard the current line, so any discarded diagnostics will
                //resurface if they are legitimate, and not a result of a malformed if statement
                this.diagnostics.splice(diagnosticsLengthBeforeBlock, this.diagnostics.length - diagnosticsLengthBeforeBlock);

                //this whole if statement is bogus...add error to the if token and hard-fail
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedEndIfElseIfOrElseToTerminateThenBlock(),
                    range: ifToken.range
                });
                throw this.lastDiagnosticAsError();
            }
            //add any comment from the same line as the if statement
            if (comment) {
                maybeThenBranch.statements.unshift(comment);
            }
            let blockEnd = this.previous();
            if (blockEnd.kind === TokenKind.EndIf) {
                endIfToken = blockEnd;
            }

            thenBranch = maybeThenBranch;
            this.match(TokenKind.Newline);

            // attempt to read a bunch of "else if" clauses
            while (this.check(TokenKind.ElseIf)) {
                let elseIfToken = this.advance();
                let elseIfCondition = this.expression();
                let thenToken: Token;
                if (this.check(TokenKind.Then)) {
                    // `then` is optional after `else if ...condition...`, so only advance to the next token if `then` is present
                    thenToken = this.advance();
                }

                //consume any trailing colons
                while (this.check(TokenKind.Colon)) {
                    this.advance();
                }

                while (this.match(TokenKind.Newline)) { }

                let elseIfThen = this.block(TokenKind.EndIf, TokenKind.Else, TokenKind.ElseIf);
                if (!elseIfThen) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedEndIfElseIfOrElseToTerminateThenBlock(),
                        range: this.peek().range
                    });
                }

                let blockEnd = this.previous();
                if (blockEnd.kind === TokenKind.EndIf) {
                    endIfToken = blockEnd;
                }

                elseIfBranches.push({
                    condition: elseIfCondition,
                    thenBranch: elseIfThen,
                    thenToken: thenToken,
                    elseIfToken: elseIfToken
                });
            }

            if (this.match(TokenKind.Else)) {
                elseToken = this.previous();
                //consume any trailing colons
                while (this.check(TokenKind.Colon)) {
                    this.advance();
                }

                while (this.match(TokenKind.Newline)) { }

                elseBranch = this.block(TokenKind.EndIf);
                endIfToken = this.advance(); // skip past "end if"

                //ensure that single-line `if` statements have a colon right before 'end if'
                if (util.sameStartLine(ifToken, endIfToken)) {
                    let index = this.tokens.indexOf(endIfToken);
                    let previousToken = this.tokens[index - 1];
                    if (previousToken.kind !== TokenKind.Colon) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.expectedColonToPreceedEndIf(),
                            range: ifToken.range
                        });
                    }
                }
                this.match(TokenKind.Newline);
            } else {
                this.match(TokenKind.Newline);
                endIfToken = this.consume(
                    DiagnosticMessages.expectedEndIfToCloseIfStatement(startingRange.start),
                    TokenKind.EndIf
                );

                //ensure that single-line `if` statements have a colon right before 'end if'
                if (util.sameStartLine(ifToken, endIfToken)) {
                    let index = this.tokens.indexOf(endIfToken);
                    let previousToken = this.tokens[index - 1];
                    if (previousToken.kind !== TokenKind.Colon) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.expectedColonToPreceedEndIf(),
                            range: endIfToken.range
                        });
                    }
                }
                this.match(TokenKind.Newline);
            }
        } else {
            let thenStatement = this.declaration(TokenKind.ElseIf, TokenKind.Else);
            if (!thenStatement) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedStatementToFollowConditionalCondition(ifToken.text),
                    range: this.peek().range
                });
                throw this.lastDiagnosticAsError();
            }
            thenBranch = new Block([thenStatement], this.peek().range);

            //add any comment from the same line as the if statement
            if (comment) {
                thenBranch.statements.unshift(comment);
            }

            while (this.previous().kind !== TokenKind.Newline && this.match(TokenKind.ElseIf)) {
                let elseIf = this.previous();
                let elseIfCondition = this.expression();
                let thenToken: Token;
                if (this.check(TokenKind.Then)) {
                    // `then` is optional after `else if ...condition...`, so only advance to the next token if `then` is present
                    thenToken = this.advance();
                }

                let elseIfThen = this.declaration(TokenKind.ElseIf, TokenKind.Else);
                if (!elseIfThen) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedStatementToFollowConditionalCondition(elseIf.text),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                }

                elseIfBranches.push({
                    condition: elseIfCondition,
                    thenBranch: new Block([elseIfThen], this.peek().range),
                    thenToken: thenToken,
                    elseIfToken: elseIf
                });
            }
            if (this.previous().kind !== TokenKind.Newline && this.match(TokenKind.Else)) {
                elseToken = this.previous();
                let elseStatement = this.declaration();
                if (!elseStatement) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedStatementToFollowElse(),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                }
                elseBranch = new Block([elseStatement], this.peek().range);
            }
        }

        return new IfStatement(
            {
                if: ifToken,
                then: thenToken,
                endIf: endIfToken,
                else: elseToken
            },
            condition,
            thenBranch,
            elseIfBranches,
            elseBranch
        );
    }
    private expressionStatement(expr: Expression, additionalTerminators: BlockTerminator[]): ExpressionStatement | IncrementStatement {
        let expressionStart = this.peek();

        if (this.check(TokenKind.PlusPlus, TokenKind.MinusMinus)) {
            let operator = this.advance();

            if (this.check(TokenKind.PlusPlus, TokenKind.MinusMinus)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.consecutiveIncrementDecrementOperatorsAreNotAllowed(),
                    range: this.peek().range
                });
                throw this.lastDiagnosticAsError();
            } else if (expr instanceof CallExpression) {
                this.diagnostics.push({
                    ...DiagnosticMessages.incrementDecrementOperatorsAreNotAllowedAsResultOfFunctionCall(),
                    range: expressionStart.range
                });
                throw this.lastDiagnosticAsError();
            }

            while (this.match(TokenKind.Newline, TokenKind.Colon)) {
            }

            return new IncrementStatement(expr, operator);
        }

        if (!this.check(...additionalTerminators, TokenKind.Comment)) {
            this.consume(
                DiagnosticMessages.expectedNewlineOrColonAfterExpressionStatement(),
                TokenKind.Newline,
                TokenKind.Colon,
                TokenKind.Eof
            );
        }

        if (expr instanceof CallExpression || expr instanceof CallfuncExpression) {
            return new ExpressionStatement(expr);
        }

        //at this point, it's probably an error. However, we recover a little more gracefully by creating an assignment
        this.diagnostics.push({
            ...DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression(),
            range: expressionStart.range
        });
        throw this.lastDiagnosticAsError();
    }
    private setStatement(
        ...additionalTerminators: BlockTerminator[]
    ): DottedSetStatement | IndexedSetStatement | ExpressionStatement | IncrementStatement {
        /**
         * Attempts to find an expression-statement or an increment statement.
         * While calls are valid expressions _and_ statements, increment (e.g. `foo++`)
         * statements aren't valid expressions. They _do_ however fall under the same parsing
         * priority as standalone function calls though, so we can parse them in the same way.
         */


        let expr = this.call();
        if (this.check(...AssignmentOperators) && !(expr instanceof CallExpression)) {
            let left = expr;
            let operator = this.advance();
            let right = this.expression();

            // Create a dotted or indexed "set" based on the left-hand side's type
            if (left instanceof IndexedGetExpression) {
                this.consume(
                    DiagnosticMessages.expectedNewlineOrColonAfterIndexedSetStatement(),
                    TokenKind.Newline,
                    TokenKind.Else,
                    TokenKind.ElseIf,
                    TokenKind.Colon,
                    TokenKind.Eof,
                    TokenKind.Comment
                );
                //if we just consumed a comment, backtrack 1 token so it can be collected later
                if (this.checkPrevious(TokenKind.Comment)) {
                    this.current--;
                }

                return new IndexedSetStatement(
                    left.obj,
                    left.index,
                    operator.kind === TokenKind.Equal
                        ? right
                        : new BinaryExpression(left, operator, right),
                    left.openingSquare,
                    left.closingSquare
                );
            } else if (left instanceof DottedGetExpression) {
                this.consume(
                    DiagnosticMessages.expectedNewlineOrColonAfterDottedSetStatement(),
                    TokenKind.Newline,
                    TokenKind.Else,
                    TokenKind.ElseIf,
                    TokenKind.Colon,
                    TokenKind.Eof,
                    TokenKind.Comment
                );
                //if we just consumed a comment, backtrack 1 token so it can be collected later
                if (this.checkPrevious(TokenKind.Comment)) {
                    this.current--;
                }

                return new DottedSetStatement(
                    left.obj,
                    left.name,
                    operator.kind === TokenKind.Equal
                        ? right
                        : new BinaryExpression(left, operator, right)
                );
            } else {
                return this.expressionStatement(expr, additionalTerminators);
            }
        } else {
            return this.expressionStatement(expr, additionalTerminators);
        }
    }

    private printStatement(...additionalterminators: BlockTerminator[]): PrintStatement {
        let printKeyword = this.advance();

        let values: (
            | Expression
            | PrintSeparatorTab
            | PrintSeparatorSpace)[] = [];

        //print statements can be empty, so look for empty print conditions
        if (this.isAtEnd() || this.check(TokenKind.Newline, TokenKind.Colon)) {
            let emptyStringLiteral = new LiteralExpression(new BrsString(''), printKeyword.range);
            values.push(emptyStringLiteral);
        } else {
            values.push(this.expression());
        }

        while (!this.check(TokenKind.Newline, TokenKind.Colon, ...additionalterminators, TokenKind.Comment) && !this.isAtEnd()) {
            if (this.check(TokenKind.Semicolon)) {
                values.push(this.advance() as PrintSeparatorSpace);
            }

            if (this.check(TokenKind.Comma)) {
                values.push(this.advance() as PrintSeparatorTab);
            }

            if (!this.check(TokenKind.Newline, TokenKind.Colon) && !this.isAtEnd()) {
                values.push(this.expression());
            }
        }

        if (!this.check(...additionalterminators, TokenKind.Comment)) {
            this.consume(
                DiagnosticMessages.expectedNewlineOrColonAfterPrintedValues(),
                TokenKind.Newline,
                TokenKind.Colon,
                TokenKind.Eof
            );
        }

        //consume excess newlines
        while (this.match(TokenKind.Newline)) { }

        return new PrintStatement({ print: printKeyword }, values);
    }

    /**
     * Parses a return statement with an optional return value.
     * @returns an AST representation of a return statement.
     */
    private returnStatement(): ReturnStatement {
        let tokens = { return: this.previous() };

        if (this.check(TokenKind.Colon, TokenKind.Newline, TokenKind.Eof)) {
            while (this.match(TokenKind.Colon, TokenKind.Newline, TokenKind.Eof)) { }
            return new ReturnStatement(tokens);
        }

        let toReturn = this.expression();
        while (this.match(TokenKind.Newline, TokenKind.Colon)) {
        }

        return new ReturnStatement(tokens, toReturn);
    }

    /**
     * Parses a `label` statement
     * @returns an AST representation of an `label` statement.
     */
    private labelStatement() {
        let tokens = {
            identifier: this.advance(),
            colon: this.advance()
        };

        if (!this.check(TokenKind.Comment)) {
            this.consume(
                DiagnosticMessages.labelsMustBeDeclaredOnTheirOwnLine(),
                TokenKind.Newline,
                TokenKind.Eof
            );
        }

        return new LabelStatement(tokens);
    }

    /**
     * Parses a `goto` statement
     * @returns an AST representation of an `goto` statement.
     */
    private gotoStatement() {
        let tokens = {
            goto: this.advance(),
            label: this.consume(
                DiagnosticMessages.expectedLabelIdentifierAfterGotoKeyword(),
                TokenKind.Identifier
            )
        };

        while (this.match(TokenKind.Newline, TokenKind.Colon)) { }

        return new GotoStatement(tokens);
    }

    /**
     * Parses an `end` statement
     * @returns an AST representation of an `end` statement.
     */
    private endStatement() {
        let endTokens = { end: this.advance() };

        while (this.match(TokenKind.Newline)) { }

        return new EndStatement(endTokens);
    }
    /**
     * Parses a `stop` statement
     * @returns an AST representation of a `stop` statement
     */
    private stopStatement() {
        let tokens = { stop: this.advance() };

        while (this.match(TokenKind.Newline, TokenKind.Colon)) {

        }

        return new StopStatement(tokens);
    }

    /**
     * Parses a block, looking for a specific terminating TokenKind to denote completion.
     * @param terminators the token(s) that signifies the end of this block; all other terminators are
     *                    ignored.
     */
    private block(...terminators: BlockTerminator[]): Block | undefined {
        let startingToken = this.peek();

        const statements: Statement[] = [];
        while (!this.check(...terminators) && !this.isAtEnd()) {
            //grab the location of the current token
            let loopCurrent = this.current;
            let dec = this.declaration();

            if (dec) {
                statements.push(dec);
            } else {
                //something went wrong. reset to the top of the loop
                this.current = loopCurrent;

                //scrap the entire line (hopefully whatever failed has added a diagnostic)
                this.consumeUntil(TokenKind.Colon, TokenKind.Newline, TokenKind.Eof);

                //trash the next token. this prevents an infinite loop. not exactly sure why we need this,
                //but there's already an error in the file being parsed, so just leave this line here
                this.advance();
            }
            //trash any newline characters
            while (this.match(TokenKind.Newline)) { }
        }

        if (this.isAtEnd()) {
            return undefined;
            // TODO: Figure out how to handle unterminated blocks well
        }

        return new Block(statements, startingToken.range);
    }

    private expression(): Expression {
        return this.anonymousFunction();
    }

    private anonymousFunction(): Expression {
        if (this.check(TokenKind.Sub, TokenKind.Function)) {
            return this.functionDeclaration(true);
        }

        //template string
        if (this.check(TokenKind.BackTick)) {
            return this.templateString(false);
            //tagged template string (currently we do not support spaces between the identifier and the backtick
        } else if (this.check(TokenKind.Identifier, ...AllowedLocalIdentifiers) && this.checkNext(TokenKind.BackTick)) {
            return this.templateString(true);
        }

        return this.boolean();
    }

    private boolean(): Expression {
        let expr = this.relational();

        while (this.match(TokenKind.And, TokenKind.Or)) {
            let operator = this.previous();
            let right = this.relational();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    private relational(): Expression {
        let expr = this.additive();

        while (
            this.match(
                TokenKind.Equal,
                TokenKind.LessGreater,
                TokenKind.Greater,
                TokenKind.GreaterEqual,
                TokenKind.Less,
                TokenKind.LessEqual
            )
        ) {
            let operator = this.previous();
            let right = this.additive();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    // TODO: bitshift

    private additive(): Expression {
        let expr = this.multiplicative();

        while (this.match(TokenKind.Plus, TokenKind.Minus)) {
            let operator = this.previous();
            let right = this.multiplicative();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    private multiplicative(): Expression {
        let expr = this.exponential();

        while (this.match(
            TokenKind.Forwardslash,
            TokenKind.Backslash,
            TokenKind.Star,
            TokenKind.Mod,
            TokenKind.LeftShift,
            TokenKind.RightShift
        )) {
            let operator = this.previous();
            let right = this.exponential();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    private exponential(): Expression {
        let expr = this.prefixUnary();

        while (this.match(TokenKind.Caret)) {
            let operator = this.previous();
            let right = this.prefixUnary();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    private prefixUnary(): Expression {
        if (this.match(TokenKind.Not, TokenKind.Minus)) {
            let operator = this.previous();
            let right = this.prefixUnary();
            return new UnaryExpression(operator, right);
        }

        return this.call();
    }

    private indexedGet(expr: Expression) {
        let openingSquare = this.previous();
        while (this.match(TokenKind.Newline)) { }

        let index = this.expression();

        while (this.match(TokenKind.Newline)) { }
        let closingSquare = this.consume(
            DiagnosticMessages.expectedRightSquareBraceAfterArrayOrObjectIndex(),
            TokenKind.RightSquareBracket
        );

        return new IndexedGetExpression(expr, index, openingSquare, closingSquare);
    }

    private newExpression() {
        this.warnIfNotBrighterScriptMode(`using 'new' keyword to construct a class`);
        let newToken = this.advance();

        let nameExpr = this.getNamespacedVariableNameExpression();
        let leftParen = this.consume(
            DiagnosticMessages.foundUnexpectedToken(this.peek().text),
            TokenKind.LeftParen
        );
        let call = this.finishCall(leftParen, nameExpr);
        //pop the call from the  callExpressions list because this is technically something else
        this.callExpressions.pop();
        let result = new NewExpression(newToken, call);
        this.newExpressions.push(result);
        return result;
    }

    /**
     * A callfunc expression (i.e. `node@.someFunctionOnNode()`)
     */
    private callfunc(callee: Expression): Expression {
        this.warnIfNotBrighterScriptMode('callfunc operator');
        let operator = this.previous();
        let methodName = this.consume(DiagnosticMessages.expectedIdentifier(), TokenKind.Identifier, ...AllowedProperties);
        // force it into an identifier so the AST makes some sense
        methodName.kind = TokenKind.Identifier;
        let openParen = this.consume(DiagnosticMessages.expectedOpenParenToFollowCallfuncIdentifier(), TokenKind.LeftParen);
        let call = this.finishCall(openParen, callee);

        return new CallfuncExpression(callee, operator, methodName as Identifier, openParen, call.args, call.closingParen);
    }

    private call(): Expression {
        if (this.check(TokenKind.New) && this.checkNext(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
            return this.newExpression();
        }
        let expr = this.primary();

        while (true) {
            if (this.match(TokenKind.LeftParen)) {
                expr = this.finishCall(this.previous(), expr);
            } else if (this.match(TokenKind.LeftSquareBracket)) {
                expr = this.indexedGet(expr);
            } else if (this.match(TokenKind.Callfunc)) {
                expr = this.callfunc(expr);
            } else if (this.match(TokenKind.Dot)) {
                if (this.match(TokenKind.LeftSquareBracket)) {
                    expr = this.indexedGet(expr);
                } else {
                    let dot = this.previous();
                    let name = this.consume(
                        DiagnosticMessages.expectedPropertyNameAfterPeriod(),
                        TokenKind.Identifier,
                        ...AllowedProperties
                    );

                    // force it into an identifier so the AST makes some sense
                    name.kind = TokenKind.Identifier;

                    expr = new DottedGetExpression(expr, name as Identifier, dot);
                }
            } else if (this.check(TokenKind.At)) {
                let dot = this.advance();
                let name = this.consume(
                    DiagnosticMessages.expectedAttributeNameAfterAtSymbol(),
                    TokenKind.Identifier,
                    ...AllowedProperties
                );

                // force it into an identifier so the AST makes some sense
                name.kind = TokenKind.Identifier;

                expr = new XmlAttributeGetExpression(expr, name as Identifier, dot);
                //only allow a single `@` expression
                break;
            } else {
                break;
            }
        }
        return expr;
    }

    private finishCall(openingParen: Token, callee: Expression) {
        let args = [] as Expression[];
        while (this.match(TokenKind.Newline)) {
        }

        if (!this.check(TokenKind.RightParen)) {
            do {
                while (this.match(TokenKind.Newline)) { }

                if (args.length >= CallExpression.MaximumArguments) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.tooManyCallableArguments(args.length, CallExpression.MaximumArguments),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                }
                args.push(this.expression());
            } while (this.match(TokenKind.Comma));
        }

        while (this.match(TokenKind.Newline)) { }

        const closingParen = this.consume(
            DiagnosticMessages.expectedRightParenAfterFunctionCallArguments(),
            TokenKind.RightParen
        );

        if (callee instanceof VariableExpression) {
            callee.isCalled = true;
        }

        let expression = new CallExpression(callee, openingParen, closingParen, args, this.currentNamespaceName);
        this.callExpressions.push(expression);
        return expression;
    }

    private primary(): Expression {
        switch (true) {
            case this.match(TokenKind.False):
                return new LiteralExpression(BrsBoolean.False, this.previous().range);
            case this.match(TokenKind.True):
                return new LiteralExpression(BrsBoolean.True, this.previous().range);
            case this.match(TokenKind.Invalid):
                return new LiteralExpression(BrsInvalid.Instance, this.previous().range);
            case this.match(
                TokenKind.IntegerLiteral,
                TokenKind.LongIntegerLiteral,
                TokenKind.FloatLiteral,
                TokenKind.DoubleLiteral,
                TokenKind.StringLiteral
            ):
                return new LiteralExpression(this.previous().literal, this.previous().range);
            //capture source literals (LINE_NUM if brightscript, or a bunch of them if brighterscript
            case this.match(TokenKind.LineNumLiteral, ...(this.options.mode === ParseMode.BrightScript ? [] : BrighterScriptSourceLiterals)):
                return new SourceLiteralExpression(this.previous());
            case this.match(TokenKind.Identifier, ...this.allowedLocalIdentifiers):
                return new VariableExpression(this.previous() as Identifier, this.currentNamespaceName);
            case this.match(TokenKind.LeftParen):
                let left = this.previous();
                let expr = this.expression();
                let right = this.consume(
                    DiagnosticMessages.unmatchedLeftParenAfterExpression(),
                    TokenKind.RightParen
                );
                return new GroupingExpression({ left: left, right: right }, expr);
            case this.match(TokenKind.LeftSquareBracket):
                let elements: Array<Expression | CommentStatement> = [];
                let openingSquare = this.previous();

                //add any comment found right after the opening square
                if (this.check(TokenKind.Comment)) {
                    elements.push(new CommentStatement([this.advance()]));
                }

                while (this.match(TokenKind.Newline)) {
                }

                if (!this.match(TokenKind.RightSquareBracket)) {
                    elements.push(this.expression());

                    while (this.match(TokenKind.Comma, TokenKind.Newline, TokenKind.Comment)) {
                        if (this.checkPrevious(TokenKind.Comment) || this.check(TokenKind.Comment)) {
                            let comment = this.check(TokenKind.Comment) ? this.advance() : this.previous();
                            elements.push(new CommentStatement([comment]));
                        }
                        while (this.match(TokenKind.Newline)) {

                        }

                        if (this.check(TokenKind.RightSquareBracket)) {
                            break;
                        }

                        elements.push(this.expression());
                    }

                    this.consume(
                        DiagnosticMessages.unmatchedLeftSquareBraceAfterArrayLiteral(),
                        TokenKind.RightSquareBracket
                    );
                }

                let closingSquare = this.previous();

                //this.consume("Expected newline or ':' after array literal", TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
                return new ArrayLiteralExpression(elements, openingSquare, closingSquare);
            case this.match(TokenKind.LeftCurlyBrace):
                let openingBrace = this.previous();
                let members: Array<AAMemberExpression | CommentStatement> = [];

                let key = () => {
                    let result = {
                        colonToken: null as Token,
                        keyToken: null as Token,
                        key: null as BrsString,
                        range: null as Range
                    };
                    if (this.check(TokenKind.Identifier, ...AllowedProperties)) {
                        result.keyToken = this.advance();
                        result.key = new BrsString(result.keyToken.text);
                    } else if (this.check(TokenKind.StringLiteral)) {
                        result.keyToken = this.advance();
                        result.key = result.keyToken.literal as BrsString;
                    } else {
                        this.diagnostics.push({
                            ...DiagnosticMessages.unexpectedAAKey(),
                            range: this.peek().range
                        });
                        throw this.lastDiagnosticAsError();
                    }

                    result.colonToken = this.consume(
                        DiagnosticMessages.expectedColonBetweenAAKeyAndvalue(),
                        TokenKind.Colon
                    );
                    result.range = util.getRange(result.keyToken, result.colonToken);
                    return result;
                };

                while (this.match(TokenKind.Newline)) {
                }

                if (!this.match(TokenKind.RightCurlyBrace)) {
                    if (this.check(TokenKind.Comment)) {
                        members.push(new CommentStatement([this.advance()]));
                    } else {
                        let k = key();
                        let expr = this.expression();
                        members.push({
                            key: k.key,
                            keyToken: k.keyToken,
                            colonToken: k.colonToken,
                            value: expr,
                            range: util.getRange(k, expr)
                        });
                    }

                    while (this.match(TokenKind.Comma, TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
                        //check for comment at the end of the current line
                        if (this.check(TokenKind.Comment) || this.checkPrevious(TokenKind.Comment)) {
                            let token = this.checkPrevious(TokenKind.Comment) ? this.previous() : this.advance();
                            members.push(new CommentStatement([token]));
                        } else {
                            while (this.match(TokenKind.Newline, TokenKind.Colon)) {

                            }
                            //check for a comment on its own line
                            if (this.check(TokenKind.Comment) || this.checkPrevious(TokenKind.Comment)) {
                                let token = this.checkPrevious(TokenKind.Comment) ? this.previous() : this.advance();
                                members.push(new CommentStatement([token]));
                                continue;
                            }

                            if (this.check(TokenKind.RightCurlyBrace)) {
                                break;
                            }
                            let k = key();
                            let expr = this.expression();
                            members.push({
                                key: k.key,
                                keyToken: k.keyToken,
                                colonToken: k.colonToken,
                                value: expr,
                                range: util.getRange(k, expr)
                            });
                        }
                    }

                    this.consume(
                        DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral(),
                        TokenKind.RightCurlyBrace
                    );
                }

                let closingBrace = this.previous();

                return new AALiteralExpression(members, openingBrace, closingBrace);
            case this.match(TokenKind.Pos, TokenKind.Tab):
                let token = Object.assign(this.previous(), {
                    kind: TokenKind.Identifier
                }) as Identifier;
                return new VariableExpression(token, this.currentNamespaceName);
            case this.check(TokenKind.Function, TokenKind.Sub):
                return this.anonymousFunction();
            case this.check(TokenKind.Comment):
                return new CommentStatement([this.advance()]);
            default:
                //if we found an expected terminator, don't throw a diagnostic...just return undefined
                if (this.check(...this.peekGlobalTerminators())) {
                    //don't throw a diagnostic, just return undefined

                    //something went wrong...throw an error so the upstream processor can scrap this line and move on
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.foundUnexpectedToken(this.peek().text),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                }
        }
    }

    /**
     * Pop tokens until we encounter a token not in the specified list
     * @param tokenKinds
     */
    private match(...tokenKinds: TokenKind[]) {
        for (let tokenKind of tokenKinds) {
            if (this.check(tokenKind)) {
                this.advance();
                return true;
            }
        }

        return false;
    }

    private consume(diagnosticInfo: DiagnosticInfo, ...tokenKinds: TokenKind[]): Token {
        let token = this.tryConsume(diagnosticInfo, ...tokenKinds);
        if (token) {
            return token;
        } else {
            let error = new Error(diagnosticInfo.message);
            (error as any).isDiagnostic = true;
            throw error;
        }
    }

    /**
     * Consume, or add a message if not found. But then continue and return undefined
     * @param message
     * @param tokenKinds
     */
    private tryConsume(diagnostic: DiagnosticInfo, ...tokenKinds: TokenKind[]): Token | undefined {
        let foundTokenKind = tokenKinds
            .map(tokenKind => this.peek().kind === tokenKind)
            .reduce((foundAny, foundCurrent) => foundAny || foundCurrent, false);

        if (foundTokenKind) {
            return this.advance();
        }
        this.diagnostics.push({
            ...diagnostic,
            range: this.peek().range
        });
    }

    private advance(): Token {
        if (!this.isAtEnd()) {
            this.current++;
        }
        return this.previous();
    }

    private checkPrevious(...tokenKinds: TokenKind[]) {
        if (this.isAtEnd()) {
            return false;
        }

        return tokenKinds.some(tokenKind => this.previous().kind === tokenKind);
    }

    private check(...tokenKinds: TokenKind[]) {
        if (this.isAtEnd()) {
            return false;
        }

        return tokenKinds.some(tokenKind => this.peek().kind === tokenKind);
    }

    private checkNext(...tokenKinds: TokenKind[]) {
        if (this.isAtEnd()) {
            return false;
        }

        return tokenKinds.some(tokenKind => this.peekNext().kind === tokenKind);
    }

    private isAtEnd() {
        return this.peek().kind === TokenKind.Eof;
    }

    private peekNext() {
        if (this.isAtEnd()) {
            return this.peek();
        }
        return this.tokens[this.current + 1];
    }

    private peek() {
        return this.tokens[this.current];
    }

    private previous() {
        return this.tokens[this.current - 1];
    }

    private synchronize() {
        this.advance(); // skip the erroneous token

        while (!this.isAtEnd()) {
            if (this.previous().kind === TokenKind.Newline || this.previous().kind === TokenKind.Colon) {
                // newlines and ':' characters separate statements
                return;
            }

            switch (this.peek().kind) { //eslint-disable-line @typescript-eslint/switch-exhaustiveness-check
                case TokenKind.Namespace:
                case TokenKind.Class:
                case TokenKind.Function:
                case TokenKind.Sub:
                case TokenKind.If:
                case TokenKind.For:
                case TokenKind.ForEach:
                case TokenKind.While:
                case TokenKind.Print:
                case TokenKind.Return:
                    // start parsing again from the next block starter or obvious
                    // expression start
                    return;
            }

            this.advance();
        }
    }

    public dispose() {
    }
}

export enum ParseMode {
    BrightScript = 'BrightScript',
    BrighterScript = 'BrighterScript'
}

export interface ParseOptions {
    /**
     * The parse mode. When in 'BrightScript' mode, no BrighterScript syntax is allowed, and will emit diagnostics.
     */
    mode: ParseMode;
    /**
     * A logger that should be used for logging. If omitted, a default logger is used
     */
    logger?: Logger;
}
