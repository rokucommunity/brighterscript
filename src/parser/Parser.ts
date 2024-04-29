import type { Token, Identifier } from '../lexer/Token';
import { isToken } from '../lexer/Token';
import type { BlockTerminator } from '../lexer/TokenKind';
import { Lexer } from '../lexer/Lexer';
import {
    AllowedLocalIdentifiers,
    AllowedTypeIdentifiers,
    DeclarableTypes,
    AllowedProperties,
    AssignmentOperators,
    BrighterScriptSourceLiterals,
    DisallowedFunctionIdentifiersText,
    DisallowedLocalIdentifiersText,
    TokenKind,
    BlockTerminators
} from '../lexer/TokenKind';
import type {
    PrintSeparatorSpace,
    PrintSeparatorTab
} from './Statement';
import {
    AssignmentStatement,
    Block,
    Body,
    CatchStatement,
    ContinueStatement,
    ClassStatement,
    ConstStatement,
    ConditionalCompileStatement,
    DimStatement,
    DottedSetStatement,
    EndStatement,
    EnumMemberStatement,
    EnumStatement,
    ExitForStatement,
    ExitWhileStatement,
    ExpressionStatement,
    ForEachStatement,
    FieldStatement,
    ForStatement,
    FunctionStatement,
    GotoStatement,
    IfStatement,
    ImportStatement,
    IncrementStatement,
    IndexedSetStatement,
    InterfaceFieldStatement,
    InterfaceMethodStatement,
    InterfaceStatement,
    LabelStatement,
    LibraryStatement,
    MethodStatement,
    NamespaceStatement,
    PrintStatement,
    ReturnStatement,
    StopStatement,
    ThrowStatement,
    TryCatchStatement,
    WhileStatement,
    TypecastStatement
} from './Statement';
import type { DiagnosticInfo } from '../DiagnosticMessages';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { util } from '../util';
import {
    AALiteralExpression,
    AAMemberExpression,
    AnnotationExpression,
    ArrayLiteralExpression,
    BinaryExpression,
    CallExpression,
    CallfuncExpression,
    DottedGetExpression,
    EscapedCharCodeLiteralExpression,
    FunctionExpression,
    FunctionParameterExpression,
    GroupingExpression,
    IndexedGetExpression,
    LiteralExpression,
    NewExpression,
    NullCoalescingExpression,
    RegexLiteralExpression,
    SourceLiteralExpression,
    TaggedTemplateStringExpression,
    TemplateStringExpression,
    TemplateStringQuasiExpression,
    TernaryExpression,
    TypecastExpression,
    TypeExpression,
    TypedArrayExpression,
    UnaryExpression,
    VariableExpression,
    XmlAttributeGetExpression
} from './Expression';
import type { Diagnostic, Range } from 'vscode-languageserver';
import { Logger } from '../Logger';
import { isAnnotationExpression, isCallExpression, isCallfuncExpression, isConditionalCompileStatement, isDottedGetExpression, isIfStatement, isIndexedGetExpression, isTypecastExpression } from '../astUtils/reflection';
import { createStringLiteral } from '../astUtils/creators';
import type { Expression, Statement } from './AstNode';
import type { DeepWriteable } from '../interfaces';

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
    public ast = new Body({ statements: [] });

    public get eofToken(): Token {
        const lastToken = this.tokens?.[this.tokens.length - 1];
        if (lastToken?.kind === TokenKind.Eof) {
            return lastToken;
        }
    }

    public get statements() {
        return this.ast.statements;
    }

    /**
     * The top-level symbol table for the body of this file.
     */
    public get symbolTable() {
        return this.ast.symbolTable;
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
    public static parse(toParse: Token[] | string, options?: ParseOptions): Parser {
        return new Parser().parse(toParse, options);
    }

    /**
     * Parses an array of `Token`s into an abstract syntax tree
     * @param toParse the array of tokens to parse. May not contain any whitespace tokens
     * @returns the same instance of the parser which contains the diagnostics and statements
     */
    public parse(toParse: Token[] | string, options?: ParseOptions) {
        this.logger = options?.logger ?? new Logger();
        options = this.sanitizeParseOptions(options);
        this.options = options;

        let tokens: Token[];
        if (typeof toParse === 'string') {
            tokens = Lexer.scan(toParse, { trackLocations: options.trackLocations }).tokens;
        } else {
            tokens = toParse;
        }
        this.tokens = tokens;
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
        //now that we've built the AST, link every node to its parent
        this.ast.link();
        return this;
    }

    private logger: Logger;

    private body() {
        const parentAnnotations = this.enterAnnotationBlock();

        let body = new Body({ statements: [] });
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
        options ??= {};
        options.mode ??= ParseMode.BrightScript;
        options.trackLocations ??= true;
        return options;
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
            if (this.checkAny(TokenKind.HashIf)) {
                return this.conditionalCompileStatement();
            }

            if (this.checkAny(TokenKind.Sub, TokenKind.Function)) {
                return this.functionDeclaration(false);
            }

            if (this.checkLibrary()) {
                return this.libraryStatement();
            }

            if (this.check(TokenKind.Const) && this.checkAnyNext(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
                return this.constDeclaration();
            }

            if (this.check(TokenKind.At) && this.checkNext(TokenKind.Identifier)) {
                return this.annotationExpression();
            }

            //catch certain global terminators to prevent unnecessary lookahead (i.e. like `end namespace`, no need to continue)
            if (this.checkAny(...this.peekGlobalTerminators())) {
                return;
            }

            return this.statement();
        } catch (error: any) {
            //if the error is not a diagnostic, then log the error for debugging purposes
            if (!error.isDiagnostic) {
                this.logger.error(error);
            }
            this.synchronize();
        }
    }

    /**
     * Try to get an identifier. If not found, add diagnostic and return undefined
     */
    private tryIdentifier(...additionalTokenKinds: TokenKind[]): Identifier | undefined {
        const identifier = this.tryConsume(
            DiagnosticMessages.expectedIdentifier(),
            TokenKind.Identifier,
            ...additionalTokenKinds
        ) as Identifier;
        if (identifier) {
            // force the name into an identifier so the AST makes some sense
            identifier.kind = TokenKind.Identifier;
            return identifier;
        }
    }

    private identifier(...additionalTokenKinds: TokenKind[]) {
        const identifier = this.consume(
            DiagnosticMessages.expectedIdentifier(),
            TokenKind.Identifier,
            ...additionalTokenKinds
        ) as Identifier;
        // force the name into an identifier so the AST makes some sense
        identifier.kind = TokenKind.Identifier;
        return identifier;
    }

    private enumMemberStatement() {
        const name = this.consume(
            DiagnosticMessages.expectedClassFieldIdentifier(),
            TokenKind.Identifier,
            ...AllowedProperties
        ) as Identifier;
        let equalsToken: Token;
        let value: Expression;
        //look for `= SOME_EXPRESSION`
        if (this.check(TokenKind.Equal)) {
            equalsToken = this.advance();
            value = this.expression();
        }
        const statement = new EnumMemberStatement({ name: name, equals: equalsToken, value: value });
        return statement;
    }

    /**
     * Create a new InterfaceMethodStatement. This should only be called from within `interfaceDeclaration`
     */
    private interfaceFieldStatement(optionalKeyword?: Token) {
        const name = this.identifier(...AllowedProperties);
        let asToken;
        let typeExpression;
        if (this.check(TokenKind.As)) {
            [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();
        }
        return new InterfaceFieldStatement({ name: name, as: asToken, typeExpression: typeExpression, optional: optionalKeyword });
    }

    private consumeAsTokenAndTypeExpression(ignoreDiagnostics = false): [Token, TypeExpression] {
        let asToken = this.consumeToken(TokenKind.As);
        let typeExpression: TypeExpression;
        if (asToken) {
            //if there's nothing after the `as`, add a diagnostic and continue
            if (this.checkEndOfStatement()) {
                if (!ignoreDiagnostics) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedIdentifierAfterKeyword(asToken.text),
                        range: asToken.range
                    });
                }
                //consume the statement separator
                this.consumeStatementSeparators();
            } else if (this.peek().kind !== TokenKind.Identifier && !this.checkAny(...DeclarableTypes, ...AllowedTypeIdentifiers)) {
                if (!ignoreDiagnostics) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.expectedIdentifierAfterKeyword(asToken.text),
                        range: asToken.range
                    });
                }
            } else {
                typeExpression = this.typeExpression();
            }
        }
        return [asToken, typeExpression];
    }

    /**
     * Create a new InterfaceMethodStatement. This should only be called from within `interfaceDeclaration()`
     */
    private interfaceMethodStatement(optionalKeyword?: Token) {
        const functionType = this.advance();
        const name = this.identifier(...AllowedProperties);
        const leftParen = this.consume(DiagnosticMessages.expectedToken(TokenKind.LeftParen), TokenKind.LeftParen);

        let params = [] as FunctionParameterExpression[];
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
        const rightParen = this.consumeToken(TokenKind.RightParen);
        // let asToken = null as Token;
        // let returnTypeExpression: TypeExpression;
        let asToken: Token;
        let returnTypeExpression: TypeExpression;
        if (this.check(TokenKind.As)) {
            [asToken, returnTypeExpression] = this.consumeAsTokenAndTypeExpression();
        }

        return new InterfaceMethodStatement({
            functionType: functionType,
            name: name,
            leftParen: leftParen,
            params: params,
            rightParen: rightParen,
            as: asToken,
            returnTypeExpression: returnTypeExpression,
            optional: optionalKeyword
        });
    }

    private interfaceDeclaration(): InterfaceStatement {
        this.warnIfNotBrighterScriptMode('interface declarations');

        const parentAnnotations = this.enterAnnotationBlock();

        const interfaceToken = this.consume(
            DiagnosticMessages.expectedKeyword(TokenKind.Interface),
            TokenKind.Interface
        );
        const nameToken = this.identifier(...this.allowedLocalIdentifiers);

        let extendsToken: Token;
        let parentInterfaceName: TypeExpression;

        if (this.peek().text.toLowerCase() === 'extends') {
            extendsToken = this.advance();
            if (this.checkEndOfStatement()) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedIdentifierAfterKeyword(extendsToken.text),
                    range: extendsToken.range
                });
            } else {
                parentInterfaceName = this.typeExpression();
            }
        }
        this.consumeStatementSeparators();
        //gather up all interface members (Fields, Methods)
        let body = [] as Statement[];
        while (this.checkAny(TokenKind.Comment, TokenKind.Identifier, TokenKind.At, ...AllowedProperties)) {
            try {
                //break out of this loop if we encountered the `EndInterface` token not followed by `as`
                if (this.check(TokenKind.EndInterface) && !this.checkNext(TokenKind.As)) {
                    break;
                }

                let decl: Statement;

                //collect leading annotations
                if (this.check(TokenKind.At)) {
                    this.annotationExpression();
                }
                const optionalKeyword = this.consumeTokenIf(TokenKind.Optional);
                //fields
                if (this.checkAny(TokenKind.Identifier, ...AllowedProperties) && this.checkAnyNext(TokenKind.As, TokenKind.Newline, TokenKind.Comment)) {
                    decl = this.interfaceFieldStatement(optionalKeyword);
                    //field with name = 'optional'
                } else if (optionalKeyword && this.checkAny(TokenKind.As, TokenKind.Newline, TokenKind.Comment)) {
                    //rewind one place, so that 'optional' is the field name
                    this.current--;
                    decl = this.interfaceFieldStatement();

                    //methods (function/sub keyword followed by opening paren)
                } else if (this.checkAny(TokenKind.Function, TokenKind.Sub) && this.checkAnyNext(TokenKind.Identifier, ...AllowedProperties)) {
                    decl = this.interfaceMethodStatement(optionalKeyword);

                }
                if (decl) {
                    this.consumePendingAnnotations(decl);
                    body.push(decl);
                } else {
                    //we didn't find a declaration...flag tokens until next line
                    this.flagUntil(TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
                }
            } catch (e) {
                //throw out any failed members and move on to the next line
                this.flagUntil(TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
            }

            //ensure statement separator
            this.consumeStatementSeparators();
        }

        //consume the final `end interface` token
        const endInterfaceToken = this.consumeToken(TokenKind.EndInterface);

        const statement = new InterfaceStatement({
            interface: interfaceToken,
            name: nameToken,
            extends: extendsToken,
            parentInterfaceName: parentInterfaceName,
            body: body,
            endInterface: endInterfaceToken
        });
        this.exitAnnotationBlock(parentAnnotations);
        return statement;
    }

    private enumDeclaration(): EnumStatement {
        const enumToken = this.consume(
            DiagnosticMessages.expectedKeyword(TokenKind.Enum),
            TokenKind.Enum
        );
        const nameToken = this.tryIdentifier(...this.allowedLocalIdentifiers);

        this.warnIfNotBrighterScriptMode('enum declarations');

        const parentAnnotations = this.enterAnnotationBlock();

        this.consumeStatementSeparators();

        const body: Array<EnumMemberStatement> = [];
        //gather up all members
        while (this.checkAny(TokenKind.Comment, TokenKind.Identifier, TokenKind.At, ...AllowedProperties)) {
            try {
                let decl: EnumMemberStatement;

                //collect leading annotations
                if (this.check(TokenKind.At)) {
                    this.annotationExpression();
                }

                //members
                if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {
                    decl = this.enumMemberStatement();
                }

                if (decl) {
                    this.consumePendingAnnotations(decl);
                    body.push(decl);
                } else {
                    //we didn't find a declaration...flag tokens until next line
                    this.flagUntil(TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
                }
            } catch (e) {
                //throw out any failed members and move on to the next line
                this.flagUntil(TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
            }

            //ensure statement separator
            this.consumeStatementSeparators();
            //break out of this loop if we encountered the `EndEnum` token
            if (this.check(TokenKind.EndEnum)) {
                break;
            }
        }

        //consume the final `end interface` token
        const endEnumToken = this.consumeToken(TokenKind.EndEnum);

        const result = new EnumStatement({
            enum: enumToken,
            name: nameToken,
            body: body,
            endEnum: endEnumToken
        });

        this.exitAnnotationBlock(parentAnnotations);
        return result;
    }

    /**
     * A BrighterScript class declaration
     */
    private classDeclaration(): ClassStatement {
        this.warnIfNotBrighterScriptMode('class declarations');

        const parentAnnotations = this.enterAnnotationBlock();

        let classKeyword = this.consume(
            DiagnosticMessages.expectedKeyword(TokenKind.Class),
            TokenKind.Class
        );
        let extendsKeyword: Token;
        let parentClassName: TypeExpression;

        //get the class name
        let className = this.tryConsume(DiagnosticMessages.expectedIdentifierAfterKeyword('class'), TokenKind.Identifier, ...this.allowedLocalIdentifiers) as Identifier;

        //see if the class inherits from parent
        if (this.peek().text.toLowerCase() === 'extends') {
            extendsKeyword = this.advance();
            if (this.checkEndOfStatement()) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedIdentifierAfterKeyword(extendsKeyword.text),
                    range: extendsKeyword.range
                });
            } else {
                parentClassName = this.typeExpression();
            }
        }

        //ensure statement separator
        this.consumeStatementSeparators();

        //gather up all class members (Fields, Methods)
        let body = [] as Statement[];
        while (this.checkAny(TokenKind.Public, TokenKind.Protected, TokenKind.Private, TokenKind.Function, TokenKind.Sub, TokenKind.Comment, TokenKind.Identifier, TokenKind.At, ...AllowedProperties)) {
            try {
                let decl: Statement;
                let accessModifier: Token;

                if (this.check(TokenKind.At)) {
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

                    //if we have an overrides keyword AND this method is called 'new', that's not allowed
                    if (overrideKeyword && funcDeclaration.tokens.name.text.toLowerCase() === 'new') {
                        this.diagnostics.push({
                            ...DiagnosticMessages.cannotUseOverrideKeywordOnConstructorFunction(),
                            range: overrideKeyword.range
                        });
                    }

                    decl = new MethodStatement({
                        modifiers: accessModifier,
                        name: funcDeclaration.tokens.name,
                        func: funcDeclaration.func,
                        override: overrideKeyword
                    });

                    //fields
                } else if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {

                    decl = this.fieldDeclaration(accessModifier);

                    //class fields cannot be overridden
                    if (overrideKeyword) {
                        this.diagnostics.push({
                            ...DiagnosticMessages.classFieldCannotBeOverridden(),
                            range: overrideKeyword.range
                        });
                    }

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

        const result = new ClassStatement({
            class: classKeyword,
            name: className,
            body: body,
            endClass: endingKeyword,
            extends: extendsKeyword,
            parentClassName: parentClassName
        });

        this.exitAnnotationBlock(parentAnnotations);
        return result;
    }

    private fieldDeclaration(accessModifier: Token | null) {

        let optionalKeyword = this.consumeTokenIf(TokenKind.Optional);

        if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {
            if (this.check(TokenKind.As)) {
                if (this.checkAnyNext(TokenKind.Comment, TokenKind.Newline)) {
                    // as <EOL>
                    // `as` is the field name
                } else if (this.checkNext(TokenKind.As)) {
                    //  as as ____
                    // first `as` is the field name
                } else if (optionalKeyword) {
                    // optional as ____
                    // optional is the field name, `as` starts type
                    // rewind current token
                    optionalKeyword = null;
                    this.current--;
                }
            }
        } else {
            // no name after `optional` ... optional is the name
            // rewind current token
            optionalKeyword = null;
            this.current--;
        }

        let name = this.consume(
            DiagnosticMessages.expectedClassFieldIdentifier(),
            TokenKind.Identifier,
            ...AllowedProperties
        ) as Identifier;

        let asToken: Token;
        let fieldTypeExpression: TypeExpression;
        //look for `as SOME_TYPE`
        if (this.check(TokenKind.As)) {
            [asToken, fieldTypeExpression] = this.consumeAsTokenAndTypeExpression();
        }

        let initialValue: Expression;
        let equal: Token;
        //if there is a field initializer
        if (this.check(TokenKind.Equal)) {
            equal = this.advance();
            initialValue = this.expression();
        }

        return new FieldStatement({
            accessModifier: accessModifier,
            name: name,
            as: asToken,
            typeExpression: fieldTypeExpression,
            equals: equal,
            initialValue: initialValue,
            optional: optionalKeyword
        });
    }

    /**
     * An array of CallExpression for the current function body
     */
    private callExpressions = [];

    private functionDeclaration(isAnonymous: true, checkIdentifier?: boolean, onlyCallableAsMember?: boolean): FunctionExpression;
    private functionDeclaration(isAnonymous: false, checkIdentifier?: boolean, onlyCallableAsMember?: boolean): FunctionStatement;
    private functionDeclaration(isAnonymous: boolean, checkIdentifier = true, onlyCallableAsMember = false) {
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
                    leadingWhitespace: '',
                    leadingTrivia: []
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
            let typeExpression: TypeExpression;
            if (!this.check(TokenKind.RightParen)) {
                do {
                    params.push(this.functionParameter());
                } while (this.match(TokenKind.Comma));
            }
            let rightParen = this.advance();

            if (this.check(TokenKind.As)) {
                [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();
            }

            params.reduce((haveFoundOptional: boolean, param: FunctionParameterExpression) => {
                if (haveFoundOptional && !param.defaultValue) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.requiredParameterMayNotFollowOptionalParameter(param.tokens.name.text),
                        range: param.range
                    });
                }

                return haveFoundOptional || !!param.defaultValue;
            }, false);

            this.consumeStatementSeparators(true);


            //support ending the function with `end sub` OR `end function`
            let body = this.block();
            //if the parser was unable to produce a block, make an empty one so the AST makes some sense...

            // consume 'end sub' or 'end function'
            const endFunctionType = this.advance();
            let expectedEndKind = isSub ? TokenKind.EndSub : TokenKind.EndFunction;

            //if `function` is ended with `end sub`, or `sub` is ended with `end function`, then
            //add an error but don't hard-fail so the AST can continue more gracefully
            if (endFunctionType.kind !== expectedEndKind) {
                this.diagnostics.push({
                    ...DiagnosticMessages.mismatchedEndCallableKeyword(functionTypeText, endFunctionType.text),
                    range: endFunctionType.range
                });
            }

            if (!body) {
                body = new Block({
                    statements: [],
                    startingRange: util.createBoundingRange(
                        functionType, name, leftParen, ...params, rightParen, asToken, typeExpression, endFunctionType)
                });
            }

            let func = new FunctionExpression({
                parameters: params,
                body: body,
                functionType: functionType,
                endFunctionType: endFunctionType,
                leftParen: leftParen,
                rightParen: rightParen,
                as: asToken,
                returnTypeExpression: typeExpression
            });

            if (isAnonymous) {
                return func;
            } else {
                let result = new FunctionStatement({ name: name, func: func });
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

        let typeExpression: TypeExpression;
        let defaultValue;
        let equalToken: Token;
        // parse argument default value
        if ((equalToken = this.consumeTokenIf(TokenKind.Equal))) {
            // it seems any expression is allowed here -- including ones that operate on other arguments!
            defaultValue = this.expression(false);
        }

        let asToken: Token = null;
        if (this.check(TokenKind.As)) {
            [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();

        }
        return new FunctionParameterExpression({
            name: name,
            equals: equalToken,
            defaultValue: defaultValue,
            as: asToken,
            typeExpression: typeExpression
        });
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
        let asToken: Token;
        let typeExpression: TypeExpression;

        //look for `as SOME_TYPE`
        if (this.check(TokenKind.As)) {
            this.warnIfNotBrighterScriptMode('typed assignment');

            [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();
        }

        let operator = this.consume(
            DiagnosticMessages.expectedOperatorAfterIdentifier(AssignmentOperators, name.text),
            ...AssignmentOperators
        );
        let value = this.expression();

        let result: AssignmentStatement;
        if (operator.kind === TokenKind.Equal) {
            result = new AssignmentStatement({ equals: operator, name: name, value: value, as: asToken, typeExpression: typeExpression });
        } else {
            const nameExpression = new VariableExpression({ name: name });
            result = new AssignmentStatement({
                equals: operator,
                name: name,
                value: new BinaryExpression({
                    left: nameExpression,
                    operator: operator,
                    right: value
                }),
                as: asToken,
                typeExpression: typeExpression
            });
        }

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

        if (this.check(TokenKind.Typecast) && this.checkAnyNext(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
            return this.typecastStatement();
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
        if (this.check(TokenKind.Dim)) {
            return this.dimStatement();
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

        //the continue keyword (followed by `for`, `while`, or a statement separator)
        if (this.check(TokenKind.Continue) && this.checkAnyNext(TokenKind.While, TokenKind.For, TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
            return this.continueStatement();
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
            this.checkAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers)
        ) {
            if (this.checkAnyNext(...AssignmentOperators)) {
                return this.assignment();
            } else if (this.checkNext(TokenKind.As)) {
                // may be a typed assignment
                const backtrack = this.current;
                let validTypeExpression = false;

                try {
                    // skip the identifier, and check for valid type expression
                    this.advance();
                    const parts = this.consumeAsTokenAndTypeExpression(true);
                    validTypeExpression = !!(parts?.[0] && parts?.[1]);
                } catch (e) {
                    // ignore any errors
                } finally {
                    this.current = backtrack;
                }
                if (validTypeExpression) {
                    // there is a valid 'as' and type expression
                    return this.assignment();
                }
            }
        }

        //some BrighterScript keywords are allowed as a local identifiers, so we need to check for them AFTER the assignment check
        if (this.check(TokenKind.Interface)) {
            return this.interfaceDeclaration();
        }

        if (this.check(TokenKind.Class)) {
            return this.classDeclaration();
        }

        if (this.check(TokenKind.Namespace)) {
            return this.namespaceStatement();
        }

        if (this.check(TokenKind.Enum)) {
            return this.enumDeclaration();
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

        return new WhileStatement({
            while: whileKeyword,
            endWhile: endWhile,
            condition: condition,
            body: whileBlock
        });
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
        return new ForStatement({
            for: forToken,
            counterDeclaration: initializer,
            to: toToken,
            finalValue: finalValue,
            body: body,
            endFor: endForToken,
            step: stepToken,
            increment: incrementExpression
        });
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
        maybeIn.kind = TokenKind.In;

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

        return new ForEachStatement({
            forEach: forEach,
            in: maybeIn,
            endFor: endFor,
            item: name,
            target: target,
            body: body
        });
    }

    private exitFor(): ExitForStatement {
        let keyword = this.advance();

        return new ExitForStatement({ exitFor: keyword });
    }

    private namespaceStatement(): NamespaceStatement | undefined {
        this.warnIfNotBrighterScriptMode('namespace');
        let keyword = this.advance();

        this.namespaceAndFunctionDepth++;

        let name = this.identifyingExpression();
        //set the current namespace name

        this.globalTerminators.push([TokenKind.EndNamespace]);
        let body = this.body();
        this.globalTerminators.pop();

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

        let result = new NamespaceStatement({
            namespace: keyword,
            nameExpression: name,
            body: body,
            endNamespace: endKeyword
        });

        //cache the range property so that plugins can't affect it
        result.cacheRange();
        result.body.symbolTable.name += `: namespace '${result.name}'`;
        return result;
    }

    /**
     * Get an expression with identifiers separated by periods. Useful for namespaces and class extends
     */
    private identifyingExpression(allowedTokenKinds?: TokenKind[]): DottedGetExpression | VariableExpression {
        allowedTokenKinds = allowedTokenKinds ?? this.allowedLocalIdentifiers;
        let firstIdentifier = this.consume(
            DiagnosticMessages.expectedIdentifierAfterKeyword(this.previous().text),
            TokenKind.Identifier,
            ...allowedTokenKinds
        ) as Identifier;

        let expr: DottedGetExpression | VariableExpression;

        if (firstIdentifier) {
            // force it into an identifier so the AST makes some sense
            firstIdentifier.kind = TokenKind.Identifier;
            const varExpr = new VariableExpression({ name: firstIdentifier });
            expr = varExpr;

            //consume multiple dot identifiers (i.e. `Name.Space.Can.Have.Many.Parts`)
            while (this.check(TokenKind.Dot)) {
                let dot = this.tryConsume(
                    DiagnosticMessages.unexpectedToken(this.peek().text),
                    TokenKind.Dot
                );
                if (!dot) {
                    break;
                }
                let identifier = this.tryConsume(
                    DiagnosticMessages.expectedIdentifier(),
                    TokenKind.Identifier,
                    ...allowedTokenKinds,
                    ...AllowedProperties
                ) as Identifier;

                if (!identifier) {
                    break;
                }
                // force it into an identifier so the AST makes some sense
                identifier.kind = TokenKind.Identifier;
                expr = new DottedGetExpression({ obj: expr, name: identifier, dot: dot });
            }
        }
        return expr;
    }
    /**
     * Add an 'unexpected token' diagnostic for any token found between current and the first stopToken found.
     */
    private flagUntil(...stopTokens: TokenKind[]) {
        while (!this.checkAny(...stopTokens) && !this.isAtEnd()) {
            let token = this.advance();
            this.diagnostics.push({
                ...DiagnosticMessages.unexpectedToken(token.text),
                range: token.range
            });
        }
    }

    /**
     * Consume tokens until one of the `stopTokenKinds` is encountered
     * @param stopTokenKinds a list of tokenKinds where any tokenKind in this list will result in a match
     * @returns - the list of tokens consumed, EXCLUDING the `stopTokenKind` (you can use `this.peek()` to see which one it was)
     */
    private consumeUntil(...stopTokenKinds: TokenKind[]) {
        let result = [] as Token[];
        //take tokens until we encounter one of the stopTokenKinds
        while (!stopTokenKinds.includes(this.peek().kind)) {
            result.push(this.advance());
        }
        return result;
    }

    private constDeclaration(): ConstStatement | undefined {
        this.warnIfNotBrighterScriptMode('const declaration');
        const constToken = this.advance();
        const nameToken = this.identifier(...this.allowedLocalIdentifiers);
        const equalToken = this.consumeToken(TokenKind.Equal);
        const expression = this.expression();
        const statement = new ConstStatement({
            const: constToken,
            name: nameToken,
            equals: equalToken,
            value: expression
        });
        return statement;
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

        return libStatement;
    }

    private importStatement() {
        this.warnIfNotBrighterScriptMode('import statements');
        let importStatement = new ImportStatement({
            import: this.advance(),
            //grab the next token only if it's a string
            path: this.tryConsume(
                DiagnosticMessages.expectedStringLiteralAfterKeyword('import'),
                TokenKind.StringLiteral
            )
        });

        return importStatement;
    }

    private typecastStatement() {
        this.warnIfNotBrighterScriptMode('typecast statements');
        const typecastToken = this.advance();
        const typecastExpr = this.expression();
        if (isTypecastExpression(typecastExpr)) {
            return new TypecastStatement({
                typecast: typecastToken,
                typecastExpression: typecastExpr
            });
        }
        this.diagnostics.push({
            ...DiagnosticMessages.expectedIdentifierAfterKeyword('typecast'),
            range: util.getRange(typecastToken, this.peek())
        });
        throw this.lastDiagnosticAsError();
    }

    private annotationExpression() {
        const atToken = this.advance();
        const identifier = this.tryConsume(DiagnosticMessages.expectedIdentifier(), TokenKind.Identifier, ...AllowedProperties);
        if (identifier) {
            identifier.kind = TokenKind.Identifier;
        }
        let annotation = new AnnotationExpression({ at: atToken, name: identifier });
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

        let consequent: Expression;
        try {
            consequent = this.expression();
        } catch { }

        //consume newlines or comments
        while (this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            this.advance();
        }

        const colonToken = this.tryConsumeToken(TokenKind.Colon);

        //consume newlines
        while (this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            this.advance();
        }
        let alternate: Expression;
        try {
            alternate = this.expression();
        } catch { }

        return new TernaryExpression({
            test: test,
            questionMark: questionMarkToken,
            consequent: consequent,
            colon: colonToken,
            alternate: alternate
        });
    }

    private nullCoalescingExpression(test: Expression): NullCoalescingExpression {
        this.warnIfNotBrighterScriptMode('null coalescing operator');
        const questionQuestionToken = this.advance();
        const alternate = this.expression();
        return new NullCoalescingExpression({
            consequent: test,
            questionQuestion: questionQuestionToken,
            alternate: alternate
        });
    }

    private regexLiteralExpression() {
        this.warnIfNotBrighterScriptMode('regular expression literal');
        return new RegexLiteralExpression({
            regexLiteral: this.advance()
        });
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
                    new LiteralExpression({ value: next })
                );
                this.advance();
            } else if (next.kind === TokenKind.EscapedCharCodeLiteral) {
                currentQuasiExpressionParts.push(
                    new EscapedCharCodeLiteralExpression({ value: next as Token & { charCode: number } })
                );
                this.advance();
            } else {
                //finish up the current quasi
                quasis.push(
                    new TemplateStringQuasiExpression({ expressions: currentQuasiExpressionParts })
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
            new TemplateStringQuasiExpression({ expressions: currentQuasiExpressionParts })
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
                return new TaggedTemplateStringExpression({
                    tagName: tagName,
                    openingBacktick: openingBacktick,
                    quasis: quasis,
                    expressions: expressions,
                    closingBacktick: closingBacktick
                });
            } else {
                return new TemplateStringExpression({
                    openingBacktick: openingBacktick,
                    quasis: quasis,
                    expressions: expressions,
                    closingBacktick: closingBacktick
                });
            }
        }
    }

    private tryCatchStatement(): TryCatchStatement {
        const tryToken = this.advance();
        let endTryToken: Token;
        let catchStmt: CatchStatement;
        //ensure statement separator
        this.consumeStatementSeparators();

        let tryBranch = this.block(TokenKind.Catch, TokenKind.EndTry);

        const peek = this.peek();
        if (peek.kind !== TokenKind.Catch) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedCatchBlockInTryCatch(),
                range: this.peek().range
            });
        } else {
            const catchToken = this.advance();
            const exceptionVarToken = this.tryConsume(DiagnosticMessages.missingExceptionVarToFollowCatch(), TokenKind.Identifier, ...this.allowedLocalIdentifiers) as Identifier;
            if (exceptionVarToken) {
                // force it into an identifier so the AST makes some sense
                exceptionVarToken.kind = TokenKind.Identifier;
            }
            //ensure statement sepatator
            this.consumeStatementSeparators();
            const catchBranch = this.block(TokenKind.EndTry);
            catchStmt = new CatchStatement({
                catch: catchToken,
                exceptionVariable: exceptionVarToken,
                catchBranch: catchBranch
            });
        }
        if (this.peek().kind !== TokenKind.EndTry) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndTryToTerminateTryCatch(),
                range: this.peek().range
            });
        } else {
            endTryToken = this.advance();
        }

        const statement = new TryCatchStatement({
            try: tryToken,
            tryBranch: tryBranch,
            catchStatement: catchStmt,
            endTry: endTryToken
        }
        );
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
        return new ThrowStatement({ throw: throwToken, expression: expression });
    }

    private dimStatement() {
        const dim = this.advance();

        let identifier = this.tryConsume(DiagnosticMessages.expectedIdentifierAfterKeyword('dim'), TokenKind.Identifier, ...this.allowedLocalIdentifiers) as Identifier;
        // force to an identifier so the AST makes some sense
        if (identifier) {
            identifier.kind = TokenKind.Identifier;
        }

        let leftSquareBracket = this.tryConsume(DiagnosticMessages.missingLeftSquareBracketAfterDimIdentifier(), TokenKind.LeftSquareBracket);

        let expressions: Expression[] = [];
        let expression: Expression;
        do {
            try {
                expression = this.expression();
                expressions.push(expression);
                if (this.check(TokenKind.Comma)) {
                    this.advance();
                } else {
                    // will also exit for right square braces
                    break;
                }
            } catch (error) {
            }
        } while (expression);

        if (expressions.length === 0) {
            this.diagnostics.push({
                ...DiagnosticMessages.missingExpressionsInDimStatement(),
                range: this.peek().range
            });
        }
        let rightSquareBracket = this.tryConsume(DiagnosticMessages.missingRightSquareBracketAfterDimIdentifier(), TokenKind.RightSquareBracket);
        return new DimStatement({
            dim: dim,
            name: identifier,
            openingSquare: leftSquareBracket,
            dimensions: expressions,
            closingSquare: rightSquareBracket
        });
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

        return new IfStatement({
            if: ifToken,
            then: thenToken,
            endIf: endIfToken,
            else: elseToken,
            condition: condition,
            thenBranch: thenBranch,
            elseBranch: elseBranch,
            isInline: isInlineIfThen
        });
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

    private conditionalCompileStatement(unsafeTerminators: TokenKind[] = []): ConditionalCompileStatement {

        const hashIfToken = this.advance();
        const startingRange = hashIfToken.range;

        const condition = this.advance();
        let thenBranch: Block;
        let elseBranch: ConditionalCompileStatement | Block | undefined;

        let hashEndIfToken: Token | undefined;
        let hashElseToken: Token | undefined;

        thenBranch = this.blockConditionalCompileBranch(hashIfToken);

        const ensureNewLine = () => {
            //ensure newline before next keyword
            if (this.checkPrevious(TokenKind.Newline)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedNewlineInConditionalCompile(),
                    range: this.peek().range
                });
                throw this.lastDiagnosticAsError();
            }
        };

        ensureNewLine();
        this.advance();

        //else branch
        if (this.check(TokenKind.HashElseIf)) {
            // recurse-read `#else if`
            elseBranch = this.conditionalCompileStatement();
            ensureNewLine();

        } else if (this.check(TokenKind.HashElse)) {
            hashElseToken = this.advance();
            elseBranch = this.blockConditionalCompileBranch(hashIfToken);
            ensureNewLine();
            this.advance();
        }

        if (!isConditionalCompileStatement(elseBranch)) {

            if (this.check(TokenKind.HashEndIf)) {
                hashEndIfToken = this.advance();

            } else {
                //missing #endif
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedHashEndIfToCloseHashIf(startingRange.start.line),
                    range: hashIfToken.range
                });
            }
        }

        return new ConditionalCompileStatement({
            hashIf: hashIfToken,
            hashElse: hashElseToken,
            hashEndIf: hashEndIfToken,
            condition: condition,
            thenBranch: thenBranch,
            elseBranch: elseBranch
        });
    }

    //consume a conditional compile branch block of an `#if` statement
    private blockConditionalCompileBranch(hashIfToken: Token) {
        //keep track of the current error count, because if the then branch fails,
        //we will trash them in favor of a single error on if
        let diagnosticsLengthBeforeBlock = this.diagnostics.length;

        //parsing until trailing "#end if", "#else", "#else if"
        let branch = this.conditionalCompileBlock();

        if (!branch) {
            //throw out any new diagnostics created as a result of a `then` block parse failure.
            //the block() function will discard the current line, so any discarded diagnostics will
            //resurface if they are legitimate, and not a result of a malformed if statement
            this.diagnostics.splice(diagnosticsLengthBeforeBlock, this.diagnostics.length - diagnosticsLengthBeforeBlock);

            //this whole if statement is bogus...add error to the if token and hard-fail
            this.diagnostics.push({
                ...DiagnosticMessages.expectedTerminatorOnConditionalCompileBlock(),
                range: hashIfToken.range
            });
            throw this.lastDiagnosticAsError();
        }
        return branch;
    }

    /**
     * Parses a block, looking for a specific terminating TokenKind to denote completion.
     * Always looks for `#end if` or `#else`
     */
    private conditionalCompileBlock(): Block | undefined {
        const parentAnnotations = this.enterAnnotationBlock();

        this.consumeStatementSeparators(true);
        let startingToken = this.peek();
        const unsafeTerminators = BlockTerminators;
        const conditionalEndTokens = [TokenKind.HashElse, TokenKind.HashElseIf, TokenKind.HashEndIf];
        const terminators = [...conditionalEndTokens, ...unsafeTerminators];
        this.globalTerminators.push(conditionalEndTokens);
        const statements: Statement[] = [];
        while (!this.isAtEnd() && !this.checkAny(...terminators)) {
            //grab the location of the current token
            let loopCurrent = this.current;
            let dec = this.declaration();
            if (dec) {
                if (!isAnnotationExpression(dec)) {
                    this.consumePendingAnnotations(dec);
                    statements.push(dec);
                }

                const peekKind = this.peek().kind;
                if (conditionalEndTokens.includes(peekKind)) {
                    // current conditional compile branch was closed by other statement, rewind to preceding newline
                    this.current--;
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
        this.globalTerminators.pop();


        if (this.isAtEnd()) {
            return undefined;
            // TODO: Figure out how to handle unterminated blocks well
        } else {
            //did we  hit an unsafe terminator?
            //if so, we need to restore the statement separator
            let prev = this.previous();
            let prevKind = prev.kind;
            let peek = this.peek();
            let peekKind = this.peek().kind;
            if (
                (peekKind === TokenKind.HashEndIf || peekKind === TokenKind.HashElse || peekKind === TokenKind.HashElseIf) &&
                (prevKind === TokenKind.Newline)
            ) {
                this.current--;
            } else if (unsafeTerminators.includes(peekKind) &&
                (prevKind === TokenKind.Newline || prevKind === TokenKind.Colon)
            ) {
                this.diagnostics.push({
                    ...DiagnosticMessages.unsafeUnmatchedTerminatorInConditionalCompileBlock(peek.text),
                    range: peek.range
                });
                throw this.lastDiagnosticAsError();
            } else {
                return undefined;
            }
        }
        this.exitAnnotationBlock(parentAnnotations);
        return new Block({ statements: statements, startingRange: startingToken.range });
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
        const startingRange = statement.range;

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
                    ...DiagnosticMessages.unexpectedToken(colon.text),
                    range: colon.range
                });
            }
        }
        return new Block({ statements: statements, startingRange: startingRange });
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

            const result = new IncrementStatement({ value: expr, operator: operator });
            return result;
        }

        if (isCallExpression(expr) || isCallfuncExpression(expr)) {
            return new ExpressionStatement({ expression: expr });
        }

        //at this point, it's probably an error. However, we recover a little more gracefully by creating an inclosing ExpressionStatement
        this.diagnostics.push({
            ...DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression(),
            range: expressionStart.range
        });
        return new ExpressionStatement({ expression: expr });
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
                return new IndexedSetStatement({
                    obj: left.obj,
                    indexes: left.indexes,
                    value: operator.kind === TokenKind.Equal
                        ? right
                        : new BinaryExpression({ left: left, operator: operator, right: right }),
                    openingSquare: left.tokens.openingSquare,
                    closingSquare: left.tokens.closingSquare
                });
            } else if (isDottedGetExpression(left)) {
                return new DottedSetStatement({
                    obj: left.obj,
                    name: left.tokens.name,
                    value: operator.kind === TokenKind.Equal
                        ? right
                        : new BinaryExpression({ left: left, operator: operator, right: right }),
                    dot: left.tokens.dot
                });
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
            } else if (this.check(TokenKind.Else)) {
                break; // inline branch
            } else {
                values.push(this.expression());
            }
        }

        //print statements can be empty, so look for empty print conditions
        if (!values.length) {
            const endOfStatementRange = util.createRangeFromPositions(printKeyword.range.end, this.peek()?.range.end);
            let emptyStringLiteral = createStringLiteral('', endOfStatementRange);
            values.push(emptyStringLiteral);
        }

        let last = values[values.length - 1];
        if (isToken(last)) {
            // TODO: error, expected value
        }

        return new PrintStatement({ print: printKeyword, expressions: values });
    }

    /**
     * Parses a return statement with an optional return value.
     * @returns an AST representation of a return statement.
     */
    private returnStatement(): ReturnStatement {
        let options = { return: this.previous() };

        if (this.checkEndOfStatement()) {
            return new ReturnStatement(options);
        }

        let toReturn = this.check(TokenKind.Else) ? undefined : this.expression();
        return new ReturnStatement({ ...options, value: toReturn });
    }

    /**
     * Parses a `label` statement
     * @returns an AST representation of an `label` statement.
     */
    private labelStatement() {
        let options = {
            name: this.advance(),
            colon: this.advance()
        };

        //label must be alone on its line, this is probably not a label
        if (!this.checkAny(TokenKind.Newline, TokenKind.Comment)) {
            //rewind and cancel
            this.current -= 2;
            throw new CancelStatementError();
        }

        return new LabelStatement(options);
    }

    /**
     * Parses a `continue` statement
     */
    private continueStatement() {
        return new ContinueStatement({
            continue: this.advance(),
            loopType: this.tryConsume(
                DiagnosticMessages.expectedToken(TokenKind.While, TokenKind.For),
                TokenKind.While, TokenKind.For
            )
        });
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
        let options = { end: this.advance() };

        return new EndStatement(options);
    }
    /**
     * Parses a `stop` statement
     * @returns an AST representation of a `stop` statement
     */
    private stopStatement() {
        let options = { stop: this.advance() };

        return new StopStatement(options);
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
        const flatGlobalTerminators = this.globalTerminators.flat().flat();
        while (!this.isAtEnd() && !this.checkAny(TokenKind.EndSub, TokenKind.EndFunction, ...terminators, ...flatGlobalTerminators)) {
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
        return new Block({ statements: statements, startingRange: startingToken.range });
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

    private expression(findTypecast = true): Expression {
        let expression = this.anonymousFunction();
        let asToken: Token;
        let typeExpression: TypeExpression;
        if (findTypecast) {
            do {
                if (this.check(TokenKind.As)) {
                    this.warnIfNotBrighterScriptMode('type cast');
                    // Check if this expression is wrapped in any type casts
                    // allows for multiple casts:
                    // myVal = foo() as dynamic as string
                    [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();
                    if (asToken && typeExpression) {
                        expression = new TypecastExpression({ obj: expression, as: asToken, typeExpression: typeExpression });
                    }
                } else {
                    break;
                }

            } while (asToken && typeExpression);
        }
        return expression;
    }

    private anonymousFunction(): Expression {
        if (this.checkAny(TokenKind.Sub, TokenKind.Function)) {
            const func = this.functionDeclaration(true);
            //if there's an open paren after this, this is an IIFE
            if (this.check(TokenKind.LeftParen)) {
                return this.finishCall(this.advance(), func);
            } else {
                return func;
            }
        }

        let expr = this.boolean();

        if (this.check(TokenKind.Question)) {
            return this.ternaryExpression(expr);
        } else if (this.check(TokenKind.QuestionQuestion)) {
            return this.nullCoalescingExpression(expr);
        } else {
            return expr;
        }
    }

    private boolean(): Expression {
        let expr = this.relational();

        while (this.matchAny(TokenKind.And, TokenKind.Or)) {
            let operator = this.previous();
            let right = this.relational();
            expr = new BinaryExpression({ left: expr, operator: operator, right: right });
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
            expr = new BinaryExpression({ left: expr, operator: operator, right: right });
        }

        return expr;
    }

    // TODO: bitshift

    private additive(): Expression {
        let expr = this.multiplicative();

        while (this.matchAny(TokenKind.Plus, TokenKind.Minus)) {
            let operator = this.previous();
            let right = this.multiplicative();
            expr = new BinaryExpression({ left: expr, operator: operator, right: right });
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
            expr = new BinaryExpression({ left: expr, operator: operator, right: right });
        }

        return expr;
    }

    private exponential(): Expression {
        let expr = this.prefixUnary();

        while (this.match(TokenKind.Caret)) {
            let operator = this.previous();
            let right = this.prefixUnary();
            expr = new BinaryExpression({ left: expr, operator: operator, right: right });
        }

        return expr;
    }

    private prefixUnary(): Expression {
        const nextKind = this.peek().kind;
        if (nextKind === TokenKind.Not) {
            this.current++; //advance
            let operator = this.previous();
            let right = this.relational();
            return new UnaryExpression({ operator: operator, right: right });
        } else if (nextKind === TokenKind.Minus || nextKind === TokenKind.Plus) {
            this.current++; //advance
            let operator = this.previous();
            let right = (nextKind as any) === TokenKind.Not
                ? this.boolean()
                : this.prefixUnary();
            return new UnaryExpression({ operator: operator, right: right });
        }
        return this.call();
    }

    private indexedGet(expr: Expression) {
        let openingSquare = this.previous();
        let questionDotToken = this.getMatchingTokenAtOffset(-2, TokenKind.QuestionDot);
        let indexes: Expression[] = [];


        //consume leading newlines
        while (this.match(TokenKind.Newline)) { }

        try {
            indexes.push(
                this.expression()
            );
            //consume additional indexes separated by commas
            while (this.check(TokenKind.Comma)) {
                //discard the comma
                this.advance();
                indexes.push(
                    this.expression()
                );
            }
        } catch (error) {
            this.rethrowNonDiagnosticError(error);
        }
        //consume trailing newlines
        while (this.match(TokenKind.Newline)) { }

        const closingSquare = this.tryConsume(
            DiagnosticMessages.expectedRightSquareBraceAfterArrayOrObjectIndex(),
            TokenKind.RightSquareBracket
        );

        return new IndexedGetExpression({
            obj: expr,
            indexes: indexes,
            openingSquare: openingSquare,
            closingSquare: closingSquare,
            questionDot: questionDotToken
        });
    }

    private newExpression() {
        this.warnIfNotBrighterScriptMode(`using 'new' keyword to construct a class`);
        let newToken = this.advance();

        let nameExpr = this.identifyingExpression();
        let leftParen = this.tryConsume(
            DiagnosticMessages.unexpectedToken(this.peek().text),
            TokenKind.LeftParen,
            TokenKind.QuestionLeftParen
        );

        if (!leftParen) {
            // new expression without a following call expression
            // wrap the name in an expression
            const endOfStatementRange = util.createRangeFromPositions(newToken.range.end, this.peek()?.range.end);
            const exprStmt = nameExpr ?? createStringLiteral('', endOfStatementRange);
            return new ExpressionStatement({ expression: exprStmt });
        }

        let call = this.finishCall(leftParen, nameExpr);
        //pop the call from the  callExpressions list because this is technically something else
        this.callExpressions.pop();
        let result = new NewExpression({ new: newToken, call: call });
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

        return new CallfuncExpression({
            callee: callee,
            operator: operator,
            methodName: methodName as Identifier,
            openingParen: openParen,
            args: call.args,
            closingParen: call.tokens.closingParen
        });
    }

    private call(): Expression {
        if (this.check(TokenKind.New) && this.checkAnyNext(TokenKind.Identifier, ...this.allowedLocalIdentifiers)) {
            return this.newExpression();
        }
        let expr = this.primary();

        while (true) {
            if (this.matchAny(TokenKind.LeftParen, TokenKind.QuestionLeftParen)) {
                expr = this.finishCall(this.previous(), expr);
            } else if (this.matchAny(TokenKind.LeftSquareBracket, TokenKind.QuestionLeftSquare) || this.matchSequence(TokenKind.QuestionDot, TokenKind.LeftSquareBracket)) {
                expr = this.indexedGet(expr);
            } else if (this.match(TokenKind.Callfunc)) {
                expr = this.callfunc(expr);
            } else if (this.matchAny(TokenKind.Dot, TokenKind.QuestionDot)) {
                if (this.match(TokenKind.LeftSquareBracket)) {
                    expr = this.indexedGet(expr);
                } else {
                    let dot = this.previous();
                    let name = this.tryConsume(
                        DiagnosticMessages.expectedPropertyNameAfterPeriod(),
                        TokenKind.Identifier,
                        ...AllowedProperties
                    );
                    if (!name) {
                        break;
                    }

                    // force it into an identifier so the AST makes some sense
                    name.kind = TokenKind.Identifier;
                    expr = new DottedGetExpression({ obj: expr, name: name as Identifier, dot: dot });
                }

            } else if (this.checkAny(TokenKind.At, TokenKind.QuestionAt)) {
                let dot = this.advance();
                let name = this.tryConsume(
                    DiagnosticMessages.expectedAttributeNameAfterAtSymbol(),
                    TokenKind.Identifier,
                    ...AllowedProperties
                );

                // force it into an identifier so the AST makes some sense
                name.kind = TokenKind.Identifier;
                if (!name) {
                    break;
                }
                expr = new XmlAttributeGetExpression({ obj: expr, name: name as Identifier, at: dot });
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
        while (this.match(TokenKind.Newline)) { }

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
                try {
                    args.push(this.expression());
                } catch (error) {
                    this.rethrowNonDiagnosticError(error);
                    // we were unable to get an expression, so don't continue
                    break;
                }
            } while (this.match(TokenKind.Comma));
        }

        while (this.match(TokenKind.Newline)) { }

        const closingParen = this.tryConsume(
            DiagnosticMessages.expectedRightParenAfterFunctionCallArguments(),
            TokenKind.RightParen
        );

        let expression = new CallExpression({
            callee: callee,
            openingParen: openingParen,
            args: args,
            closingParen: closingParen
        });
        if (addToCallExpressionList) {
            this.callExpressions.push(expression);
        }
        return expression;
    }

    /**
     * Creates a TypeExpression, which wraps standard ASTNodes that represent a BscType
     */
    private typeExpression(): TypeExpression {
        const changedTokens: { token: Token; oldKind: TokenKind }[] = [];
        try {
            let expr: Expression = this.getTypeExpressionPart(changedTokens);
            while (this.options.mode === ParseMode.BrighterScript && this.matchAny(TokenKind.Or)) {
                // If we're in Brighterscript mode, allow union types with "or" between types
                // TODO: Handle Union types in parens? eg. "(string or integer)"
                let operator = this.previous();
                let right = this.getTypeExpressionPart(changedTokens);
                if (right) {
                    expr = new BinaryExpression({ left: expr, operator: operator, right: right });
                } else {
                    break;
                }
            }
            if (expr) {
                return new TypeExpression({ expression: expr });
            }

        } catch (error) {
            // Something went wrong - reset the kind to what it was previously
            for (const changedToken of changedTokens) {
                changedToken.token.kind = changedToken.oldKind;
            }
            throw error;
        }
    }

    /**
     * Gets a single "part" of a type of a potential Union type
     * Note: this does not NEED to be part of a union type, but the logic is the same
     *
     * @param changedTokens an array that is modified with any tokens that have been changed from their default kind to identifiers - eg. when a keyword is used as type
     * @returns an expression that was successfully parsed
     */
    private getTypeExpressionPart(changedTokens: { token: Token; oldKind: TokenKind }[]) {
        let expr: VariableExpression | DottedGetExpression | TypedArrayExpression;
        if (this.checkAny(...DeclarableTypes)) {
            // if this is just a type, just use directly
            expr = new VariableExpression({ name: this.advance() as Identifier });
        } else {
            if (this.checkAny(...AllowedTypeIdentifiers)) {
                // Since the next token is allowed as a type identifier, change the kind
                let nextToken = this.peek();
                changedTokens.push({ token: nextToken, oldKind: nextToken.kind });
                nextToken.kind = TokenKind.Identifier;
            }
            expr = this.identifyingExpression(AllowedTypeIdentifiers);
        }

        //Check if it has square brackets, thus making it an array
        if (expr && this.check(TokenKind.LeftSquareBracket)) {
            if (this.options.mode === ParseMode.BrightScript) {
                // typed arrays not allowed in Brightscript
                this.warnIfNotBrighterScriptMode('typed arrays');
                return expr;
            }

            // Check if it is an array - that is, if it has `[]` after the type
            // eg. `string[]` or `SomeKlass[]`
            // This is while loop, so it supports multidimensional arrays (eg. integer[][])
            while (this.check(TokenKind.LeftSquareBracket)) {
                const leftBracket = this.advance();
                if (this.check(TokenKind.RightSquareBracket)) {
                    const rightBracket = this.advance();
                    expr = new TypedArrayExpression({ innerType: expr, leftBracket: leftBracket, rightBracket: rightBracket });
                }
            }
        }

        return expr;
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
                return new LiteralExpression({ value: this.previous() });

            //capture source literals (LINE_NUM if brightscript, or a bunch of them if brighterscript)
            case this.matchAny(TokenKind.LineNumLiteral, ...(this.options.mode === ParseMode.BrightScript ? [] : BrighterScriptSourceLiterals)):
                return new SourceLiteralExpression({ value: this.previous() });

            //template string
            case this.check(TokenKind.BackTick):
                return this.templateString(false);

            //tagged template string (currently we do not support spaces between the identifier and the backtick)
            case this.checkAny(TokenKind.Identifier, ...AllowedLocalIdentifiers) && this.checkNext(TokenKind.BackTick):
                return this.templateString(true);

            case this.matchAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers):
                return new VariableExpression({ name: this.previous() as Identifier });

            case this.match(TokenKind.LeftParen):
                let left = this.previous();
                let expr = this.expression();
                let right = this.consume(
                    DiagnosticMessages.unmatchedLeftParenAfterExpression(),
                    TokenKind.RightParen
                );
                return new GroupingExpression({ leftParen: left, rightParen: right, expression: expr });

            case this.matchAny(TokenKind.LeftSquareBracket):
                return this.arrayLiteral();

            case this.match(TokenKind.LeftCurlyBrace):
                return this.aaLiteral();

            case this.matchAny(TokenKind.Pos, TokenKind.Tab):
                let token = Object.assign(this.previous(), {
                    kind: TokenKind.Identifier
                }) as Identifier;
                return new VariableExpression({ name: token });

            case this.checkAny(TokenKind.Function, TokenKind.Sub):
                return this.anonymousFunction();

            case this.check(TokenKind.RegexLiteral):
                return this.regexLiteralExpression();

            default:
                //if we found an expected terminator, don't throw a diagnostic...just return undefined
                if (this.checkAny(...this.peekGlobalTerminators())) {
                    //don't throw a diagnostic, just return undefined

                    //something went wrong...throw an error so the upstream processor can scrap this line and move on
                } else {
                    this.diagnostics.push({
                        ...DiagnosticMessages.unexpectedToken(this.peek().text),
                        range: this.peek().range
                    });
                    throw this.lastDiagnosticAsError();
                }
        }
    }

    private arrayLiteral() {
        let elements: Array<Expression> = [];
        let openingSquare = this.previous();

        while (this.match(TokenKind.Newline)) {
        }
        let closingSquare: Token;

        if (!this.match(TokenKind.RightSquareBracket)) {
            try {
                elements.push(this.expression());

                while (this.matchAny(TokenKind.Comma, TokenKind.Newline, TokenKind.Comment)) {

                    while (this.match(TokenKind.Newline)) {

                    }

                    if (this.check(TokenKind.RightSquareBracket)) {
                        break;
                    }

                    elements.push(this.expression());
                }
            } catch (error: any) {
                this.rethrowNonDiagnosticError(error);
            }

            closingSquare = this.tryConsume(
                DiagnosticMessages.unmatchedLeftSquareBraceAfterArrayLiteral(),
                TokenKind.RightSquareBracket
            );
        } else {
            closingSquare = this.previous();
        }

        //this.consume("Expected newline or ':' after array literal", TokenKind.Newline, TokenKind.Colon, TokenKind.Eof);
        return new ArrayLiteralExpression({ elements: elements, open: openingSquare, close: closingSquare });
    }

    private aaLiteral() {
        let openingBrace = this.previous();
        let members: Array<AAMemberExpression> = [];

        let key = () => {
            let result = {
                colonToken: null as Token,
                keyToken: null as Token,
                range: null as Range
            };
            if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {
                result.keyToken = this.identifier(...AllowedProperties);
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

        while (this.match(TokenKind.Newline)) { }
        let closingBrace: Token;
        if (!this.match(TokenKind.RightCurlyBrace)) {
            let lastAAMember: AAMemberExpression;
            try {
                let k = key();
                let expr = this.expression();
                lastAAMember = new AAMemberExpression({
                    key: k.keyToken,
                    colon: k.colonToken,
                    value: expr
                });
                members.push(lastAAMember);

                while (this.matchAny(TokenKind.Comma, TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
                    // collect comma at end of expression
                    if (lastAAMember && this.checkPrevious(TokenKind.Comma)) {
                        (lastAAMember as DeepWriteable<AAMemberExpression>).tokens.comma = this.previous();
                    }

                    this.consumeStatementSeparators(true);

                    if (this.check(TokenKind.RightCurlyBrace)) {
                        break;
                    }
                    let k = key();
                    let expr = this.expression();
                    lastAAMember = new AAMemberExpression({
                        key: k.keyToken,
                        colon: k.colonToken,
                        value: expr
                    });
                    members.push(lastAAMember);

                }
            } catch (error: any) {
                this.rethrowNonDiagnosticError(error);
            }

            closingBrace = this.tryConsume(
                DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral(),
                TokenKind.RightCurlyBrace
            );
        } else {
            closingBrace = this.previous();
        }

        const aaExpr = new AALiteralExpression({ elements: members, open: openingBrace, close: closingBrace });
        return aaExpr;
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
     * @param tokenKinds a list of tokenKinds where any tokenKind in this list will result in a match
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
     * If the next series of tokens matches the given set of tokens, pop them all
     * @param tokenKinds a list of tokenKinds used to match the next set of tokens
     */
    private matchSequence(...tokenKinds: TokenKind[]) {
        const endIndex = this.current + tokenKinds.length;
        for (let i = 0; i < tokenKinds.length; i++) {
            if (tokenKinds[i] !== this.tokens[this.current + i]?.kind) {
                return false;
            }
        }
        this.current = endIndex;
        return true;
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
     * Consume next token IF it matches the specified kind. Otherwise, do nothing and return undefined
     */
    private consumeTokenIf(tokenKind: TokenKind) {
        if (this.match(tokenKind)) {
            return this.previous();
        }
    }

    private consumeToken(tokenKind: TokenKind) {
        return this.consume(
            DiagnosticMessages.expectedToken(tokenKind),
            tokenKind
        );
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

    private tryConsumeToken(tokenKind: TokenKind) {
        return this.tryConsume(
            DiagnosticMessages.expectedToken(tokenKind),
            tokenKind
        );
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

    /**
     * Check that the next token kind is the expected kind
     * @param tokenKind the expected next kind
     * @returns true if the next tokenKind is the expected value
     */
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
        const peekToken = this.peek();
        return !peekToken || peekToken.kind === TokenKind.Eof;
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

    /**
     * Sometimes we catch an error that is a diagnostic.
     * If that's the case, we want to continue parsing.
     * Otherwise, re-throw the error
     *
     * @param error error caught in a try/catch
     */
    private rethrowNonDiagnosticError(error) {
        if (!error.isDiagnostic) {
            throw error;
        }
    }

    /**
     * Get the token that is {offset} indexes away from {this.current}
     * @param offset the number of index steps away from current index to fetch
     * @param tokenKinds the desired token must match one of these
     * @example
     * getToken(-1); //returns the previous token.
     * getToken(0);  //returns current token.
     * getToken(1);  //returns next token
     */
    private getMatchingTokenAtOffset(offset: number, ...tokenKinds: TokenKind[]): Token {
        const token = this.tokens[this.current + offset];
        if (tokenKinds.includes(token.kind)) {
            return token;
        }
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
    mode?: ParseMode;
    /**
     * A logger that should be used for logging. If omitted, a default logger is used
     */
    logger?: Logger;
    /**
     * Should locations be tracked. If false, the `range` property will be omitted
     * @default true
     */
    trackLocations?: boolean;
}


class CancelStatementError extends Error {
    constructor() {
        super('CancelStatement');
    }
}
