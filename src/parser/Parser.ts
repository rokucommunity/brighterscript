import type {
    Token,
    Identifier,
    BlockTerminator
} from '../lexer';
import {
    TokenKind,
    AllowedLocalIdentifiers,
    AssignmentOperators,
    DisallowedLocalIdentifiersText,
    DisallowedFunctionIdentifiersText,
    AllowedProperties,
    Lexer,
    BrighterScriptSourceLiterals,
    isToken,
    DeclarableTypes
} from '../lexer';
import type {
    Statement,
    PrintSeparatorTab,
    PrintSeparatorSpace
} from './Statement';
import {
    FunctionStatement,
    CommentStatement,
    AssignmentStatement,
    WhileStatement,
    ExitWhileStatement,
    ForStatement,
    ForEachStatement,
    ExitForStatement,
    LibraryStatement,
    Block,
    IfStatement,
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
    ImportStatement,
    ClassFieldStatement,
    ClassMethodStatement,
    ClassStatement,
    TryCatchStatement,
    ThrowStatement
} from './Statement';
import type { DiagnosticInfo } from '../DiagnosticMessages';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { util } from '../util';
import type { Expression } from './Expression';
import {
    AALiteralExpression,
    AAMemberExpression,
    ArrayLiteralExpression,
    BinaryExpression,
    CallExpression,
    CallfuncExpression,
    DottedGetExpression,
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
    EscapedCharCodeLiteralExpression,
    TemplateStringQuasiExpression,
    TaggedTemplateStringExpression,
    SourceLiteralExpression,
    AnnotationExpression,
    FunctionParameterExpression,
    TernaryExpression
} from './Expression';
import type { Diagnostic, Range } from 'vscode-languageserver';
import { Logger } from '../Logger';
import { isAnnotationExpression, isCallExpression, isCallfuncExpression, isClassMethodStatement, isCommentStatement, isDottedGetExpression, isIfStatement, isIndexedGetExpression, isVariableExpression } from '../astUtils/reflection';
import { createVisitor, WalkMode } from '../astUtils/visitors';
import { createStringLiteral, createToken } from '../astUtils/creators';

export class Parser {
    /**
     * The array of tokens passed to `parse()`
     */
    public tokens = [] as Token[];

    /**
     * The current token index
     */
    public current: number;

    /**
     * The list of statements for the parsed file
     */
    public ast = new Body([]);

    public get statements() {
        return this.ast.statements;
    }

    /**
     * References for significant statements/expressions in the parser.
     * These are initially extracted during parse-time to improve performance, but will also be dynamically regenerated if need be.
     *
     * If a plugin modifies the AST, then the plugin should call Parser#invalidateReferences() to force this object to refresh
     */
    public get references() {
        //build the references object if it's missing.
        if (!this._references) {
            this.findReferences();
        }
        return this._references;
    }

    private _references: References = createReferences();

    /**
     * Invalidates (clears) the references collection. This should be called anytime the AST has been manipulated.
     */
    invalidateReferences() {
        this._references = undefined;
    }

    private addPropertyHints(item: Token | AALiteralExpression) {
        if (isToken(item)) {
            const name = item.text;
            this._references.propertyHints[name.toLowerCase()] = name;
        } else {
            for (const member of item.elements) {
                if (!isCommentStatement(member)) {
                    const name = member.keyToken.text;
                    if (!name.startsWith('"')) {
                        this._references.propertyHints[name.toLowerCase()] = name;
                    }
                }
            }
        }
    }

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
     * A list of identifiers that are permitted to be used as local variables. We store this in a property because we augment the list in the constructor
     * based on the parse mode
     */
    private allowedLocalIdentifiers: TokenKind[];

    /**
     * Annotations collected which should be attached to the next statement
     */
    private pendingAnnotations: AnnotationExpression[];

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
        this.pendingAnnotations = [];

        this.ast = this.body();

