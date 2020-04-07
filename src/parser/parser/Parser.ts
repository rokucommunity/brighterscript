import { EventEmitter } from 'events';

import { TokenKind, Token, Identifier, Location, ReservedWords, BlockTerminator, AllowedLocalIdentifiers, AssignmentOperators, DisallowedLocalIdentifiers, AllowedProperties } from '../lexer';

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
    ClassStatement,
    ClassFieldStatement,
    ClassMemberStatement,
    ClassMethodStatement,
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
    StopStatement
} from './Statement';
import { diagnosticMessages, DiagnosticMessage } from '../../DiagnosticMessages';
import { util } from '../../util';
import { ParseError } from '../Error';
import { FunctionExpression, CallExpression, BinaryExpression, VariableExpression, LiteralExpression, DottedGetExpression, IndexedGetExpression, GroupingExpression, ArrayLiteralExpression, AAMemberExpression, Expression, UnaryExpression, AALiteralExpression } from './Expression';

export class Parser {
    /** Allows consumers to observe errors as they're detected. */
    readonly events = new EventEmitter();

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
    public statements: Statement[];
    /**
     * The list of errors found during the parse process
     */
    public errors: ParseError[];

    /**
     * The depth of the calls to function declarations. Helps some checks know if they are at the root or not.
     */
    private functionDeclarationLevel: number;

    /**
     * The options used to parse the file
     */
    public options: ParseOptions;

    /**
     * Static wrapper around creating a new parser and parsing a list of tokens
     */
    public static parse(tokens: Token[], options?: ParseOptions) {
        return new Parser().parse(tokens, options);
    }

    /**
     * Parses an array of `Token`s into an abstract syntax tree
     * @param toParse the array of tokens to parse. May not contain any whitespace tokens
     * @returns the same instance of the parser which contains the errors and statements
     */
    public parse(tokens: Token[], options?: ParseOptions) {
        this.tokens = tokens;
        this.options = this.sanitizeParseOptions(options);
        this.current = 0;
        this.statements = [];
        this.errors = [];
        this.functionDeclarationLevel = 0;

        if (this.tokens.length > 0) {
            try {
                while (!this.isAtEnd()) {
                    let dec = this.declaration();
                    if (dec) {
                        this.statements.push(dec);
                    }
                }
            } catch (parseError) {
                //do nothing with the parse error for now. perhaps we can remove this?
                console.error(parseError);
            }
        }
        return this;
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
        return this.functionDeclarationLevel === 0;
    }

    /**
     * Convenience function to subscribe to the `err` events emitted by `parser.events`.
     * @param errorHandler the function to call for every Parser error emitted after subscribing
     * @returns an object with a `dispose` function, used to unsubscribe from errors
     */
    public onError(errorHandler: (err: ParseError) => void) {
        this.events.on('err', errorHandler);
        return {
            dispose: () => {
                this.events.removeListener('err', errorHandler);
            }
        };
    }

    /**
     * Convenience function to subscribe to a single `err` event emitted by `parser.events`.
     * @param errorHandler the function to call for the first Parser error emitted after subscribing
     */
    public onErrorOnce(errorHandler: (err: ParseError) => void) {
        this.events.once('err', errorHandler);
    }

    /**
     * Add an error to the parse results.
     * @param token - the token where the error occurred
     * @param message - the message for this error
     * @param code - an error code used to uniquely identify this type of error.  Defaults to 1000
     * @returns an error object that can be thrown if the calling code needs to abort parsing
     */
    private addError(token: Token, message: string, code = 1000) {
        let err = new ParseError(token, message, code);
        this.errors.push(err);
        this.events.emit('err', err);
        return err;
    }

    /**
     * Wrapper around addError that extracts the properties from a diagnostic object
     * @param token
     * @param diagnostic
     */
    private addDiagnostic(token: Token, diagnostic: DiagnosticMessage) {
        return this.addError(token, diagnostic.message, diagnostic.code);
    }

