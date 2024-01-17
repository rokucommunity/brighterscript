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
    TokenKind
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
    CommentStatement,
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
    WhileStatement
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
    TypeCastExpression,
    TypeExpression,
    TypedArrayExpression,
    UnaryExpression,
    VariableExpression,
    XmlAttributeGetExpression
} from './Expression';
import type { Diagnostic, Range } from 'vscode-languageserver';
import { Logger } from '../Logger';
import { isAnnotationExpression, isCallExpression, isCallfuncExpression, isCommentStatement, isDottedGetExpression, isIfStatement, isIndexedGetExpression } from '../astUtils/reflection';
import { createStringLiteral } from '../astUtils/creators';
import type { Expression, Statement } from './AstNode';
import { SymbolTable } from '../SymbolTable';

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
     * The top-level symbol table for the body of this file.
     */
    public get symbolTable() {
        return this.ast.symbolTable;
    }


    public propertyHints = {} as Record<string, string>;

    private addPropertyHints(item: Token | AALiteralExpression) {
        if (isToken(item)) {
            const name = item.text;
            this.propertyHints[name.toLowerCase()] = name;
        } else {
            for (const member of item.elements) {
                if (!isCommentStatement(member)) {
                    const name = member.keyToken.text;
                    if (!name.startsWith('"')) {
                        this.propertyHints[name.toLowerCase()] = name;
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
        let tokens: Token[];
        if (typeof toParse === 'string') {
            tokens = Lexer.scan(toParse).tokens;
        } else {
            tokens = toParse;
        }
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
        //now that we've built the AST, link every node to its parent
        this.ast.link();
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

            if (this.check(TokenKind.Comment)) {
                return this.commentStatement();
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
        const statement = new EnumMemberStatement({} as any);
        statement.tokens.name = this.consume(
            DiagnosticMessages.expectedClassFieldIdentifier(),
            TokenKind.Identifier,
            ...AllowedProperties
        ) as Identifier;
        //look for `= SOME_EXPRESSION`
        if (this.check(TokenKind.Equal)) {
            statement.tokens.equal = this.advance();
            statement.value = this.expression();
        }
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
        return new InterfaceFieldStatement(name, asToken, typeExpression, optionalKeyword);
    }

    private consumeAsTokenAndTypeExpression(): [Token, TypeExpression] {
        let asToken = this.consumeToken(TokenKind.As);
        let typeExpression: TypeExpression;
        if (asToken) {
            //if there's nothing after the `as`, add a diagnostic and continue
            if (this.checkEndOfStatement()) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedIdentifierAfterKeyword(asToken.text),
                    range: asToken.range
                });
                //consume the statement separator
                this.consumeStatementSeparators();
            } else if (this.peek().kind !== TokenKind.Identifier && !this.checkAny(...DeclarableTypes, ...AllowedTypeIdentifiers)) {
                this.diagnostics.push({
                    ...DiagnosticMessages.expectedIdentifierAfterKeyword(asToken.text),
                    range: asToken.range
                });
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

        return new InterfaceMethodStatement(
            functionType,
            name,
            leftParen,
            params,
            rightParen,
            asToken,
            returnTypeExpression,
            optionalKeyword
        );
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

                    //comments
                } else if (this.check(TokenKind.Comment)) {
                    decl = this.commentStatement();
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
            //break out of this loop if we encountered the `EndInterface` token not followed by `as`
            if (this.check(TokenKind.EndInterface) && !this.checkNext(TokenKind.As)) {
                break;
            }
        }

        //consume the final `end interface` token
        const endInterfaceToken = this.consumeToken(TokenKind.EndInterface);

        const statement = new InterfaceStatement(
            interfaceToken,
            nameToken,
            extendsToken,
            parentInterfaceName,
            body,
            endInterfaceToken
        );
        this.exitAnnotationBlock(parentAnnotations);
        return statement;
    }

    private enumDeclaration(): EnumStatement {
        const result = new EnumStatement({} as any, []);
        this.warnIfNotBrighterScriptMode('enum declarations');

        const parentAnnotations = this.enterAnnotationBlock();

        result.tokens.enum = this.consume(
            DiagnosticMessages.expectedKeyword(TokenKind.Enum),
            TokenKind.Enum
        );

        result.tokens.name = this.tryIdentifier(...this.allowedLocalIdentifiers);

        this.consumeStatementSeparators();
        //gather up all members
        while (this.checkAny(TokenKind.Comment, TokenKind.Identifier, TokenKind.At, ...AllowedProperties)) {
            try {
                let decl: EnumMemberStatement | CommentStatement;

                //collect leading annotations
                if (this.check(TokenKind.At)) {
                    this.annotationExpression();
                }

                //members
                if (this.checkAny(TokenKind.Identifier, ...AllowedProperties)) {
                    decl = this.enumMemberStatement();

                    //comments
                } else if (this.check(TokenKind.Comment)) {
                    decl = this.commentStatement();
                }

                if (decl) {
                    this.consumePendingAnnotations(decl);
                    result.body.push(decl);
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
        result.tokens.endEnum = this.consumeToken(TokenKind.EndEnum);

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
                    if (overrideKeyword && funcDeclaration.name.text.toLowerCase() === 'new') {
                        this.diagnostics.push({
                            ...DiagnosticMessages.cannotUseOverrideKeywordOnConstructorFunction(),
                            range: overrideKeyword.range
                        });
                    }

                    decl = new MethodStatement(
                        accessModifier,
                        funcDeclaration.name,
                        funcDeclaration.func,
                        overrideKeyword
                    );

                    //refer to this statement as parent of the expression
                    funcDeclaration.func.functionStatement = decl as MethodStatement;

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
            parentClassName
        );

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

        return new FieldStatement(
            accessModifier,
            name,
            asToken,
            fieldTypeExpression,
            equal,
            initialValue,
            optionalKeyword
        );
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
                [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();
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
                typeExpression
            );

            //support ending the function with `end sub` OR `end function`
            func.body = this.block();
            //if the parser was unable to produce a block, make an empty one so the AST makes some sense...
            if (!func.body) {
                func.body = new Block([], util.createRangeFromPositions(func.range.start, func.range.start));
            }
            func.body.symbolTable = new SymbolTable(`Block: Function '${name?.text ?? ''}'`, () => func.getSymbolTable());

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
                    range: func.end.range
                });
            }
            func.callExpressions = this.callExpressions;

            if (isAnonymous) {
                return func;
            } else {
                let result = new FunctionStatement(name, func);
                func.symbolTable.name += `: '${name?.text}'`;
                func.functionStatement = result;

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
        return new FunctionParameterExpression(
            name,
            equalToken,
            defaultValue,
            asToken,
            typeExpression
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
            result = new AssignmentStatement(operator, name, value);
        } else {
            const nameExpression = new VariableExpression(name);
            result = new AssignmentStatement(
                operator,
                name,
                new BinaryExpression(nameExpression, operator, value)
            );
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
            this.checkAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers) &&
            this.checkAnyNext(...AssignmentOperators)
        ) {
            return this.assignment();
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

        this.namespaceAndFunctionDepth++;

        let name = this.identifyingExpression();
        //set the current namespace name
        let result = new NamespaceStatement(keyword, name, null, null);

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

        result.body = body;
        result.endKeyword = endKeyword;
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
            const varExpr = new VariableExpression(firstIdentifier);
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
                expr = new DottedGetExpression(expr, identifier, dot);
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
            equals: equalToken
        }, expression);
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
        let importStatement = new ImportStatement(
            this.advance(),
            //grab the next token only if it's a string
            this.tryConsume(
                DiagnosticMessages.expectedStringLiteralAfterKeyword('import'),
                TokenKind.StringLiteral
            )
        );

        return importStatement;
    }

    private annotationExpression() {
        const atToken = this.advance();
        const identifier = this.tryConsume(DiagnosticMessages.expectedIdentifier(), TokenKind.Identifier, ...AllowedProperties);
        if (identifier) {
            identifier.kind = TokenKind.Identifier;
        }
        let annotation = new AnnotationExpression(atToken, identifier);
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

        return new TernaryExpression(test, questionMarkToken, consequent, colonToken, alternate);
    }

    private nullCoalescingExpression(test: Expression): NullCoalescingExpression {
        this.warnIfNotBrighterScriptMode('null coalescing operator');
        const questionQuestionToken = this.advance();
        const alternate = this.expression();
        return new NullCoalescingExpression(test, questionQuestionToken, alternate);
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
            { try: tryToken }
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
                statement.tokens.endTry = this.advance();
            }
            return statement;
        }
        const catchStmt = new CatchStatement({ catch: this.advance() });
        statement.catchStatement = catchStmt;

        const exceptionVarToken = this.tryConsume(DiagnosticMessages.missingExceptionVarToFollowCatch(), TokenKind.Identifier, ...this.allowedLocalIdentifiers);
        if (exceptionVarToken) {
            // force it into an identifier so the AST makes some sense
            exceptionVarToken.kind = TokenKind.Identifier;
            catchStmt.exceptionVariable = exceptionVarToken as Identifier;
        }

        //ensure statement sepatator
        this.consumeStatementSeparators();

        catchStmt.catchBranch = this.block(TokenKind.EndTry);

        if (this.peek().kind !== TokenKind.EndTry) {
            this.diagnostics.push({
                ...DiagnosticMessages.expectedEndTryToTerminateTryCatch(),
                range: this.peek().range
            });
        } else {
            statement.tokens.endTry = this.advance();
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
        return new DimStatement(dim, identifier, leftSquareBracket, expressions, rightSquareBracket);
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
        return new Block(statements, startingRange);
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

            const result = new IncrementStatement(expr, operator);
            return result;
        }

        if (isCallExpression(expr) || isCallfuncExpression(expr)) {
            return new ExpressionStatement(expr);
        }

        //at this point, it's probably an error. However, we recover a little more gracefully by creating an inclosing ExpressionStatement
        this.diagnostics.push({
            ...DiagnosticMessages.expectedStatementOrFunctionCallButReceivedExpression(),
            range: expressionStart.range
        });
        return new ExpressionStatement(expr);
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
                        : new BinaryExpression(left, operator, right),
                    left.dot
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

        let toReturn = this.check(TokenKind.Else) ? undefined : this.expression();
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

    private expression(findTypeCast = true): Expression {
        let expression = this.anonymousFunction();
        let asToken: Token;
        let typeExpression: TypeExpression;
        if (findTypeCast) {
            do {
                if (this.check(TokenKind.As)) {
                    this.warnIfNotBrighterScriptMode('type cast');
                    // Check if this expression is wrapped in any type casts
                    // allows for multiple casts:
                    // myVal = foo() as dynamic as string
                    [asToken, typeExpression] = this.consumeAsTokenAndTypeExpression();
                    if (asToken && typeExpression) {
                        expression = new TypeCastExpression(expression, asToken, typeExpression);
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
        if (nextKind === TokenKind.Not) {
            this.current++; //advance
            let operator = this.previous();
            let right = this.relational();
            return new UnaryExpression(operator, right);
        } else if (nextKind === TokenKind.Minus || nextKind === TokenKind.Plus) {
            this.current++; //advance
            let operator = this.previous();
            let right = (nextKind as any) === TokenKind.Not
                ? this.boolean()
                : this.prefixUnary();
            return new UnaryExpression(operator, right);
        }
        return this.call();
    }

    private indexedGet(expr: Expression) {
        let openingSquare = this.previous();
        let questionDotToken = this.getMatchingTokenAtOffset(-2, TokenKind.QuestionDot);
        let index: Expression;
        let closingSquare: Token;
        while (this.match(TokenKind.Newline)) { }
        try {
            index = this.expression();
        } catch (error) {
            this.rethrowNonDiagnosticError(error);
        }

        while (this.match(TokenKind.Newline)) { }
        closingSquare = this.tryConsume(
            DiagnosticMessages.expectedRightSquareBraceAfterArrayOrObjectIndex(),
            TokenKind.RightSquareBracket
        );

        return new IndexedGetExpression(expr, index, openingSquare, closingSquare, questionDotToken);
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
            return new ExpressionStatement(exprStmt);
        }

        let call = this.finishCall(leftParen, nameExpr);
        //pop the call from the  callExpressions list because this is technically something else
        this.callExpressions.pop();
        let result = new NewExpression(newToken, call);
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
                    expr = new DottedGetExpression(expr, name as Identifier, dot);

                    this.addPropertyHints(name);
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

        let expression = new CallExpression(callee, openingParen, closingParen, args);
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
                    expr = new BinaryExpression(expr, operator, right);
                } else {
                    break;
                }
            }
            if (expr) {
                return new TypeExpression(expr);
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
            expr = new VariableExpression(this.advance() as Identifier);
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
                    expr = new TypedArrayExpression(expr, leftBracket, rightBracket);
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
                return new LiteralExpression(this.previous());

            //capture source literals (LINE_NUM if brightscript, or a bunch of them if brighterscript)
            case this.matchAny(TokenKind.LineNumLiteral, ...(this.options.mode === ParseMode.BrightScript ? [] : BrighterScriptSourceLiterals)):
                return new SourceLiteralExpression(this.previous());

            //template string
            case this.check(TokenKind.BackTick):
                return this.templateString(false);

            //tagged template string (currently we do not support spaces between the identifier and the backtick)
            case this.checkAny(TokenKind.Identifier, ...AllowedLocalIdentifiers) && this.checkNext(TokenKind.BackTick):
                return this.templateString(true);

            case this.matchAny(TokenKind.Identifier, ...this.allowedLocalIdentifiers):
                return new VariableExpression(this.previous() as Identifier);

            case this.match(TokenKind.LeftParen):
                let left = this.previous();
                let expr = this.expression();
                let right = this.consume(
                    DiagnosticMessages.unmatchedLeftParenAfterExpression(),
                    TokenKind.RightParen
                );
                return new GroupingExpression({ left: left, right: right }, expr);

            case this.matchAny(TokenKind.LeftSquareBracket):
                return this.arrayLiteral();

            case this.match(TokenKind.LeftCurlyBrace):
                return this.aaLiteral();

            case this.matchAny(TokenKind.Pos, TokenKind.Tab):
                let token = Object.assign(this.previous(), {
                    kind: TokenKind.Identifier
                }) as Identifier;
                return new VariableExpression(token);

            case this.checkAny(TokenKind.Function, TokenKind.Sub):
                return this.anonymousFunction();

            case this.check(TokenKind.RegexLiteral):
                return this.regexLiteralExpression();

            case this.check(TokenKind.Comment):
                return new CommentStatement([this.advance()]);

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
        let elements: Array<Expression | CommentStatement> = [];
        let openingSquare = this.previous();

        //add any comment found right after the opening square
        if (this.check(TokenKind.Comment)) {
            elements.push(new CommentStatement([this.advance()]));
        }

        while (this.match(TokenKind.Newline)) {
        }
        let closingSquare: Token;

        if (!this.match(TokenKind.RightSquareBracket)) {
            try {
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
        return new ArrayLiteralExpression(elements, openingSquare, closingSquare);
    }

    private aaLiteral() {
        let openingBrace = this.previous();
        let members: Array<AAMemberExpression | CommentStatement> = [];

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
                if (this.check(TokenKind.Comment)) {
                    lastAAMember = null;
                    members.push(new CommentStatement([this.advance()]));
                } else {
                    let k = key();
                    let expr = this.expression();
                    lastAAMember = new AAMemberExpression(
                        k.keyToken,
                        k.colonToken,
                        expr
                    );
                    members.push(lastAAMember);
                }

                while (this.matchAny(TokenKind.Comma, TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
                    // collect comma at end of expression
                    if (lastAAMember && this.checkPrevious(TokenKind.Comma)) {
                        lastAAMember.commaToken = this.previous();
                    }

                    //check for comment at the end of the current line
                    if (this.check(TokenKind.Comment) || this.checkPrevious(TokenKind.Comment)) {
                        let token = this.checkPrevious(TokenKind.Comment) ? this.previous() : this.advance();
                        members.push(new CommentStatement([token]));
                    } else {
                        this.consumeStatementSeparators(true);

                        //check for a comment on its own line
                        if (this.check(TokenKind.Comment) || this.checkPrevious(TokenKind.Comment)) {
                            let token = this.checkPrevious(TokenKind.Comment) ? this.previous() : this.advance();
                            lastAAMember = null;
                            members.push(new CommentStatement([token]));
                            continue;
                        }

                        if (this.check(TokenKind.RightCurlyBrace)) {
                            break;
                        }
                        let k = key();
                        let expr = this.expression();
                        lastAAMember = new AAMemberExpression(
                            k.keyToken,
                            k.colonToken,
                            expr
                        );
                        members.push(lastAAMember);
                    }
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

        const aaExpr = new AALiteralExpression(members, openingBrace, closingBrace);
        this.addPropertyHints(aaExpr);
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
    mode: ParseMode;
    /**
     * A logger that should be used for logging. If omitted, a default logger is used
     */
    logger?: Logger;
}


class CancelStatementError extends Error {
    constructor() {
        super('CancelStatement');
    }
}