        return this;
    }

    private logger: Logger;

    private body() {
        const parentAnnotations = this.enterAnnotationBlock();

        let body = new Body([]);
        if (this.tokens.length > 0) {
            this.consumeStatementSeparators(true);

            try {
                while (
                    //not at end of tokens
                    !this.isAtEnd() &&
                    //the next token is not one of the end terminators
                    !this.checkAny(...this.peekGlobalTerminators())
                ) {
                    let dec = this.declaration();
                    if (dec) {
                        if (!isAnnotationExpression(dec)) {
                            this.consumePendingAnnotations(dec);
                            body.statements.push(dec);
                            //ensure statement separator
                            this.consumeStatementSeparators(false);
                        } else {
                            this.consumeStatementSeparators(true);
                        }
                    }
                }
            } catch (parseError) {
                //do nothing with the parse error for now. perhaps we can remove this?
                console.error(parseError);
            }
        }

        this.exitAnnotationBlock(parentAnnotations);
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
        let error = new Error(this.diagnostics[this.diagnostics.length - 1]?.message ?? 'Unknown error');
        (error as any).isDiagnostic = true;
        return error;
    }

    private declaration(): Statement | AnnotationExpression | undefined {
        try {
            if (this.check(TokenKind.Class)) {
                return this.classDeclaration();
            }

            if (this.checkAny(TokenKind.Sub, TokenKind.Function)) {
                return this.functionDeclaration(false);
            }

            if (this.checkLibrary()) {
                return this.libraryStatement();
            }

            if (this.check(TokenKind.Namespace)) {
                return this.namespaceStatement();
            }

            if (this.check(TokenKind.At) && this.checkNext(TokenKind.Identifier)) {
                return this.annotationExpression();
            }

            if (this.check(TokenKind.Comment)) {
                return this.commentStatement();
            }

            //catch certain global terminators to prevent unnecessary lookahead (i.e. like `end namespace`, no need to continue)
            if (this.checkAny(...this.peekGlobalTerminators())) {
                return;
            }

            return this.statement();
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

        const parentAnnotations = this.enterAnnotationBlock();

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
        }

        //ensure statement separator
        this.consumeStatementSeparators();

        //gather up all class members (Fields, Methods)
        let body = [] as Statement[];
        while (this.checkAny(TokenKind.Public, TokenKind.Protected, TokenKind.Private, TokenKind.Function, TokenKind.Sub, TokenKind.Comment, TokenKind.Identifier, TokenKind.At, ...AllowedProperties)) {
            try {
                let decl: Statement;
                let accessModifier: Token;

                if (this.check(TokenKind.At) && this.checkNext(TokenKind.Identifier)) {
                    this.annotationExpression();
                }

                if (this.checkAny(TokenKind.Public, TokenKind.Protected, TokenKind.Private)) {
                    //use actual access modifier
                    accessModifier = this.advance();
                }

                let overrideKeyword: Token;
                if (this.peek().text.toLowerCase() === 'override') {
                    overrideKeyword = this.advance();
                }

                //methods (function/sub keyword OR identifier followed by opening paren)
                if (this.checkAny(TokenKind.Function, TokenKind.Sub) || (this.checkAny(TokenKind.Identifier, ...AllowedProperties) && this.checkNext(TokenKind.LeftParen))) {
                    const funcDeclaration = this.functionDeclaration(false, false);

                    //remove this function from the lists because it's not a callable
                    const functionStatement = this._references.functionStatements.pop();

                    //if we have an overrides keyword AND this method is called 'new', that's not allowed
                    if (overrideKeyword && funcDeclaration.name.text.toLowerCase() === 'new') {
                        this.diagnostics.push({
                            ...DiagnosticMessages.cannotUseOverrideKeywordOnConstructorFunction(),
                            range: overrideKeyword.range
                        });
                    }

                    decl = new ClassMethodStatement(
                        accessModifier,
                        funcDeclaration.name,
                        funcDeclaration.func,
                        overrideKeyword
                    );

                    //refer to this statement as parent of the expression
                    functionStatement.func.functionStatement = decl as ClassMethodStatement;

                    //fields
                } else if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {

                    decl = this.classFieldDeclaration(accessModifier);

                    //class fields cannot be overridden
                    if (overrideKeyword) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.classFieldCannotBeOverridden(),
                            range: overrideKeyword.range
                        });
                    }

                    //comments
                } else if (this.check(TokenKind.Comment)) {
                    decl = this.commentStatement();
                }

                if (decl) {
                    this.consumePendingAnnotations(decl);
                    body.push(decl);
                }
            } catch (e) {
                //throw out any failed members and move on to the next line
                this.flagUntil(TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
            }

            //ensure statement separator
            this.consumeStatementSeparators();
        }

        let endingKeyword = this.advance();
        if (endingKeyword.kind !== TokenKind.EndClass) {
            this.diagnostics.push({
                ...DiagnosticMessages.couldNotFindMatchingEndKeyword('class'),
                range: endingKeyword.range
            });
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

        this._references.classStatements.push(result);
        this.exitAnnotationBlock(parentAnnotations);
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
            fieldType = this.typeToken();

            //no field type specified
            if (!util.tokenToBscType(fieldType) && !this.check(TokenKind.Identifier)) {
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

    private functionDeclaration(isAnonymous: true, checkIdentifier?: boolean): FunctionExpression;
    private functionDeclaration(isAnonymous: false, checkIdentifier?: boolean): FunctionStatement;
    private functionDeclaration(isAnonymous: boolean, checkIdentifier = true) {
        let previousCallExpressions = this.callExpressions;
        this.callExpressions = [];
        try {
            //track depth to help certain statements need to know if they are contained within a function body
            this.namespaceAndFunctionDepth++;
            let functionType: Token;
            if (this.checkAny(TokenKind.Sub, TokenKind.Function)) {
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
                    },
                    leadingWhitespace: ''
                };
            }
            let isSub = functionType?.kind === TokenKind.Sub;
            let functionTypeText = isSub ? 'sub' : 'function';
            let name: Identifier;
            let leftParen: Token;

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

                //flag functions with keywords for names (only for standard functions)
                if (checkIdentifier && DisallowedFunctionIdentifiersText.has(name.text.toLowerCase())) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.cannotUseReservedWordAsIdentifier(name.text),
                        range: name.range
                    });
                }
            }

            let params = [] as FunctionParameterExpression[];
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

                typeToken = this.typeToken();

                if (!util.tokenToBscType(typeToken, this.options.mode === ParseMode.BrighterScript)) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.invalidFunctionReturnType(typeToken.text ?? ''),
                        range: typeToken.range
                    });
                }
            }

            params.reduce((haveFoundOptional: boolean, param: FunctionParameterExpression) => {
                if (haveFoundOptional && !param.defaultValue) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.requiredParameterMayNotFollowOptionalParameter(param.name.text),
                        range: param.range
                    });
                }

                return haveFoundOptional || !!param.defaultValue;
            }, false);

            this.consumeStatementSeparators(true);

            let func = new FunctionExpression(
                params,
                undefined, //body
                functionType,
                undefined, //ending keyword
                leftParen,
                rightParen,
                asToken,
                typeToken,
                this.currentFunctionExpression,
                this.currentNamespaceName
            );
            //if there is a parent function, register this function with the parent
            if (this.currentFunctionExpression) {
                this.currentFunctionExpression.childFunctionExpressions.push(func);
            }

            this._references.functionExpressions.push(func);

            let previousFunctionExpression = this.currentFunctionExpression;
            this.currentFunctionExpression = func;

            //make sure to restore the currentFunctionExpression even if the body block fails to parse
            try {
                //support ending the function with `end sub` OR `end function`
                func.body = this.block();
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
                let result = new FunctionStatement(name, func, this.currentNamespaceName);
                func.functionStatement = result;
                this._references.functionStatements.push(result);
                return result;
            }
        } finally {
            this.namespaceAndFunctionDepth--;
            //restore the previous CallExpression list
            this.callExpressions = previousCallExpressions;
        }
    }

    private functionParameter(): FunctionParameterExpression {
        if (!this.checkAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedParameterNameButFound(this.peek().text),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }

        let name = this.advance() as Identifier;
        // force the name into an identifier so the AST makes some sense
        name.kind = TokenKind.Identifier;

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

            typeToken = this.typeToken();

            if (!util.tokenToBscType(typeToken, this.options.mode === ParseMode.BrighterScript)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.functionParameterTypeIsInvalid(name.text, typeToken.text),
                    range: typeToken.range
                });
                throw this.lastDiagnosticAsError();
            }
        }
        return new FunctionParameterExpression(
            name,
            typeToken,
            defaultValue,
            asToken,
            this.currentNamespaceName
        );
    }

    private assignment(): AssignmentStatement {
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
        this._references.assignmentStatements.push(result);
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

    private statement(): Statement | undefined {
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

        //`try` must be followed by a block, otherwise it could be a local variable
        if (this.check(TokenKind.Try) && this.checkAnyNext(TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
            return this.tryCatchStatement();
        }

        if (this.check(TokenKind.Throw)) {
            return this.throwStatement();
        }

        if (this.checkAny(TokenKind.Print, TokenKind.Question)) {
            return this.printStatement();
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
        if (this.check(TokenKind.Identifier) && this.checkNext(TokenKind.Colon) && this.checkPrevious(TokenKind.Newline)) {
            try {
                return this.labelStatement();
            } catch (err) {
                if (!(err instanceof CancelStatementError)) {
                    throw err;
                }
                //not a label, try something else
            }
        }

        // BrightScript is like python, in that variables can be declared without a `var`,
        // `let`, (...) keyword. As such, we must check the token *after* an identifier to figure
        // out what to do with it.
        if (
            this.checkAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers) &&
            this.checkAnyNext(...AssignmentOperators)
        ) {
            return this.assignment();
        }

        // TODO: support multi-statements
        return this.setStatement();
    }

    private whileStatement(): WhileStatement {
        const whileKeyword = this.advance();
        const condition = this.expression();

        this.consumeStatementSeparators();

        const whileBlock = this.block(TokenKind.EndWhile);
        let endWhile: Token;
        if (!whileBlock || this.peek().kind !== TokenKind.EndWhile) {
            this.diagnostics.push({
                ...DiagnosticMessages.couldNotFindMatchingEndKeyword('while'),
                range: this.peek().range
            });
            if (!whileBlock) {
                throw this.lastDiagnosticAsError();
            }
        } else {
            endWhile = this.advance();
        }

        return new WhileStatement(
            { while: whileKeyword, endWhile: endWhile },
            condition,
            whileBlock
        );
    }

    private exitWhile(): ExitWhileStatement {
        let keyword = this.advance();

        return new ExitWhileStatement({ exitWhile: keyword });
    }

    private forStatement(): ForStatement {
        const forToken = this.advance();
        const initializer = this.assignment();

        //TODO: newline allowed?

        const toToken = this.advance();
        const finalValue = this.expression();
        let incrementExpression: Expression | undefined;
        let stepToken: Token | undefined;

        if (this.check(TokenKind.Step)) {
            stepToken = this.advance();
            incrementExpression = this.expression();
        } else {
            // BrightScript for/to/step loops default to a step of 1 if no `step` is provided
        }

        this.consumeStatementSeparators();

        let body = this.block(TokenKind.EndFor, TokenKind.Next);
        let endForToken: Token;
        if (!body || !this.checkAny(TokenKind.EndFor, TokenKind.Next)) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndForOrNextToTerminateForLoop(),
                range: this.peek().range
            });
            if (!body) {
                throw this.lastDiagnosticAsError();
            }
        } else {
            endForToken = this.advance();
        }

        // WARNING: BrightScript doesn't delete the loop initial value after a for/to loop! It just
        // stays around in scope with whatever value it was when the loop exited.
        return new ForStatement(
            forToken,
            initializer,
            toToken,
            finalValue,
            body,
            endForToken,
            stepToken,
            incrementExpression
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

        this.consumeStatementSeparators();

        let body = this.block(TokenKind.EndFor, TokenKind.Next);
        if (!body) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndForOrNextToTerminateForLoop(),
                range: this.peek().range
            });
            throw this.lastDiagnosticAsError();
        }

        let endFor = this.advance();

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

        return new ExitForStatement({ exitFor: keyword });
    }

    private commentStatement() {
        //if this comment is on the same line as the previous statement,
        //then this comment should be treated as a single-line comment
        let prev = this.previous();
        if (prev?.range.end.line === this.peek().range.start.line) {
            return new CommentStatement([this.advance()]);
        } else {
            let comments = [this.advance()];
            while (this.check(TokenKind.Newline) && this.checkNext(TokenKind.Comment)) {
                this.advance();
                comments.push(this.advance());
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

        this.namespaceAndFunctionDepth--;
        let result = new NamespaceStatement(keyword, name, body, endKeyword);
        this._references.namespaceStatements.push(result);

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

                if (!identifier) {
                    break;
                }
                // force it into an identifier so the AST makes some sense
                identifier.kind = TokenKind.Identifier;
                expr = new DottedGetExpression(expr, identifier, dot);
            }
        }
        return new NamespacedVariableNameExpression(expr);
    }

    /**
     * Add an 'unexpected token' diagnostic for any token found between current and the first stopToken found.
     */
    private flagUntil(...stopTokens: TokenKind[]) {
        while (!this.checkAny(...stopTokens) && !this.isAtEnd()) {
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

        this._references.libraryStatements.push(libStatement);
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

        this._references.importStatements.push(importStatement);
        return importStatement;
    }

    private annotationExpression() {
        let annotation = new AnnotationExpression(
            this.advance(),
            this.advance()
        );
        this.pendingAnnotations.push(annotation);

        //optional arguments
        if (this.check(TokenKind.LeftParen)) {
            let leftParen = this.advance();
            annotation.call = this.finishCall(leftParen, annotation, false);
        }
        return annotation;
    }

    private ternaryExpression(test?: Expression): TernaryExpression {
        this.warnIfNotBrighterScriptMode('ternary operator');
        if (!test) {
            test = this.expression();
        }
        const questionMarkToken = this.advance();

        //consume newlines or comments
        while (this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            this.advance();
        }

        //we are a ternary
        const consequent = this.expression();

        //consume newlines or comments
        while (this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            this.advance();
        }

        if (!this.check(TokenKind.Colon)) {
            //got here in error
            this.diagnostics.push({
                ...DiagnosticMessages.malformedTernaryExpression(),
                range: test.range
            });
        }

        const colonToken = this.tryConsume(DiagnosticMessages.malformedTernaryExpression(), TokenKind.Colon);

        //consume newlines
        while (this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            this.advance();
        }

        const alternate = this.expression();

        if (!consequent || !alternate) {
            this.diagnostics.push({
                ...DiagnosticMessages.malformedTernaryExpression(),
                range: test.range
            });
        }
        return new TernaryExpression(test, questionMarkToken, consequent, colonToken, alternate);
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
                    new LiteralExpression(next)
                );
                this.advance();
            } else if (next.kind === TokenKind.EscapedCharCodeLiteral) {
                currentQuasiExpressionParts.push(
                    new EscapedCharCodeLiteralExpression(<any>next)
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

    private tryCatchStatement(): TryCatchStatement {
        const tryToken = this.advance();
        const statement = new TryCatchStatement(
            tryToken
        );

        //ensure statement separator
        this.consumeStatementSeparators();

        statement.tryBranch = this.block(TokenKind.Catch, TokenKind.EndTry);

        const peek = this.peek();
        if (peek.kind !== TokenKind.Catch) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedCatchBlockInTryCatch(),
                range: this.peek().range
            });
            //gracefully handle end-try
            if (peek.kind === TokenKind.EndTry) {
                statement.endTryToken = this.advance();
            }
            return statement;
        } else {
            statement.catchToken = this.advance();
        }

        const exceptionVarToken = this.tryConsume(DiagnosticMessages.missingExceptionVarToFollowCatch(), TokenKind.Identifier, ...this.allowedLocalIdentifiers);
        if (exceptionVarToken) {
            // force it into an identifier so the AST makes some sense
            exceptionVarToken.kind = TokenKind.Identifier;
            statement.exceptionVariable = exceptionVarToken as Identifier;
        }

        //ensure statement sepatator
        this.consumeStatementSeparators();

        statement.catchBranch = this.block(TokenKind.EndTry);

        if (this.peek().kind !== TokenKind.EndTry) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndTryToTerminateTryCatch(),
                range: this.peek().range
            });
        } else {
            statement.endTryToken = this.advance();
        }
        return statement;
    }

    private throwStatement() {
        const throwToken = this.advance();
        let expression: Expression;
        if (this.checkAny(TokenKind.Newline, TokenKind.Colon)) {
            this.diagnostics.push({
                ...DiagnosticMessages.missingExceptionExpressionAfterThrowKeyword(),
                range: throwToken.range
            });
        } else {
            expression = this.expression();
        }
        return new ThrowStatement(throwToken, expression);
    }

    private ifStatement(): IfStatement {
        // colon before `if` is usually not allowed, unless it's after `then`
        if (this.current > 0) {
            const prev = this.previous();
            if (prev.kind === TokenKind.Colon) {
                if (this.current > 1 && this.tokens[this.current - 2].kind !== TokenKind.Then) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.unexpectedColonBeforeIfStatement(),
                        range: prev.range
                    });
                }
            }
        }

        const ifToken = this.advance();
        const startingRange = ifToken.range;

        const condition = this.expression();
        let thenBranch: Block;
        let elseBranch: IfStatement | Block | undefined;

        let thenToken: Token | undefined;
        let endIfToken: Token | undefined;
        let elseToken: Token | undefined;

        //optional `then`
        if (this.check(TokenKind.Then)) {
            thenToken = this.advance();
        }

        //is it inline or multi-line if?
        const isInlineIfThen = !this.checkAny(TokenKind.Newline, TokenKind.Colon, TokenKind.Comment);

        if (isInlineIfThen) {
            /*** PARSE INLINE IF STATEMENT ***/

            thenBranch = this.inlineConditionalBranch(TokenKind.Else, TokenKind.EndIf);

            if (!thenBranch) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedStatementToFollowConditionalCondition(ifToken.text),
                    range: this.peek().range
                });
                throw this.lastDiagnosticAsError();
            } else {
                this.ensureInline(thenBranch.statements);
            }

            //else branch
            if (this.check(TokenKind.Else)) {
                elseToken = this.advance();

                if (this.check(TokenKind.If)) {
                    // recurse-read `else if`
                    elseBranch = this.ifStatement();

                    //no multi-line if chained with an inline if
                    if (!elseBranch.isInline) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.expectedInlineIfStatement(),
                            range: elseBranch.range
                        });
                    }

                } else if (this.checkAny(TokenKind.Newline, TokenKind.Colon)) {
                    //expecting inline else branch
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedInlineIfStatement(),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                } else {
                    elseBranch = this.inlineConditionalBranch(TokenKind.Else, TokenKind.EndIf);

                    if (elseBranch) {
                        this.ensureInline(elseBranch.statements);
                    }
                }

                if (!elseBranch) {
                    //missing `else` branch
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedStatementToFollowElse(),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                }
            }

            if (!elseBranch || !isIfStatement(elseBranch)) {
                //enforce newline at the end of the inline if statement
                const peek = this.peek();
                if (peek.kind !== TokenKind.Newline && peek.kind !== TokenKind.Comment && !this.isAtEnd()) {
                    //ignore last error if it was about a colon
                    if (this.previous().kind === TokenKind.Colon) {
                        this.diagnostics.pop();
                        this.current--;
                    }
                    //newline is required
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedFinalNewline(),
                        range: this.peek().range
                    });
                }
            }

        } else {
            /*** PARSE MULTI-LINE IF STATEMENT ***/

            thenBranch = this.blockConditionalBranch(ifToken);

            //ensure newline/colon before next keyword
            this.ensureNewLineOrColon();

            //else branch
            if (this.check(TokenKind.Else)) {
                elseToken = this.advance();

                if (this.check(TokenKind.If)) {
                    // recurse-read `else if`
                    elseBranch = this.ifStatement();

                } else {
                    elseBranch = this.blockConditionalBranch(ifToken);

                    //ensure newline/colon before next keyword
                    this.ensureNewLineOrColon();
                }
            }

            if (!isIfStatement(elseBranch)) {
                if (this.check(TokenKind.EndIf)) {
                    endIfToken = this.advance();

                } else {
                    //missing endif
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedEndIfToCloseIfStatement(startingRange.start),
                        range: ifToken.range
                    });
                }
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
            elseBranch,
            isInlineIfThen
        );
    }

    //consume a `then` or `else` branch block of an `if` statement
    private blockConditionalBranch(ifToken: Token) {
        //keep track of the current error count, because if the then branch fails,
        //we will trash them in favor of a single error on if
        let diagnosticsLengthBeforeBlock = this.diagnostics.length;

        // we're parsing a multi-line ("block") form of the BrightScript if/then and must find
        // a trailing "end if" or "else if"
        let branch = this.block(TokenKind.EndIf, TokenKind.Else);

        if (!branch) {
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
        return branch;
    }

    private ensureNewLineOrColon(silent = false) {
        const prev = this.previous().kind;
        if (prev !== TokenKind.Newline && prev !== TokenKind.Colon) {
            if (!silent) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedNewlineOrColon(),
                    range: this.peek().range
                });
            }
            return false;
        }
        return true;
    }

    //ensure each statement of an inline block is single-line
    private ensureInline(statements: Statement[]) {
        for (const stat of statements) {
            if (isIfStatement(stat) && !stat.isInline) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedInlineIfStatement(),
                    range: stat.range
                });
            }
        }
    }

    //consume inline branch of an `if` statement
    private inlineConditionalBranch(...additionalTerminators: BlockTerminator[]): Block | undefined {
        let statements = [];
        //attempt to get the next statement without using `this.declaration`
        //which seems a bit hackish to get to work properly
        let statement = this.statement();
        if (!statement) {
            return undefined;
        }
        statements.push(statement);

        //look for colon statement separator
        let foundColon = false;
        while (this.match(TokenKind.Colon)) {
            foundColon = true;
        }

        //if a colon was found, add the next statement or err if unexpected
        if (foundColon) {
            if (!this.checkAny(TokenKind.Newline, ...additionalTerminators)) {
                //if not an ending keyword, add next statement
                let extra = this.inlineConditionalBranch(...additionalTerminators);
                if (!extra) {
                    return undefined;
                }
                statements.push(...extra.statements);
            } else {
                //error: colon before next keyword
                const colon = this.previous();
                this.diagnostics.push({
                    ...DiagnosticMessages.foundUnexpectedToken(colon.text),
                    range: colon.range
                });
            }
        }
        return new Block(statements, this.peek().range);
    }

    private expressionStatement(expr: Expression): ExpressionStatement | IncrementStatement {
        let expressionStart = this.peek();

        if (this.checkAny(TokenKind.PlusPlus, TokenKind.MinusMinus)) {
            let operator = this.advance();

            if (this.checkAny(TokenKind.PlusPlus, TokenKind.MinusMinus)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.consecutiveIncrementDecrementOperatorsAreNotAllowed(),
                    range: this.peek().range
                });
                throw this.lastDiagnosticAsError();
            } else if (isCallExpression(expr)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.incrementDecrementOperatorsAreNotAllowedAsResultOfFunctionCall(),
                    range: expressionStart.range
                });
                throw this.lastDiagnosticAsError();
            }

            return new IncrementStatement(expr, operator);
        }

        if (isCallExpression(expr) || isCallfuncExpression(expr)) {
            return new ExpressionStatement(expr);
        }

        //at this point, it's probably an error. However, we recover a little more gracefully by creating an assignment
        this.diagnostics.push({
            ...DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression(),
            range: expressionStart.range
        });
        throw this.lastDiagnosticAsError();
    }

    private setStatement(): DottedSetStatement | IndexedSetStatement | ExpressionStatement | IncrementStatement | AssignmentStatement {
        /**
         * Attempts to find an expression-statement or an increment statement.
         * While calls are valid expressions _and_ statements, increment (e.g. `foo++`)
         * statements aren't valid expressions. They _do_ however fall under the same parsing
         * priority as standalone function calls though, so we can parse them in the same way.
         */
        let expr = this.call();
        if (this.checkAny(...AssignmentOperators) && !(isCallExpression(expr))) {
            let left = expr;
            let operator = this.advance();
            let right = this.expression();

            // Create a dotted or indexed "set" based on the left-hand side's type
            if (isIndexedGetExpression(left)) {
                return new IndexedSetStatement(
                    left.obj,
                    left.index,
                    operator.kind === TokenKind.Equal
                        ? right
                        : new BinaryExpression(left, operator, right),
                    left.openingSquare,
                    left.closingSquare
                );
            } else if (isDottedGetExpression(left)) {
                return new DottedSetStatement(
                    left.obj,
                    left.name,
                    operator.kind === TokenKind.Equal
                        ? right
                        : new BinaryExpression(left, operator, right)
                );
            }
        }
        return this.expressionStatement(expr);
    }

    private printStatement(): PrintStatement {
        let printKeyword = this.advance();

        let values: (
            | Expression
            | PrintSeparatorTab
            | PrintSeparatorSpace)[] = [];

        while (!this.checkEndOfStatement()) {
            if (this.check(TokenKind.Semicolon)) {
                values.push(this.advance() as PrintSeparatorSpace);
            } else if (this.check(TokenKind.Comma)) {
                values.push(this.advance() as PrintSeparatorTab);
            } else {
                values.push(this.expression());
            }
        }

        //print statements can be empty, so look for empty print conditions
        if (!values.length) {
            let emptyStringLiteral = createStringLiteral('');
            values.push(emptyStringLiteral);
        }

        let last = values[values.length - 1];
        if (isToken(last)) {
            // TODO: error, expected value
        }

        return new PrintStatement({ print: printKeyword }, values);
    }

    /**
     * Parses a return statement with an optional return value.
     * @returns an AST representation of a return statement.
     */
    private returnStatement(): ReturnStatement {
        let tokens = { return: this.previous() };

        if (this.checkEndOfStatement()) {
            return new ReturnStatement(tokens);
        }

        let toReturn = this.expression();
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

        //label must be alone on its line, this is probably not a label
        if (!this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            //rewind and cancel
            this.current -= 2;
            throw new CancelStatementError();
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

        return new GotoStatement(tokens);
    }

    /**
     * Parses an `end` statement
     * @returns an AST representation of an `end` statement.
     */
    private endStatement() {
        let endTokens = { end: this.advance() };

        return new EndStatement(endTokens);
    }
    /**
     * Parses a `stop` statement
     * @returns an AST representation of a `stop` statement
     */
    private stopStatement() {
        let tokens = { stop: this.advance() };

        return new StopStatement(tokens);
    }

    /**
     * Parses a block, looking for a specific terminating TokenKind to denote completion.
     * Always looks for `end sub`/`end function` to handle unterminated blocks.
     * @param terminators the token(s) that signifies the end of this block; all other terminators are
     *                    ignored.
     */
    private block(...terminators: BlockTerminator[]): Block | undefined {
        const parentAnnotations = this.enterAnnotationBlock();

        this.consumeStatementSeparators(true);
        let startingToken = this.peek();

        const statements: Statement[] = [];
        while (!this.isAtEnd() && !this.checkAny(TokenKind.EndSub, TokenKind.EndFunction, ...terminators)) {
            //grab the location of the current token
            let loopCurrent = this.current;
            let dec = this.declaration();
            if (dec) {
                if (!isAnnotationExpression(dec)) {
                    this.consumePendingAnnotations(dec);
                    statements.push(dec);
                }

                //ensure statement separator
                this.consumeStatementSeparators();

            } else {
                //something went wrong. reset to the top of the loop
                this.current = loopCurrent;

                //scrap the entire line (hopefully whatever failed has added a diagnostic)
                this.consumeUntil(TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);

                //trash the next token. this prevents an infinite loop. not exactly sure why we need this,
                //but there's already an error in the file being parsed, so just leave this line here
                this.advance();

                //consume potential separators
                this.consumeStatementSeparators(true);
            }
        }

        if (this.isAtEnd()) {
            return undefined;
            // TODO: Figure out how to handle unterminated blocks well
        } else if (terminators.length > 0) {
            //did we hit end-sub / end-function while looking for some other terminator?
            //if so, we need to restore the statement separator
            let prev = this.previous().kind;
            let peek = this.peek().kind;
            if (
                (peek === TokenKind.EndSub || peek === TokenKind.EndFunction) &&
                (prev === TokenKind.Newline || prev === TokenKind.Colon)
            ) {
                this.current--;
            }
        }

        this.exitAnnotationBlock(parentAnnotations);
        return new Block(statements, startingToken.range);
    }

    /**
     * Attach pending annotations to the provided statement,
     * and then reset the annotations array
     */
    consumePendingAnnotations(statement: Statement) {
        if (this.pendingAnnotations.length) {
            statement.annotations = this.pendingAnnotations;
            this.pendingAnnotations = [];
        }
    }

    enterAnnotationBlock() {
        const pending = this.pendingAnnotations;
        this.pendingAnnotations = [];
        return pending;
    }

    exitAnnotationBlock(parentAnnotations: AnnotationExpression[]) {
        // non consumed annotations are an error
        if (this.pendingAnnotations.length) {
            for (const annotation of this.pendingAnnotations) {
                this.diagnostics.push({
                    ...DiagnosticMessages.unusedAnnotation(),
                    range: annotation.range
                });
            }
        }
        this.pendingAnnotations = parentAnnotations;
    }

    private expression(): Expression {
        return this.anonymousFunction();
    }

    private anonymousFunction(): Expression {
        if (this.checkAny(TokenKind.Sub, TokenKind.Function)) {
            return this.functionDeclaration(true);
        }

        //template string
        if (this.check(TokenKind.BackTick)) {
            return this.templateString(false);
            //tagged template string (currently we do not support spaces between the identifier and the backtick
        } else if (this.checkAny(TokenKind.Identifier, ...AllowedLocalIdentifiers) && this.checkNext(TokenKind.BackTick)) {
            return this.templateString(true);
        }
        let expr = this.boolean();

        if (this.check(TokenKind.Question)) {
            return this.ternaryExpression(expr);
        } else {
            return expr;
        }
    }

    private boolean(): Expression {
        let expr = this.relational();

        while (this.matchAny(TokenKind.And, TokenKind.Or)) {
            let operator = this.previous();
            let right = this.relational();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    private relational(): Expression {
        let expr = this.additive();

        while (
            this.matchAny(
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

        while (this.matchAny(TokenKind.Plus, TokenKind.Minus)) {
            let operator = this.previous();
            let right = this.multiplicative();
            expr = new BinaryExpression(expr, operator, right);
        }

        return expr;
    }

    private multiplicative(): Expression {
        let expr = this.exponential();

        while (this.matchAny(
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
        const nextKind = this.peek().kind;
        if (nextKind === TokenKind.Not || nextKind === TokenKind.Minus) {
            this.current++; //advance
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
        this._references.newExpressions.push(result);
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
        let call = this.finishCall(openParen, callee, false);

        return new CallfuncExpression(callee, operator, methodName as Identifier, openParen, call.args, call.closingParen);
    }

    private call(): Expression {
        if (this.check(TokenKind.New) && this.checkAnyNext(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
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
                    this.addPropertyHints(name);
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

    private finishCall(openingParen: Token, callee: Expression, addToCallExpressionList = true) {
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

        if (isVariableExpression(callee)) {
            callee.isCalled = true;
        }

        let expression = new CallExpression(callee, openingParen, closingParen, args, this.currentNamespaceName);
        if (addToCallExpressionList) {
            this.callExpressions.push(expression);
        }
        return expression;
    }

    /**
     * Tries to get the next token as a type
     * Allows for built-in types (double, string, etc.) or namespaced custom types in Brighterscript mode
     * Will always return a token of whatever is next to be parsed
     */
    private typeToken(): Token {
        let typeToken: Token;

        if (this.checkAny(...DeclarableTypes)) {
            // Token is a built in type
            typeToken = this.advance();
        } else if (this.options.mode === ParseMode.BrighterScript) {
            try {
                // see if we can get a namespaced identifer
                const qualifiedType = this.getNamespacedVariableNameExpression();
                typeToken = createToken(TokenKind.Identifier, qualifiedType.getName(this.options.mode), qualifiedType.range);
            } catch {
                //could not get an identifier - just get whatever's next
                typeToken = this.advance();
            }
        } else {
            // just get whatever's next
            typeToken = this.advance();
        }
        return typeToken;
    }

    private primary(): Expression {
        switch (true) {
            case this.matchAny(
                TokenKind.False,
                TokenKind.True,
                TokenKind.Invalid,
                TokenKind.IntegerLiteral,
                TokenKind.LongIntegerLiteral,
                TokenKind.FloatLiteral,
                TokenKind.DoubleLiteral,
                TokenKind.StringLiteral
            ):
                return new LiteralExpression(this.previous());
            //capture source literals (LINE_NUM if brightscript, or a bunch of them if brighterscript)
            case this.matchAny(TokenKind.LineNumLiteral, ...(this.options.mode === ParseMode.BrightScript ? [] : BrighterScriptSourceLiterals)):
                return new SourceLiteralExpression(this.previous());
            case this.matchAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers):
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

                    while (this.matchAny(TokenKind.Comma, TokenKind.Newline, TokenKind.Comment)) {
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
                        range: null as Range
                    };
                    if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {
                        result.keyToken = this.advance();
                    } else if (this.check(TokenKind.StringLiteral)) {
                        result.keyToken = this.advance();
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
                        members.push(new AAMemberExpression(
                            k.keyToken,
                            k.colonToken,
                            expr
                        ));
                    }

                    while (this.matchAny(TokenKind.Comma, TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
                        //check for comment at the end of the current line
                        if (this.check(TokenKind.Comment) || this.checkPrevious(TokenKind.Comment)) {
                            let token = this.checkPrevious(TokenKind.Comment) ? this.previous() : this.advance();
                            members.push(new CommentStatement([token]));
                        } else {
                            while (this.matchAny(TokenKind.Newline, TokenKind.Colon)) {

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
                            members.push(new AAMemberExpression(
                                k.keyToken,
                                k.colonToken,
                                expr
                            ));
                        }
                    }

                    this.consume(
                        DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral(),
                        TokenKind.RightCurlyBrace
                    );
                }

                let closingBrace = this.previous();

                const aaExpr = new AALiteralExpression(members, openingBrace, closingBrace);
                this.addPropertyHints(aaExpr);
                return aaExpr;
            case this.matchAny(TokenKind.Pos, TokenKind.Tab):
                let token = Object.assign(this.previous(), {
                    kind: TokenKind.Identifier
                }) as Identifier;
                return new VariableExpression(token, this.currentNamespaceName);
            case this.checkAny(TokenKind.Function, TokenKind.Sub):
                return this.anonymousFunction();
            case this.check(TokenKind.Comment):
                return new CommentStatement([this.advance()]);
            default:
                //if we found an expected terminator, don't throw a diagnostic...just return undefined
                if (this.checkAny(...this.peekGlobalTerminators())) {
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
     * Pop token if we encounter specified token
     */
    private match(tokenKind: TokenKind) {
        if (this.check(tokenKind)) {
            this.current++; //advance
            return true;
        }
        return false;
    }

    /**
     * Pop token if we encounter a token in the specified list
     * @param tokenKinds
     */
    private matchAny(...tokenKinds: TokenKind[]) {
        for (let tokenKind of tokenKinds) {
            if (this.check(tokenKind)) {
                this.current++; //advance
                return true;
            }
        }
        return false;
    }

    /**
     * Get next token matching a specified list, or fail with an error
     */
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
     */
    private tryConsume(diagnostic: DiagnosticInfo, ...tokenKinds: TokenKind[]): Token | undefined {
        const nextKind = this.peek().kind;
        let foundTokenKind = tokenKinds.some(tokenKind => nextKind === tokenKind);

        if (foundTokenKind) {
            return this.advance();
        }
        this.diagnostics.push({
            ...diagnostic,
            range: this.peek().range
        });
    }

    private consumeStatementSeparators(optional = false) {
        //a comment or EOF mark the end of the statement
        if (this.isAtEnd() || this.check(TokenKind.Comment)) {
            return true;
        }
        let consumed = false;
        //consume any newlines and colons
        while (this.matchAny(TokenKind.Newline, TokenKind.Colon)) {
            consumed = true;
        }
        if (!optional && !consumed) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedNewlineOrColon(),
                range: this.peek().range
            });
        }
        return consumed;
    }

    private advance(): Token {
        if (!this.isAtEnd()) {
            this.current++;
        }
        return this.previous();
    }

    private checkEndOfStatement(): boolean {
        const nextKind = this.peek().kind;
        return [TokenKind.Colon, TokenKind.Newline, TokenKind.Comment, TokenKind.Eof].includes(nextKind);
    }

    private checkPrevious(tokenKind: TokenKind): boolean {
        return this.previous()?.kind === tokenKind;
    }

    private check(tokenKind: TokenKind): boolean {
        const nextKind = this.peek().kind;
        if (nextKind === TokenKind.Eof) {
            return false;
        }
        return nextKind === tokenKind;
    }

    private checkAny(...tokenKinds: TokenKind[]): boolean {
        const nextKind = this.peek().kind;
        if (nextKind === TokenKind.Eof) {
            return false;
        }
        return tokenKinds.includes(nextKind);
    }

    private checkNext(tokenKind: TokenKind): boolean {
        if (this.isAtEnd()) {
            return false;
        }
        return this.peekNext().kind === tokenKind;
    }

    private checkAnyNext(...tokenKinds: TokenKind[]): boolean {
        if (this.isAtEnd()) {
            return false;
        }
        const nextKind = this.peekNext().kind;
        return tokenKinds.includes(nextKind);
    }

    private isAtEnd(): boolean {
        return this.peek().kind === TokenKind.Eof;
    }

    private peekNext(): Token {
        if (this.isAtEnd()) {
            return this.peek();
        }
        return this.tokens[this.current + 1];
    }

    private peek(): Token {
        return this.tokens[this.current];
    }

    private previous(): Token {
        return this.tokens[this.current - 1];
    }

    private synchronize() {
        this.advance(); // skip the erroneous token

        while (!this.isAtEnd()) {
            if (this.ensureNewLineOrColon(true)) {
                // end of statement reached
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

    /**
     * References are found during the initial parse.
     * However, sometimes plugins can modify the AST, requiring a full walk to re-compute all references.
     * This does that walk.
     */
    private findReferences() {
        this._references = createReferences();

        this.ast.walk(createVisitor({
            AssignmentStatement: s => {
                this._references.assignmentStatements.push(s);
            },
            ClassStatement: s => {
                this._references.classStatements.push(s);
            },
            NamespaceStatement: s => {
                this._references.namespaceStatements.push(s);
            },
            FunctionStatement: s => {
                this._references.functionStatements.push(s);
            },
            ImportStatement: s => {
                this._references.importStatements.push(s);
            },
            LibraryStatement: s => {
                this._references.libraryStatements.push(s);
            },
            FunctionExpression: (expression, parent) => {
                if (!isClassMethodStatement(parent)) {
                    this._references.functionExpressions.push(expression);
                }
            },
            NewExpression: e => {
                this._references.newExpressions.push(e);
            },
            AALiteralExpression: e => {
                this.addPropertyHints(e);
            },
            DottedGetExpression: e => {
                this.addPropertyHints(e.name);
            },
            DottedSetStatement: e => {
                this.addPropertyHints(e.name);
            }
        }), {
            walkMode: WalkMode.visitAllRecursive
        });
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

function createReferences(): References {
    return {
        assignmentStatements: [],
        classStatements: [],
        functionExpressions: [],
        functionStatements: [],
        importStatements: [],
        libraryStatements: [],
        namespaceStatements: [],
        newExpressions: [],
        propertyHints: {}
    };
}

export interface References {
    assignmentStatements: AssignmentStatement[];
    classStatements: ClassStatement[];
    functionExpressions: FunctionExpression[];
    functionStatements: FunctionStatement[];
    importStatements: ImportStatement[];
    libraryStatements: LibraryStatement[];
    namespaceStatements: NamespaceStatement[];
    newExpressions: NewExpression[];
    propertyHints: Record<string, string>;
}

class CancelStatementError extends Error {
    constructor() {
        super('CancelStatement');
    }
}