    /**
     * Throws an error if the input file type is not BrighterScript
     */
    private ensureBrighterScriptMode(featureName: string) {
        if (this.options.mode !== 'brighterscript') {
            throw this.addDiagnostic(this.peek(), diagnosticMessages.Bs_feature_not_supported_in_brs_files_1019(featureName));
        }
    }

    /**
     * Add an error at the given location.
     * @param location
     * @param message
     */
    private addErrorAtLocation(location: Location, message: string) {
        this.addError({ location: location } as any, message);
    }

    private declaration(...additionalTerminators: BlockTerminator[]): Statement | undefined {
        try {
            // consume any leading newlines
            while (this.match(TokenKind.Newline)) { }

            //TODO implement this in a future commit
            if (this.check(TokenKind.Class)) {
                return this.classDeclaration();
            }

            if (this.check(TokenKind.Sub, TokenKind.Function)) {
                return this.functionDeclaration(false);
            }

            if (this.checkLibrary()) {
                return this.libraryStatement();
            }

            // BrightScript is like python, in that variables can be declared without a `var`,
            // `let`, (...) keyword. As such, we must check the token *after* an identifier to figure
            // out what to do with it.
            if (
                this.check(TokenKind.Identifier, ...AllowedLocalIdentifiers) &&
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
            this.peek();

            return this.statement(...additionalTerminators);
        } catch (error) {
            this.synchronize();
        }
    }

    /**
     * A BrighterScript class declaration
     */
    private classDeclaration(): ClassStatement {
        this.ensureBrighterScriptMode('class declarations');
        let keyword = this.consume(`Expected 'class' keyword`, TokenKind.Class);
        //get the class name
        let className = this.consumeContinue(diagnosticMessages.Missing_identifier_after_class_keyword_1016(), TokenKind.Identifier) as Identifier;
        //consume newlines (at least one)
        while (this.match(TokenKind.Newline)) {
        }

        let members = [] as ClassMemberStatement[];
        //gather up all class members (Fields, Methods)
        while (this.check(TokenKind.Public, TokenKind.Protected, TokenKind.Private, TokenKind.Function, TokenKind.Sub, TokenKind.Identifier)) {
            try {
                let accessModifier: Token;
                if (this.check(TokenKind.Public, TokenKind.Protected, TokenKind.Private)) {
                    //use actual access modifier
                    accessModifier = this.advance();
                } else {
                    accessModifier = {
                        isReserved: false,
                        kind: TokenKind.Public,
                        text: 'public',
                        //zero-length token which indicates derived
                        location: {
                            start: this.peek().location.start,
                            end: this.peek().location.start
                        }
                    };
                }

                //methods (function/sub keyword OR identifier followed by opening paren)
                if (this.check(TokenKind.Function, TokenKind.Sub) || (this.check(TokenKind.Identifier) && this.checkNext(TokenKind.LeftParen))) {
                    let funcDeclaration = this.functionDeclaration(false);
                    members.push(
                        new ClassMethodStatement(
                            accessModifier,
                            funcDeclaration.name,
                            funcDeclaration.func
                        )
                    );

                    //fields
                } else if (this.check(TokenKind.Identifier)) {
                    members.push(
                        this.classFieldDeclaration(accessModifier)
                    );
                }
            } catch (e) {
                //throw out any failed members and move on to the next line
                this.consumeUntil(TokenKind.Newline, TokenKind.Eof);
            }

            //consume trailing newlines
            while (this.match(TokenKind.Newline)) { }
        }

        //consume trailing newlines
        while (this.match(TokenKind.Newline)) {

        }

        let endingKeyword = this.advance();
        if (endingKeyword.kind !== TokenKind.EndClass) {
            this.addError(
                endingKeyword,
                `Expected 'end class' to terminate class block`
            );
        }
        //consume any trailing newlines
        while (this.match(TokenKind.Newline)) {

        }

        const result = new ClassStatement(
            keyword,
            className,
            members,
            endingKeyword
        );
        return result;
    }

    private classFieldDeclaration(accessModifier: Token | null) {
        let name = this.consume(`Expected identifier`, TokenKind.Identifier) as Identifier;
        let asToken: Token;
        let fieldType: Token;
        //look for `as SOME_TYPE`
        if (this.check(TokenKind.As)) {
            asToken = this.advance();
            fieldType = this.advance();

            //no field type specified
            if (!valueKindFromString(`${fieldType.text}`) && !this.check(TokenKind.Identifier)) {
                this.addDiagnostic(this.peek(), diagnosticMessages.Expected_valid_type_to_follow_as_keyword_1018());
            }
        }

        //TODO - support class field assignments on construct
        // var assignment: any;

        return new ClassFieldStatement(
            accessModifier,
            name,
            asToken,
            fieldType
        );
    }

    private functionDeclaration(isAnonymous: true): FunctionExpression;
    private functionDeclaration(isAnonymous: false): FunctionStatement;
    private functionDeclaration(isAnonymous: boolean) {
        try {
            //track depth to help certain statements need to know if they are contained within a function body
            this.functionDeclarationLevel++;
            let functionType: Token;
            if (this.check(TokenKind.Sub, TokenKind.Function)) {
                functionType = this.advance();
            } else {
                this.addDiagnostic(this.peek(), diagnosticMessages.Missing_function_sub_keyword_1017(this.peek().text));
                functionType = {
                    isReserved: true,
                    kind: TokenKind.Function,
                    text: 'function',
                    //zero-length location means derived
                    location: {
                        start: this.peek().location.start,
                        end: this.peek().location.start
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
                    `Expected '(' after ${functionTypeText}`,
                    TokenKind.LeftParen
                );
            } else {
                name = this.consume(
                    `Expected ${functionTypeText} name after '${functionTypeText}'`,
                    TokenKind.Identifier
                ) as Identifier;
                leftParen = this.consume(
                    `Expected '(' after ${functionTypeText} name`,
                    TokenKind.LeftParen
                );

                //prevent functions from ending with type designators
                let lastChar = name.text[name.text.length - 1];
                if (['$', '%', '!', '#', '&'].includes(lastChar)) {
                    //don't throw this error; let the parser continue
                    this.addError(
                        name,
                        `Function name '${name.text}' cannot end with type designator '${lastChar}'`
                    );
                }
            }

            let args: FunctionParameter[] = [];
            let asToken: Token;
            let typeToken: Token;
            if (!this.check(TokenKind.RightParen)) {
                do {
                    if (args.length >= CallExpression.MaximumArguments) {
                        throw this.addError(
                            this.peek(),
                            `Cannot have more than ${CallExpression.MaximumArguments} parameters`
                        );
                    }

                    args.push(this.functionParameter());
                } while (this.match(TokenKind.Comma));
            }
            let rightParen = this.advance();

            if (this.check(TokenKind.As)) {
                asToken = this.advance();

                typeToken = this.advance();
                let typeString = typeToken.text || '';
                let maybeReturnType = valueKindFromString(typeString);

                if (!maybeReturnType) {
                    this.addError(
                        typeToken,
                        `Function return type '${typeString}' is invalid`
                    );
                }

                returnType = maybeReturnType;
            }

            args.reduce((haveFoundOptional: boolean, arg: Argument) => {
                if (haveFoundOptional && !arg.defaultValue) {
                    throw this.addError(
                        {
                            kind: TokenKind.Identifier,
                            text: arg.name.text,
                            isReserved: ReservedWords.has(arg.name.text),
                            location: arg.location
                        },
                        `Argument '${arg.name.text}' has no default value, but comes after arguments with default values`
                    );
                }

                return haveFoundOptional || !!arg.defaultValue;
            }, false);
            let comment: CommentStatement;
            //get a comment if available
            if (this.check(TokenKind.Comment)) {
                comment = this.commentStatement();
            }

            this.consume(
                `Expected newline or ':' after ${functionTypeText} signature`,
                TokenKind.Newline,
                TokenKind.Colon
            );
            while (this.match(TokenKind.Newline)) { }
            //support ending the function with `end sub` OR `end function`
            let body = this.block(TokenKind.EndSub, TokenKind.EndFunction);
            if (!body) {
                throw this.addError(
                    this.peek(),
                    `Expected 'end ${functionTypeText}' to terminate ${functionTypeText} block`
                );
            }
            //prepend comment to body
            if (comment) {
                body.statements.unshift(comment);
            }
            // consume 'end sub' or 'end function'
            let endingKeyword = this.advance();
            let expectedEndKind = isSub ? TokenKind.EndSub : TokenKind.EndFunction;

            //if `function` is ended with `end sub`, or `sub` is ended with `end function`, then
            //add an error but don't hard-fail so the AST can continue more gracefully
            if (endingKeyword.kind !== expectedEndKind) {
                this.addError(
                    endingKeyword,
                    `Expected 'end ${functionTypeText}' to terminate ${functionTypeText} block`
                );
            }

            let func = new FunctionExpression(
                args,
                returnType,
                body,
                functionType,
                endingKeyword,
                leftParen,
                rightParen,
                asToken,
                typeToken
            );

            if (isAnonymous) {
                return func;
            } else {
                // only consume trailing newlines in the statement context; expressions
                // expect to handle their own trailing whitespace
                while (this.match(TokenKind.Newline)) {
                }
                return new FunctionStatement(name, func);
            }
        } finally {
            this.functionDeclarationLevel--;
        }
    }

    private functionParameter(): FunctionParameter {
        if (!this.check(TokenKind.Identifier)) {
            throw this.addError(
                this.peek(),
                `Expected parameter name, but received '${this.peek().text || ''}'`
            );
        }

        let name = this.advance() as Identifier;
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
                throw this.addError(
                    typeToken,
                    `Function parameter '${name.text}' is of invalid type '${typeToken.text}'`
                );
            }

            type = typeValueKind;
        }

        return new FunctionParameter(
            name,
            {
                kind: type,
                location: typeToken ? typeToken.location : StdlibArgument.InternalLocation
            },
            typeToken,
            defaultValue,
            asToken
        );
    }

    private assignment(...additionalterminators: TokenKind[]): AssignmentStatement {
        let name = this.advance() as Identifier;
        //add error if name is a reserved word that cannot be used as an identifier
        if (DisallowedLocalIdentifiers.has(name.text.toLowerCase())) {
            //don't throw...this is fully recoverable
            this.addError(name, `Cannot use reserved word "${name.text}" as an identifier`);
        }
        let operator = this.consume(
            `Expected operator ('=', '+=', '-=', '*=', '/=', '\\=', '^=', '<<=', or '>>=') after idenfifier '${name.text}'`,
            ...AssignmentOperators
        );

        let value = this.expression();
        if (!this.check(...additionalterminators, TokenKind.Comment)) {
            this.consume(
                'Expected newline or \':\' after assignment',
                TokenKind.Newline,
                TokenKind.Colon,
                TokenKind.Eof,
                ...additionalterminators
            );
        }
        while (this.match(TokenKind.Newline)) { }

        if (operator.kind === TokenKind.Equal) {
            return new AssignmentStatement({ equals: operator }, name, value);
        } else {
            return new AssignmentStatement(
                { equals: operator },
                name,
                new BinaryExpression(new VariableExpression(name), operator, value)
            );
        }
    }

    private checkLibrary() {
        let isLibraryIdentifier = this.check(TokenKind.Identifier) && this.peek().text.toLowerCase() === 'library';

        //if we are at the top level, any line that starts with "library" should be considered a library statement
        if (this.isAtRootLevel() && isLibraryIdentifier) {
            return true;

            //not at root level, library statements are all invalid here, but try to detect if the tokens look
            //like a library statement (and let the libraryStatement function handle emitting the errors)
        } else if (isLibraryIdentifier && this.checkNext(TokenKind.StringLiteral)) {
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

        this.consume('Expected newline after \'while ...condition...\'', TokenKind.Newline);
        while (this.match(TokenKind.Newline)) { }
        const whileBlock = this.block(TokenKind.EndWhile);
        if (!whileBlock) {
            throw this.addError(this.peek(), 'Expected \'end while\' to terminate while-loop block');
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
            this.addError(this.peek(), `Expected newline or comment after 'exit while'`);
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
            increment = new LiteralExpression(new Int32(1), this.peek().location);
        }
        while (this.match(TokenKind.Newline)) {

        }

        let body = this.block(TokenKind.EndFor, TokenKind.Next);
        if (!body) {
            throw this.addError(this.peek(), 'Expected \'end for\' or \'next\' to terminate for-loop block');
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
            throw this.addError(maybeIn, 'Expected \'in\' after \'for each <name>\'');
        }

        let target = this.expression();
        if (!target) {
            throw this.addError(this.peek(), 'Expected target object to iterate over');
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
            throw this.addError(this.peek(), 'Expected \'end for\' or \'next\' to terminate for-loop block');
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
            this.consume('Expected newline after \'exit for\'', TokenKind.Newline);
            while (this.match(TokenKind.Newline)) {

            }
        }
        return new ExitForStatement({ exitFor: keyword });
    }

    private commentStatement() {
        //if this comment is on the same line as the previous statement,
        //then this comment should be treated as a single-line comment
        let prev = this.previous();
        if (prev && prev.location.end.line === this.peek().location.start.line) {
            return new CommentStatement([this.advance()]);
        } else {
            let comments = [this.advance()];
            while (this.check(TokenKind.Newline)) {
                //absorb newlines
                while (this.match(TokenKind.Newline)) { }

                //if this is a comment, and it's the next line down from the previous comment
                if (this.check(TokenKind.Comment) && comments[comments.length - 1].location.end.line === this.peek().location.start.line - 1) {
                    comments.push(this.advance());
                } else {
                    break;
                }
            }
            return new CommentStatement(comments);
        }
    }

    private libraryStatement(): LibraryStatement | undefined {
        let libStatement = new LibraryStatement({
            library: this.advance(),
            //grab the next token only if it's a string
            filePath: this.check(TokenKind.StringLiteral) ? this.advance() : undefined
        });

        //no token following library keyword token
        if (!libStatement.tokens.filePath && this.check(TokenKind.Newline, TokenKind.Colon, TokenKind.Comment)) {
            this.addErrorAtLocation(
                libStatement.tokens.library.location,
                `Missing string literal after ${libStatement.tokens.library.text} keyword`
            );
        }

        //consume all tokens until the end of the line
        let invalidTokens = this.consumeUntil(TokenKind.Newline, TokenKind.Eof, TokenKind.Colon, TokenKind.Comment);

        if (invalidTokens.length > 0) {
            //add an error for every invalid token
            for (let invalidToken of invalidTokens) {
                this.addErrorAtLocation(
                    invalidToken.location,
                    `Found unexpected token '${invalidToken.text}' after library statement`
                );
            }
        }

        //libraries must be at the very top of the file before any other declarations.
        let isAtTopOfFile = true;
        for (let loopStatement of this.statements) {
            //if we found a non-library statement, this statement is not at the top of the file
            if (!(loopStatement instanceof LibraryStatement) && !(loopStatement instanceof CommentStatement)) {
                isAtTopOfFile = false;
                break;
            }
        }

        //libraries must be a root-level statement (i.e. NOT nested inside of functions)
        if (!this.isAtRootLevel() || !isAtTopOfFile) {
            this.addErrorAtLocation(
                libStatement.location,
                'Library statements may only appear at the top of a file'
            );
        }
        //consume to the next newline, eof, or colon
        while (this.match(TokenKind.Newline, TokenKind.Eof, TokenKind.Colon)) {
        }
        return libStatement;
    }

    private ifStatement(): IfStatement {
        const ifToken = this.advance();
        const startingLine = ifToken.location;

        const condition = this.expression();
        let thenBranch: Block;
        let elseIfBranches: ElseIf[] = [];
        let elseBranch: Block | undefined;

        let thenToken: Token | undefined;
        let elseIfTokens: Token[] = [];
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
            let errorsLengthBeforeBlock = this.errors.length;

            // we're parsing a multi-line ("block") form of the BrightScript if/then/else and must find
            // a trailing "end if"

            let maybeThenBranch = this.block(TokenKind.EndIf, TokenKind.Else, TokenKind.ElseIf);
            if (!maybeThenBranch) {
                //throw out any new errors created as a result of a `then` block parse failure.
                //the block() function will discard the current line, so any discarded errors will
                //resurface if they are legitimate, and not a result of a malformed if statement
                this.errors.splice(errorsLengthBeforeBlock, this.errors.length - errorsLengthBeforeBlock);

                //this whole if statement is bogus...add error to the if token and hard-fail
                throw this.addError(
                    ifToken,
                    'Expected \'end if\', \'else if\', or \'else\' to terminate \'then\' block'
                );
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
                elseIfTokens.push(elseIfToken);
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

                this.match(TokenKind.Newline);
                let elseIfThen = this.block(TokenKind.EndIf, TokenKind.Else, TokenKind.ElseIf);
                if (!elseIfThen) {
                    throw this.addError(
                        this.peek(),
                        'Expected \'end if\', \'else if\', or \'else\' to terminate \'then\' block'
                    );
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

                this.match(TokenKind.Newline);
                elseBranch = this.block(TokenKind.EndIf);
                endIfToken = this.advance(); // skip past "end if"

                //ensure that single-line `if` statements have a colon right before 'end if'
                if (util.sameStartLine(ifToken, endIfToken)) {
                    let index = this.tokens.indexOf(endIfToken);
                    let previousToken = this.tokens[index - 1];
                    if (previousToken.kind !== TokenKind.Colon) {
                        this.addError(endIfToken, 'Expected \':\' to preceed \'end if\'');
                    }
                }
                this.match(TokenKind.Newline);
            } else {
                this.match(TokenKind.Newline);
                endIfToken = this.consume(
                    `Expected 'end if' to close 'if' statement started on line ${startingLine}`,
                    TokenKind.EndIf
                );

                //ensure that single-line `if` statements have a colon right before 'end if'
                if (util.sameStartLine(ifToken, endIfToken)) {
                    let index = this.tokens.indexOf(endIfToken);
                    let previousToken = this.tokens[index - 1];
                    if (previousToken.kind !== TokenKind.Colon) {
                        this.addError(endIfToken, 'Expected \':\' to preceed \'end if\'');
                    }
                }
                this.match(TokenKind.Newline);
            }
        } else {
            let thenStatement = this.declaration(TokenKind.ElseIf, TokenKind.Else);
            if (!thenStatement) {
                throw this.addError(
                    this.peek(),
                    'Expected a statement to follow \'if ...condition... then\''
                );
            }
            thenBranch = new Block([thenStatement], this.peek().location);

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
                    throw this.addError(
                        this.peek(),
                        `Expected a statement to follow '${elseIf.text} ...condition... then'`
                    );
                }

                elseIfBranches.push({
                    condition: elseIfCondition,
                    thenBranch: new Block([elseIfThen], this.peek().location),
                    thenToken: thenToken,
                    elseIfToken: elseIf
                });
            }
            if (this.previous().kind !== TokenKind.Newline && this.match(TokenKind.Else)) {
                elseToken = this.previous();
                let elseStatement = this.declaration();
                if (!elseStatement) {
                    throw this.addError(this.peek(), `Expected a statement to follow 'else'`);
                }
                elseBranch = new Block([elseStatement], this.peek().location);
            }
        }

        return new IfStatement(
            {
                if: ifToken,
                then: thenToken,
                elseIfs: elseIfTokens,
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
                throw this.addError(
                    this.peek(),
                    'Consecutive increment/decrement operators are not allowed'
                );
            } else if (expr instanceof CallExpression) {
                throw this.addError(
                    expressionStart,
                    'Increment/decrement operators are not allowed on the result of a function call'
                );
            }

            while (this.match(TokenKind.Newline, TokenKind.Colon)) {
            }

            return new IncrementStatement(expr, operator);
        }

        if (!this.check(...additionalTerminators, TokenKind.Comment)) {
            this.consume(
                'Expected newline or \':\' after expression statement',
                TokenKind.Newline,
                TokenKind.Colon,
                TokenKind.Eof
            );
        }

        if (expr instanceof CallExpression) {
            return new ExpressionStatement(expr);
        }

        //at this point, it's probably an error. However, we recover a little more gracefully by creating an assignment
        throw this.addError(
            expressionStart,
            'Expected statement or function call, but received an expression'
        );
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
                    'Expected newline or \':\' after indexed \'set\' statement',
                    TokenKind.Newline,
                    TokenKind.Else,
                    TokenKind.ElseIf,
                    TokenKind.Colon,
                    TokenKind.Eof, TokenKind.Comment
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
                    'Expected newline or \':\' after dotted \'set\' statement',
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
            let emptyStringLiteral = new LiteralExpression(new BrsString(''), printKeyword.location);
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
                'Expected newline or \':\' after printed values',
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
            this.consume('Labels must be declared on their own line', TokenKind.Newline, TokenKind.Eof);
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
            label: this.consume('Expected label identifier after goto keyword', TokenKind.Identifier)
        };

        while (this.match(TokenKind.Newline, TokenKind.Colon)) {
        }

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

                //scrap the entire line
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

        return new Block(statements, startingToken.location);
    }

    private expression(): Expression {
        return this.anonymousFunction();
    }

    private anonymousFunction(): Expression {
        if (this.check(TokenKind.Sub, TokenKind.Function)) {
            return this.functionDeclaration(true);
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

        while (this.match(TokenKind.Forwardslash, TokenKind.Backslash, TokenKind.Star, TokenKind.Mod)) {
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

    private call(): Expression {
        let expr = this.primary();

        while (true) {
            if (this.match(TokenKind.LeftParen)) {
                expr = this.finishCall(this.previous(), expr);
            } else if (this.match(TokenKind.LeftSquareBracket)) {
                let openingSquare = this.previous();
                while (this.match(TokenKind.Newline)) { }

                let index = this.expression();

                while (this.match(TokenKind.Newline)) {

                }
                let closingSquare = this.consume(
                    'Expected \']\' after array or object index',
                    TokenKind.RightSquareBracket
                );

                expr = new IndexedGetExpression(expr, index, openingSquare, closingSquare);
            } else if (this.match(TokenKind.Dot)) {
                let name = this.consume(
                    'Expected property name after \'.\'',
                    TokenKind.Identifier,
                    ...AllowedProperties
                );

                // force it into an identifier so the AST makes some sense
                name.kind = TokenKind.Identifier;

                expr = new DottedGetExpression(expr, name as Identifier);
            } else {
                break;
            }
        }

        return expr;
    }

    private finishCall(openingParen: Token, callee: Expression): Expression {
        let args = [] as Expression[];
        while (this.match(TokenKind.Newline)) {
        }

        if (!this.check(TokenKind.RightParen)) {
            do {
                while (this.match(TokenKind.Newline)) {

                }

                if (args.length >= CallExpression.MaximumArguments) {
                    throw this.addError(
                        this.peek(),
                        `Cannot have more than ${CallExpression.MaximumArguments} arguments`
                    );
                }
                args.push(this.expression());
            } while (this.match(TokenKind.Comma));
        }

        while (this.match(TokenKind.Newline)) { }

        const closingParen = this.consume(
            'Expected \')\' after function call arguments',
            TokenKind.RightParen
        );

        return new CallExpression(callee, openingParen, closingParen, args);
    }

    private primary(): Expression {
        switch (true) {
            case this.match(TokenKind.False):
                return new LiteralExpression(BrsBoolean.False, this.previous().location);
            case this.match(TokenKind.True):
                return new LiteralExpression(BrsBoolean.True, this.previous().location);
            case this.match(TokenKind.Invalid):
                return new LiteralExpression(BrsInvalid.Instance, this.previous().location);
            case this.match(
                TokenKind.IntegerLiteral,
                TokenKind.LongIntegerLiteral,
                TokenKind.FloatLiteral,
                TokenKind.DoubleLiteral,
                TokenKind.StringLiteral
            ):
                return new LiteralExpression(this.previous().literal, this.previous().location);
            case this.match(TokenKind.Identifier):
                return new VariableExpression(this.previous() as Identifier);
            case this.match(TokenKind.LeftParen):
                let left = this.previous();
                let expr = this.expression();
                let right = this.consume(
                    'Unmatched \'(\' - expected \')\' after expression',
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
                        'Unmatched \'[\' - expected \']\' after array literal',
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
                        location: null as Location
                    };
                    if (this.check(TokenKind.Identifier, ...AllowedProperties)) {
                        result.keyToken = this.advance();
                        result.key = new BrsString(result.keyToken.text);
                    } else if (this.check(TokenKind.StringLiteral)) {
                        result.keyToken = this.advance();
                        result.key = result.keyToken.literal as BrsString;
                    } else {
                        throw this.addError(
                            this.peek(),
                            `Expected identifier or string as associative array key, but received '${this.peek()
                                .text || ''}'`
                        );
                    }

                    result.colonToken = this.consume(
                        'Expected \':\' between associative array key and value',
                        TokenKind.Colon
                    );
                    result.location = util.getLocation(result.keyToken, result.keyToken, result.colonToken);
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
                            location: util.getLocation(k, k, expr)
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
                                location: util.getLocation(k, k, expr)
                            });
                        }
                    }

                    this.consume(
                        'Unmatched \'{\' - expected \'}\' after associative array literal',
                        TokenKind.RightCurlyBrace
                    );
                }

                let closingBrace = this.previous();

                return new AALiteralExpression(members, openingBrace, closingBrace);
            case this.match(TokenKind.Pos, TokenKind.Tab):
                let token = Object.assign(this.previous(), {
                    kind: TokenKind.Identifier
                }) as Identifier;
                return new VariableExpression(token);
            case this.check(TokenKind.Function, TokenKind.Sub):
                return this.anonymousFunction();
            case this.check(TokenKind.Comment):
                return new CommentStatement([this.advance()]);
            default:
                throw this.addError(this.peek(), `Found unexpected token '${this.peek().text}'`);
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

    private consume(errorMessage: string | DiagnosticMessage, ...tokenKinds: TokenKind[]): Token {
        let diagnostic = typeof errorMessage === 'string' ? { message: errorMessage, code: 1000 } : errorMessage;
        let foundTokenKind = tokenKinds
            .map(tokenKind => this.peek().kind === tokenKind)
            .reduce((foundAny, foundCurrent) => foundAny || foundCurrent, false);

        if (foundTokenKind) {
            return this.advance();
        }
        throw this.addError(this.peek(), diagnostic.message, diagnostic.code);
    }

    /**
     * Consume, or add a message if not found. But then continue and return undefined
     * @param message
     * @param tokenKinds
     */
    private consumeContinue(diagnostic: DiagnosticMessage, ...tokenKinds: TokenKind[]): Token | undefined {
        try {
            return this.consume(diagnostic, ...tokenKinds);
        } catch (e) {
            //do nothing;
        }
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
}

export enum ParseMode {
    brightscript = 'brightscript',
    brighterscript = 'brighterscript'
}

export interface ParseOptions {
    /**
     * The parse mode. When in 'brightscript' mode, no brighterscript syntax is allowed, and will emit errors.
     */
    mode: ParseMode;
}
