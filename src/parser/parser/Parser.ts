//tslint:disable
import { EventEmitter } from "events";

import * as Expr from "./Expression";
type Expression = Expr.Expression;
import * as Stmt from "./Statement";
type Statement = Stmt.Statement;
import { Lexeme, Token, Identifier, Location, ReservedWords } from "../lexer";
import { ParseError } from "./ParseError";

import {
    BrsInvalid,
    BrsBoolean,
    BrsString,
    Int32,
    ValueKind,
    Argument,
    StdlibArgument,
    FunctionParameter,
} from "../brsTypes";
import { FunctionStatement, ClassStatement, ClassFieldStatement, ClassMemberStatement, ClassMethodStatement } from './Statement';
import { diagnosticMessages, DiagnosticMessage } from '../../DiagnosticMessages';

/** Set of all keywords that end blocks. */
type BlockTerminator =
    | Lexeme.ElseIf
    | Lexeme.Else
    | Lexeme.EndFor
    | Lexeme.Next
    | Lexeme.EndIf
    | Lexeme.EndWhile
    | Lexeme.EndSub
    | Lexeme.EndFunction;

/** The set of operators valid for use in assignment statements. */
const assignmentOperators = [
    Lexeme.Equal,
    Lexeme.MinusEqual,
    Lexeme.PlusEqual,
    Lexeme.StarEqual,
    Lexeme.SlashEqual,
    Lexeme.BackslashEqual,
    Lexeme.LeftShiftEqual,
    Lexeme.RightShiftEqual,
];

/** List of Lexemes that are permitted as property names. */
const allowedProperties = [
    Lexeme.And,
    Lexeme.Box,
    Lexeme.CreateObject,
    Lexeme.Dim,
    Lexeme.Else,
    Lexeme.ElseIf,
    Lexeme.End,
    Lexeme.EndFunction,
    Lexeme.EndFor,
    Lexeme.EndIf,
    Lexeme.EndSub,
    Lexeme.EndWhile,
    Lexeme.Eval,
    Lexeme.Exit,
    Lexeme.ExitFor,
    Lexeme.ExitWhile,
    Lexeme.False,
    Lexeme.For,
    Lexeme.ForEach,
    Lexeme.Function,
    Lexeme.GetGlobalAA,
    Lexeme.GetLastRunCompileError,
    Lexeme.GetLastRunRunTimeError,
    Lexeme.Goto,
    Lexeme.If,
    Lexeme.Invalid,
    Lexeme.Let,
    Lexeme.Next,
    Lexeme.Not,
    Lexeme.ObjFun,
    Lexeme.Or,
    Lexeme.Pos,
    Lexeme.Print,
    Lexeme.Rem,
    Lexeme.Return,
    Lexeme.Step,
    Lexeme.Stop,
    Lexeme.Sub,
    Lexeme.Tab,
    Lexeme.To,
    Lexeme.True,
    Lexeme.Type,
    Lexeme.While,
];

/** List of Lexeme that are allowed as local var identifiers. */
const allowedIdentifiers = [Lexeme.EndFor, Lexeme.ExitFor, Lexeme.ForEach];

/**
 * List of string versions of Lexeme that are NOT allowed as local var identifiers.
 * Used to throw more helpful "you can't use a reserved word as an identifier" errors.
 */
export const disallowedIdentifiers = new Set(
    [
        Lexeme.And,
        Lexeme.Box,
        Lexeme.CreateObject,
        Lexeme.Dim,
        Lexeme.Else,
        Lexeme.ElseIf,
        Lexeme.End,
        Lexeme.EndFunction,
        Lexeme.EndIf,
        Lexeme.EndSub,
        Lexeme.EndWhile,
        Lexeme.Eval,
        Lexeme.Exit,
        Lexeme.ExitWhile,
        Lexeme.False,
        Lexeme.For,
        Lexeme.Function,
        Lexeme.GetGlobalAA,
        Lexeme.GetLastRunCompileError,
        Lexeme.GetLastRunRunTimeError,
        Lexeme.Goto,
        Lexeme.If,
        Lexeme.Invalid,
        Lexeme.Let,
        Lexeme.Next,
        Lexeme.Not,
        Lexeme.ObjFun,
        Lexeme.Or,
        Lexeme.Pos,
        Lexeme.Print,
        Lexeme.Rem,
        Lexeme.Return,
        Lexeme.Step,
        Lexeme.Sub,
        Lexeme.Tab,
        Lexeme.To,
        Lexeme.True,
        Lexeme.Type,
        Lexeme.While
    ].map(x => Lexeme[x].toLowerCase())
);

/** The results of a Parser's parsing pass. */
interface ParseResults {
    /** The statements produced by the parser. */
    statements: Stmt.Statement[];
    /** The errors encountered by the Parser. */
    errors: ParseError[];
}

export class Parser {
    /** Allows consumers to observe errors as they're detected. */
    readonly events = new EventEmitter();

    /**
     * A convenience function, equivalent to `new Parser().parse(toParse)`, that parses an array of
     * `Token`s into an abstract syntax tree that can be executed with the `Interpreter`.
     * @param toParse the array of tokens to parse
     * @param mode - the parse mode (brightscript or brighterscript)
     * @returns an array of `Statement` objects that together form the abstract syntax tree of the
     *          program
     */
    static parse(toParse: ReadonlyArray<Token>, mode: 'brightscript' | 'brighterscript' = 'brightscript') {
        return new Parser().parse(toParse, mode);
    }

    /**
     * Convenience function to subscribe to the `err` events emitted by `parser.events`.
     * @param errorHandler the function to call for every Parser error emitted after subscribing
     * @returns an object with a `dispose` function, used to unsubscribe from errors
     */
    public onError(errorHandler: (err: ParseError) => void) {
        this.events.on("err", errorHandler);
        return {
            dispose: () => {
                this.events.removeListener("err", errorHandler);
            },
        };
    }

    /**
     * Convenience function to subscribe to a single `err` event emitted by `parser.events`.
     * @param errorHandler the function to call for the first Parser error emitted after subscribing
     */
    public onErrorOnce(errorHandler: (err: ParseError) => void) {
        this.events.once("err", errorHandler);
    }

    /**
     * Parses an array of `Token`s into an abstract syntax tree that can be executed with the `Interpreter`.
     * @param toParse the array of tokens to parse
     * @returns an array of `Statement` objects that together form the abstract syntax tree of the
     *          program
     */
    parse(toParse: ReadonlyArray<Token>, mode: 'brightscript' | 'brighterscript' = 'brightscript'): ParseResults {
        let current = 0;
        let tokens = toParse;

        //the depth of the calls to function declarations. Helps some checks know if they are at the root or not.
        let functionDeclarationLevel = 0;

        function isAtRootLevel() {
            return functionDeclarationLevel === 0;
        }

        let statements: Statement[] = [];

        let errors: ParseError[] = [];

        /**
         * Add an error to the parse results.
         * @param token - the token where the error occurred
         * @param message - the message for this error
         * @param code - an error code used to uniquely identify this type of error.  Defaults to 1000
         * @returns an error object that can be thrown if the calling code needs to abort parsing
         */
        const addError = (token: Token, message: string, code = 1000) => {
            let err = new ParseError(token, message, code);
            errors.push(err);
            this.events.emit("err", err);
            return err;
        };

        /**
         * Wrapper around addError that extracts the properties from a diagnostic object
         * @param token 
         * @param diagnostic 
         */
        const addDiagnostic = (token: Token, diagnostic: DiagnosticMessage) => {
            return addError(token, diagnostic.message, diagnostic.code);
        }

        /**
         * Throws an error if the input file type is not BrighterScript
         */
        const ensureBrighterScriptMode = (featureName: string) => {
            if (mode !== 'brighterscript') {
                throw addDiagnostic(peek(), diagnosticMessages.Bs_feature_not_supported_in_brs_files_1019(featureName));
            }
        }

        /**
         * Add an error at the given location.
         * @param location
         * @param message
         */
        const addErrorAtLocation = (location: Location, message: string) => {
            addError({ location: location } as any, message);
        };

        if (toParse.length === 0) {
            return {
                statements: [],
                errors: [],
            };
        }

        try {
            while (!isAtEnd()) {
                let dec = declaration();
                if (dec) {
                    statements.push(dec);
                }
            }

            return { statements, errors };
        } catch (parseError) {
            return {
                statements: [],
                errors: errors,
            };
        }

        /**
         * A simple wrapper around `check` to make tests for a `end` identifier.
         * `end` is a keyword, but not reserved, so associative arrays can have properties
         * called `end`; the parser takes on this task.
         * @returns `true` if the next token is an identifier with text `end`, otherwise `false`
         */
        function checkEnd() {
            return check(Lexeme.Identifier) && peek().text.toLowerCase() === "end";
        }

        /**
         * Check if the next token is an `as` token
         * 'as' can be used as variable and property names, but is sometimes used like a keyword (function parameters, return values, etc...)
         * so the lexer handles it as an identifier
         */
        function checkAs() {
            return check(Lexeme.Identifier) && peek().text.toLowerCase() === "as";
        }

        function declaration(...additionalTerminators: BlockTerminator[]): Statement | undefined {
            try {
                // consume any leading newlines
                while (match(Lexeme.Newline));

                //TODO implement this in a future commit
                if (check(Lexeme.Class)) {
                    return classDeclaration();
                }

                if (check(Lexeme.Sub, Lexeme.Function)) {
                    return functionDeclaration(false);
                }

                if (checkLibrary()) {
                    return libraryStatement();
                }

                // BrightScript is like python, in that variables can be declared without a `var`,
                // `let`, (...) keyword. As such, we must check the token *after* an identifier to figure
                // out what to do with it.
                if (
                    check(Lexeme.Identifier, ...allowedIdentifiers) &&
                    checkNext(...assignmentOperators)
                ) {
                    return assignment(...additionalTerminators);
                }

                if (check(Lexeme.Comment)) {
                    let stmt = commentStatement();
                    //scrap consecutive newlines
                    while (match(Lexeme.Newline));
                    return stmt;
                }
                let nextThing = peek();
                nextThing = nextThing;

                return statement(...additionalTerminators);
            } catch (error) {
                synchronize();
                return;
            }
        }

        /**
         * A BrighterScript class declaration
         */
        function classDeclaration(): Stmt.ClassStatement {
            ensureBrighterScriptMode('class declarations');
            let keyword = consume(`Expected 'class' keyword`, Lexeme.Class);
            //get the class name
            let className = consumeContinue(diagnosticMessages.Missing_identifier_after_class_keyword_1016(), Lexeme.Identifier) as Identifier;
            //consume newlines (at least one)
            while (match(Lexeme.Newline));

            let members = [] as ClassMemberStatement[];
            //gather up all class members (Fields, Methods)
            while (check(Lexeme.Public, Lexeme.Protected, Lexeme.Private, Lexeme.Function, Lexeme.Sub, Lexeme.Identifier)) {
                try {
                    let accessModifier: Token;
                    if (check(Lexeme.Public, Lexeme.Protected, Lexeme.Private)) {
                        //use actual access modifier
                        accessModifier = advance();
                    } else {
                        accessModifier = {
                            isReserved: false,
                            kind: Lexeme.Public,
                            text: 'public',
                            //zero-length token which indicates derived
                            location: {
                                start: peek().location.start,
                                end: peek().location.start,
                                file: peek().location.file
                            }
                        };
                    }

                    //methods (function/sub keyword OR identifier followed by opening paren)
                    if (check(Lexeme.Function, Lexeme.Sub) || (check(Lexeme.Identifier) && checkNext(Lexeme.LeftParen))) {
                        let declaration = functionDeclaration(false);
                        members.push(
                            new ClassMethodStatement(
                                accessModifier,
                                declaration.name,
                                declaration.func
                            )
                        );

                        //fields
                    } else if (check(Lexeme.Identifier)) {
                        members.push(
                            classFieldDeclaration(accessModifier)
                        );
                    }
                } catch (e) {
                    //throw out any failed members and move on to the next line
                    consumeUntil(Lexeme.Newline, Lexeme.Eof);
                }

                //consume trailing newlines
                while (match(Lexeme.Newline));
            }

            //consume trailing newlines
            while (match(Lexeme.Newline));

            let endingKeyword = advance();
            if (endingKeyword.kind !== Lexeme.EndClass) {
                addError(
                    endingKeyword,
                    `Expected 'end class' to terminate class block`
                );
            }
            //consume any trailing newlines
            while (match(Lexeme.Newline));

            const result = new ClassStatement(
                keyword,
                className,
                members,
                endingKeyword
            );
            return result;
        }

        function classFieldDeclaration(accessModifier: Token | null) {
            let name = consume(`Expected identifier`, Lexeme.Identifier) as Identifier;
            let asToken: Token;
            let fieldType: Token;
            //look for `as SOME_TYPE`
            if (checkAs()) {
                asToken = advance();
                fieldType = advance();

                //no field type specified
                if (!ValueKind.fromString(`${fieldType.text}`) && !check(Lexeme.Identifier)) {
                    addDiagnostic(peek(), diagnosticMessages.Expected_valid_type_to_follow_as_keyword_1018());
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

        function functionDeclaration(isAnonymous: true): Expr.FunctionExpression;
        function functionDeclaration(isAnonymous: false): FunctionStatement;
        function functionDeclaration(isAnonymous: boolean) {
            try {
                //track depth to help certain statements need to know if they are contained within a function body
                functionDeclarationLevel++;
                let functionType: Token;
                if (check(Lexeme.Sub, Lexeme.Function)) {
                    functionType = advance();
                } else {
                    addDiagnostic(peek(), diagnosticMessages.Missing_function_sub_keyword_1017(peek().text));
                    functionType = {
                        isReserved: true,
                        kind: Lexeme.Function,
                        text: 'function',
                        //zero-length location means derived
                        location: {
                            start: peek().location.start,
                            end: peek().location.start,
                            file: peek().location.file
                        }
                    };
                }
                let isSub = functionType && functionType.kind === Lexeme.Sub;
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
                    leftParen = consume(
                        `Expected '(' after ${functionTypeText}`,
                        Lexeme.LeftParen
                    );
                } else {
                    name = consume(
                        `Expected ${functionTypeText} name after '${functionTypeText}'`,
                        Lexeme.Identifier
                    ) as Identifier;
                    leftParen = consume(
                        `Expected '(' after ${functionTypeText} name`,
                        Lexeme.LeftParen
                    );

                    //prevent functions from ending with type designators
                    let lastChar = name.text[name.text.length - 1];
                    if (["$", "%", "!", "#", "&"].includes(lastChar)) {
                        //don't throw this error; let the parser continue
                        addError(
                            name,
                            `Function name '${name.text}' cannot end with type designator '${lastChar}'`
                        );
                    }
                }

                let args: FunctionParameter[] = [];
                let asToken: Token;
                let typeToken: Token;
                if (!check(Lexeme.RightParen)) {
                    do {
                        if (args.length >= Expr.Call.MaximumArguments) {
                            throw addError(
                                peek(),
                                `Cannot have more than ${Expr.Call.MaximumArguments} parameters`
                            );
                        }

                        args.push(functionParameter());
                    } while (match(Lexeme.Comma));
                }
                let rightParen = advance();

                let maybeAs = peek();
                if (check(Lexeme.Identifier) && maybeAs.text.toLowerCase() === "as") {
                    asToken = advance();

                    typeToken = advance();
                    let typeString = typeToken.text || "";
                    let maybeReturnType = ValueKind.fromString(typeString);

                    if (!maybeReturnType) {
                        throw addError(
                            typeToken,
                            `Function return type '${typeString}' is invalid`
                        );
                    }

                    returnType = maybeReturnType;
                }

                args.reduce((haveFoundOptional: boolean, arg: Argument) => {
                    if (haveFoundOptional && !arg.defaultValue) {
                        throw addError(
                            {
                                kind: Lexeme.Identifier,
                                text: arg.name.text,
                                isReserved: ReservedWords.has(arg.name.text),
                                location: arg.location,
                            },
                            `Argument '${arg.name.text}' has no default value, but comes after arguments with default values`
                        );
                    }

                    return haveFoundOptional || !!arg.defaultValue;
                }, false);
                let comment: Stmt.CommentStatement;
                //get a comment if available
                if (check(Lexeme.Comment)) {
                    comment = commentStatement();
                }

                consume(
                    `Expected newline or ':' after ${functionTypeText} signature`,
                    Lexeme.Newline,
                    Lexeme.Colon
                );
                //support ending the function with `end sub` OR `end function`
                let body = block(Lexeme.EndSub, Lexeme.EndFunction);
                if (!body) {
                    throw addError(
                        peek(),
                        `Expected 'end ${functionTypeText}' to terminate ${functionTypeText} block`
                    );
                }
                //prepend comment to body
                if (comment) {
                    body.statements.unshift(comment);
                }
                // consume 'end sub' or 'end function'
                let endingKeyword = advance();
                let expectedEndKind = isSub ? Lexeme.EndSub : Lexeme.EndFunction;

                //if `function` is ended with `end sub`, or `sub` is ended with `end function`, then
                //add an error but don't hard-fail so the AST can continue more gracefully
                if (endingKeyword.kind !== expectedEndKind) {
                    addError(
                        endingKeyword,
                        `Expected 'end ${functionTypeText}' to terminate ${functionTypeText} block`
                    );
                }

                let func = new Expr.FunctionExpression(
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
                    while (match(Lexeme.Newline));
                    return new Stmt.FunctionStatement(name!, func);
                }
            } finally {
                functionDeclarationLevel--;
            }
        }

        function functionParameter(): FunctionParameter {
            if (!check(Lexeme.Identifier)) {
                throw addError(
                    peek(),
                    `Expected parameter name, but received '${peek().text || ""}'`
                );
            }

            let name = advance() as Identifier;
            let type: ValueKind = ValueKind.Dynamic;
            let typeToken: Token | undefined;
            let defaultValue;

            // parse argument default value
            if (match(Lexeme.Equal)) {
                // it seems any expression is allowed here -- including ones that operate on other arguments!
                defaultValue = expression();
            }

            let asToken = null;
            let next = peek();
            if (check(Lexeme.Identifier) && next.text && next.text.toLowerCase() === "as") {
                // 'as' isn't a reserved word, so it can't be lexed into an As token without the lexer
                // understanding language context.  That's less than ideal, so we'll have to do some
                // more intelligent comparisons to detect the 'as' sometimes-keyword here.
                asToken = advance();

                typeToken = advance();
                let typeValueKind = ValueKind.fromString(typeToken.text);

                if (!typeValueKind) {
                    throw addError(
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
                    location: typeToken ? typeToken.location : StdlibArgument.InternalLocation,
                },
                typeToken,
                defaultValue,
                asToken
            );
        }

        function assignment(...additionalterminators: Lexeme[]): Stmt.AssignmentStatement {
            let name = advance() as Identifier;
            //add error if name is a reserved word that cannot be used as an identifier
            if (disallowedIdentifiers.has(name.text.toLowerCase())) {
                //don't throw...this is fully recoverable
                addError(name, `Cannot use reserved word "${name.text}" as an identifier`);
            }
            let operator = consume(
                `Expected operator ('=', '+=', '-=', '*=', '/=', '\\=', '^=', '<<=', or '>>=') after idenfifier '${name.text}'`,
                ...assignmentOperators
            );

            let value = expression();
            if (!check(...additionalterminators, Lexeme.Comment)) {
                consume(
                    "Expected newline or ':' after assignment",
                    Lexeme.Newline,
                    Lexeme.Colon,
                    Lexeme.Eof,
                    ...additionalterminators
                );
            }

            if (operator.kind === Lexeme.Equal) {
                return new Stmt.AssignmentStatement({ equals: operator }, name, value);
            } else {
                return new Stmt.AssignmentStatement(
                    { equals: operator },
                    name,
                    new Expr.Binary(new Expr.Variable(name), operator, value)
                );
            }
        }

        function checkLibrary() {
            let isLibraryIdentifier =
                check(Lexeme.Identifier) && peek().text.toLowerCase() === "library";
            //if we are at the top level, any line that starts with "library" should be considered a library statement
            if (isAtRootLevel() && isLibraryIdentifier) {
                return true;
            }
            //not at root level, library statements are all invalid here, but try to detect if the tokens look
            //like a library statement (and let the libraryStatement function handle emitting the errors)
            else if (isLibraryIdentifier && checkNext(Lexeme.String)) {
                return true;
            }
            //definitely not a library statement
            else {
                return false;
            }
        }

        function statement(...additionalterminators: BlockTerminator[]): Statement | undefined {
            if (checkLibrary()) {
                return libraryStatement();
            }

            if (check(Lexeme.Stop)) {
                return stopStatement();
            }

            if (check(Lexeme.If)) {
                return ifStatement();
            }

            if (check(Lexeme.Print)) {
                return printStatement(...additionalterminators);
            }

            if (check(Lexeme.While)) {
                return whileStatement();
            }

            if (check(Lexeme.ExitWhile)) {
                return exitWhile();
            }

            if (check(Lexeme.For)) {
                return forStatement();
            }

            if (check(Lexeme.ForEach)) {
                return forEachStatement();
            }

            if (check(Lexeme.ExitFor)) {
                return exitFor();
            }

            if (checkEnd()) {
                return endStatement();
            }

            if (match(Lexeme.Return)) {
                return returnStatement();
            }

            if (check(Lexeme.Goto)) {
                return gotoStatement();
            }

            //does this line look like a label? (i.e.  `someIdentifier:` )
            if (check(Lexeme.Identifier) && checkNext(Lexeme.Colon)) {
                return labelStatement();
            }

            // TODO: support multi-statements
            return setStatement(...additionalterminators);
        }

        function whileStatement(): Stmt.WhileStatement {
            const whileKeyword = advance();
            const condition = expression();

            let comment: Stmt.CommentStatement;
            if (check(Lexeme.Comment)) {
                comment = commentStatement();
            }

            consume("Expected newline after 'while ...condition...'", Lexeme.Newline);
            const whileBlock = block(Lexeme.EndWhile);
            if (!whileBlock) {
                throw addError(peek(), "Expected 'end while' to terminate while-loop block");
            }

            //set comment as first statement in block
            if (comment) {
                whileBlock.statements.unshift(comment);
            }

            const endWhile = advance();
            while (match(Lexeme.Newline));

            return new Stmt.WhileStatement(
                { while: whileKeyword, endWhile: endWhile },
                condition,
                whileBlock
            );
        }

        function exitWhile(): Stmt.ExitWhile {
            let keyword = advance();
            consume("Expected newline after 'exit while'", Lexeme.Newline);
            while (match(Lexeme.Newline)) { }
            return new Stmt.ExitWhile({ exitWhile: keyword });
        }

        function forStatement(): Stmt.ForStatement {
            const forKeyword = advance();
            const initializer = assignment(Lexeme.To);
            const to = advance();
            const finalValue = expression();
            let increment: Expression | undefined;
            let step: Token | undefined;

            if (check(Lexeme.Step)) {
                step = advance();
                increment = expression();
            } else {
                // BrightScript for/to/step loops default to a step of 1 if no `step` is provided
                increment = new Expr.Literal(new Int32(1), peek().location);
            }
            while (match(Lexeme.Newline));

            let body = block(Lexeme.EndFor, Lexeme.Next);
            if (!body) {
                throw addError(peek(), "Expected 'end for' or 'next' to terminate for-loop block");
            }
            let endFor = advance();
            while (match(Lexeme.Newline));

            // WARNING: BrightScript doesn't delete the loop initial value after a for/to loop! It just
            // stays around in scope with whatever value it was when the loop exited.
            return new Stmt.ForStatement(
                {
                    for: forKeyword,
                    to: to,
                    step: step,
                    endFor: endFor,
                },
                initializer,
                finalValue,
                increment,
                body
            );
        }

        function forEachStatement(): Stmt.ForEachStatement {
            let forEach = advance();
            let name = advance();

            let maybeIn = peek();
            if (check(Lexeme.Identifier) && maybeIn.text.toLowerCase() === "in") {
                advance();
            } else {
                throw addError(maybeIn, "Expected 'in' after 'for each <name>'");
            }

            let target = expression();
            if (!target) {
                throw addError(peek(), "Expected target object to iterate over");
            }
            let comment: Stmt.CommentStatement;
            if (check(Lexeme.Comment)) {
                comment = commentStatement();
            }
            advance();
            while (match(Lexeme.Newline));

            let body = block(Lexeme.EndFor, Lexeme.Next);
            if (!body) {
                throw addError(peek(), "Expected 'end for' or 'next' to terminate for-loop block");
            }

            //add comment to beginning of block of avaiable
            if (comment) {
                body.statements.unshift(comment);
            }
            let endFor = advance();
            while (match(Lexeme.Newline));

            return new Stmt.ForEachStatement(
                {
                    forEach: forEach,
                    in: maybeIn,
                    endFor: endFor,
                },
                name,
                target,
                body
            );
        }

        function exitFor(): Stmt.ExitFor {
            let keyword = advance();
            consume("Expected newline after 'exit for'", Lexeme.Newline);
            while (match(Lexeme.Newline)) { }
            return new Stmt.ExitFor({ exitFor: keyword });
        }

        function commentStatement() {
            //if this comment is on the same line as the previous statement,
            //then this comment should be treated as a single-line comment
            let prev = previous();
            if (prev && prev.location.end.line === peek().location.start.line) {
                return new Stmt.CommentStatement([advance()]);
            } else {
                let comments = [advance()];
                while (check(Lexeme.Newline)) {
                    //absorb newlines
                    while (match(Lexeme.Newline));

                    //if this is a comment, and it's the next line down from the previous comment
                    if (check(Lexeme.Comment) && comments[comments.length - 1].location.end.line === peek().location.start.line - 1) {
                        comments.push(advance());
                    } else {
                        break;
                    }
                }
                return new Stmt.CommentStatement(comments);
            }
        }

        function libraryStatement(): Stmt.LibraryStatement | undefined {
            let libraryStatement = new Stmt.LibraryStatement({
                library: advance(),
                //grab the next token only if it's a string
                filePath: check(Lexeme.String) ? advance() : undefined,
            });

            //no token following library keyword token
            if (!libraryStatement.tokens.filePath && check(Lexeme.Newline, Lexeme.Colon)) {
                addErrorAtLocation(
                    libraryStatement.tokens.library.location,
                    `Missing string literal after ${libraryStatement.tokens.library.text} keyword`
                );
            }
            //does not have a string literal as next token
            else if (!libraryStatement.tokens.filePath && peek().kind === Lexeme.Newline) {
                addErrorAtLocation(
                    peek().location,
                    `Expected string literal after ${libraryStatement.tokens.library.text} keyword`
                );
            }

            //consume all tokens until the end of the line
            let invalidTokens = consumeUntil(Lexeme.Newline, Lexeme.Eof, Lexeme.Colon);

            if (invalidTokens.length > 0) {
                //add an error for every invalid token
                for (let invalidToken of invalidTokens) {
                    addErrorAtLocation(
                        invalidToken.location,
                        `Found unexpected token '${invalidToken.text}' after library statement`
                    );
                }
            }

            //libraries must be at the very top of the file before any other declarations.
            let isAtTopOfFile = true;
            for (let statement of statements) {
                //if we found a non-library statement, this statement is not at the top of the file
                if (!(statement instanceof Stmt.LibraryStatement)) {
                    isAtTopOfFile = false;
                }
            }

            //libraries must be a root-level statement (i.e. NOT nested inside of functions)
            if (!isAtRootLevel() || !isAtTopOfFile) {
                addErrorAtLocation(
                    libraryStatement.location,
                    "Library statements may only appear at the top of a file"
                );
            }
            //consume to the next newline, eof, or colon
            while (match(Lexeme.Newline, Lexeme.Eof, Lexeme.Colon));
            return libraryStatement;
        }

        function ifStatement(): Stmt.IfStatement {
            const ifToken = advance();
            const startingLine = ifToken.location;

            const condition = expression();
            let thenBranch: Stmt.Block;
            let elseIfBranches: Stmt.ElseIf[] = [];
            let elseBranch: Stmt.Block | undefined;

            let thenToken: Token | undefined;
            let elseIfTokens: Token[] = [];
            let endIfToken: Token | undefined;
            let elseToken: Token | undefined;

            /**
             * A simple wrapper around `check`, to make tests for a `then` identifier.
             * As with many other words, "then" is a keyword but not reserved, so associative
             * arrays can have properties called "then".  It's a valid identifier sometimes, so the
             * parser has to take on the burden of understanding that I guess.
             * @returns `true` if the next token is an identifier with text "then", otherwise `false`.
             */
            function checkThen() {
                return check(Lexeme.Identifier) && peek().text.toLowerCase() === "then";
            }

            if (checkThen()) {
                // `then` is optional after `if ...condition...`, so only advance to the next token if `then` is present
                thenToken = advance();
            }

            let comment: Stmt.CommentStatement;
            if (check(Lexeme.Comment)) {
                comment = commentStatement();
            }

            if (match(Lexeme.Newline) || match(Lexeme.Colon)) {
                //consume until no more colons
                while (check(Lexeme.Colon)) {
                    advance();
                }

                //consume exactly 1 newline, if found
                if (check(Lexeme.Newline)) {
                    advance();
                }

                //keep track of the current error count, because if the then branch fails,
                //we will trash them in favor of a single error on if
                let errorsLengthBeforeBlock = errors.length;

                // we're parsing a multi-line ("block") form of the BrightScript if/then/else and must find
                // a trailing "end if"

                let maybeThenBranch = block(Lexeme.EndIf, Lexeme.Else, Lexeme.ElseIf);
                if (!maybeThenBranch) {
                    //throw out any new errors created as a result of a `then` block parse failure.
                    //the block() function will discard the current line, so any discarded errors will
                    //resurface if they are legitimate, and not a result of a malformed if statement
                    errors.splice(errorsLengthBeforeBlock, errors.length - errorsLengthBeforeBlock);

                    //this whole if statement is bogus...add error to the if token and hard-fail
                    throw addError(
                        ifToken,
                        "Expected 'end if', 'else if', or 'else' to terminate 'then' block"
                    );
                }
                //add any comment from the same line as the if statement
                if (comment) {
                    maybeThenBranch.statements.unshift(comment);
                }
                let blockEnd = previous();
                if (blockEnd.kind === Lexeme.EndIf) {
                    endIfToken = blockEnd;
                }

                thenBranch = maybeThenBranch;
                match(Lexeme.Newline);

                // attempt to read a bunch of "else if" clauses
                while (check(Lexeme.ElseIf)) {
                    let elseIfToken = advance();
                    elseIfTokens.push(elseIfToken);
                    let elseIfCondition = expression();
                    let thenToken: Token;
                    if (checkThen()) {
                        // `then` is optional after `else if ...condition...`, so only advance to the next token if `then` is present
                        thenToken = advance();
                    }

                    //consume any trailing colons
                    while (check(Lexeme.Colon)) {
                        advance();
                    }

                    match(Lexeme.Newline);
                    let elseIfThen = block(Lexeme.EndIf, Lexeme.Else, Lexeme.ElseIf);
                    if (!elseIfThen) {
                        throw addError(
                            peek(),
                            "Expected 'end if', 'else if', or 'else' to terminate 'then' block"
                        );
                    }

                    let blockEnd = previous();
                    if (blockEnd.kind === Lexeme.EndIf) {
                        endIfToken = blockEnd;
                    }

                    elseIfBranches.push({
                        condition: elseIfCondition,
                        thenBranch: elseIfThen,
                        thenToken: thenToken,
                        elseIfToken: elseIfToken
                    });
                }

                if (match(Lexeme.Else)) {
                    elseToken = previous();
                    //consume any trailing colons
                    while (check(Lexeme.Colon)) {
                        advance();
                    }

                    match(Lexeme.Newline);
                    elseBranch = block(Lexeme.EndIf);
                    let endIfToken = advance(); // skip past "end if"

                    //ensure that single-line `if` statements have a colon right before 'end if'
                    if (ifToken.location.start.line === endIfToken.location.start.line) {
                        let index = tokens.indexOf(endIfToken);
                        let previousToken = tokens[index - 1];
                        if (previousToken.kind !== Lexeme.Colon) {
                            addError(endIfToken, "Expected ':' to preceed 'end if'");
                        }
                    }
                    match(Lexeme.Newline);
                } else {
                    match(Lexeme.Newline);
                    endIfToken = consume(
                        `Expected 'end if' to close 'if' statement started on line ${startingLine}`,
                        Lexeme.EndIf
                    );

                    //ensure that single-line `if` statements have a colon right before 'end if'
                    if (ifToken.location.start.line === endIfToken.location.start.line) {
                        let index = tokens.indexOf(endIfToken);
                        let previousToken = tokens[index - 1];
                        if (previousToken.kind !== Lexeme.Colon) {
                            addError(endIfToken, "Expected ':' to preceed 'end if'");
                        }
                    }
                    match(Lexeme.Newline);
                }
            } else {
                let thenStatement = declaration(Lexeme.ElseIf, Lexeme.Else);
                if (!thenStatement) {
                    throw addError(
                        peek(),
                        "Expected a statement to follow 'if ...condition... then'"
                    );
                }
                thenBranch = new Stmt.Block([thenStatement], peek().location);

                //add any comment from the same line as the if statement
                if (comment) {
                    thenBranch.statements.unshift(comment);
                }

                while (match(Lexeme.ElseIf)) {
                    let elseIf = previous();
                    let elseIfCondition = expression();
                    let thenToken: Token;
                    if (checkThen()) {
                        // `then` is optional after `else if ...condition...`, so only advance to the next token if `then` is present
                        thenToken = advance();
                    }

                    let elseIfThen = declaration(Lexeme.ElseIf, Lexeme.Else);
                    if (!elseIfThen) {
                        throw addError(
                            peek(),
                            `Expected a statement to follow '${elseIf.text} ...condition... then'`
                        );
                    }

                    elseIfBranches.push({
                        condition: elseIfCondition,
                        thenBranch: new Stmt.Block([elseIfThen], peek().location),
                        thenToken: thenToken,
                        elseIfToken: elseIf
                    });
                }
                if (match(Lexeme.Else)) {
                    elseToken = previous();
                    let elseStatement = declaration();
                    if (!elseStatement) {
                        throw addError(peek(), `Expected a statement to follow 'else'`);
                    }
                    elseBranch = new Stmt.Block([elseStatement], peek().location);
                }
            }

            return new Stmt.IfStatement(
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

        function setStatement(
            ...additionalTerminators: BlockTerminator[]
        ): Stmt.DottedSetStatement | Stmt.IndexedSetStatement | Stmt.ExpressionStatement | Stmt.IncrementStatement {
            /**
             * Attempts to find an expression-statement or an increment statement.
             * While calls are valid expressions _and_ statements, increment (e.g. `foo++`)
             * statements aren't valid expressions. They _do_ however fall under the same parsing
             * priority as standalone function calls though, so we can parse them in the same way.
             */
            function _expressionStatement(): Stmt.ExpressionStatement | Stmt.IncrementStatement {
                let expressionStart = peek();

                if (check(Lexeme.PlusPlus, Lexeme.MinusMinus)) {
                    let operator = advance();

                    if (check(Lexeme.PlusPlus, Lexeme.MinusMinus)) {
                        throw addError(
                            peek(),
                            "Consecutive increment/decrement operators are not allowed"
                        );
                    } else if (expr instanceof Expr.Call) {
                        throw addError(
                            expressionStart,
                            "Increment/decrement operators are not allowed on the result of a function call"
                        );
                    }

                    while (match(Lexeme.Newline, Lexeme.Colon));

                    return new Stmt.IncrementStatement(expr, operator);
                }

                if (!check(...additionalTerminators, Lexeme.Comment)) {
                    consume(
                        "Expected newline or ':' after expression statement",
                        Lexeme.Newline,
                        Lexeme.Colon,
                        Lexeme.Eof
                    );
                }

                if (expr instanceof Expr.Call) {
                    return new Stmt.ExpressionStatement(expr);
                }

                throw addError(
                    expressionStart,
                    "Expected statement or function call, but received an expression"
                );
            }

            let expr = call();
            if (check(...assignmentOperators) && !(expr instanceof Expr.Call)) {
                let left = expr;
                let operator = advance();
                let right = expression();

                // Create a dotted or indexed "set" based on the left-hand side's type
                if (left instanceof Expr.IndexedGetExpression) {
                    consume(
                        "Expected newline or ':' after indexed 'set' statement",
                        Lexeme.Newline,
                        Lexeme.Colon,
                        Lexeme.Eof
                    );

                    return new Stmt.IndexedSetStatement(
                        left.obj,
                        left.index,
                        operator.kind === Lexeme.Equal
                            ? right
                            : new Expr.Binary(left, operator, right),
                        left.openingSquare,
                        left.closingSquare
                    );
                } else if (left instanceof Expr.DottedGet) {
                    consume(
                        "Expected newline or ':' after dotted 'set' statement",
                        Lexeme.Newline,
                        Lexeme.Colon,
                        Lexeme.Eof
                    );

                    return new Stmt.DottedSetStatement(
                        left.obj,
                        left.name,
                        operator.kind === Lexeme.Equal
                            ? right
                            : new Expr.Binary(left, operator, right)
                    );
                } else {
                    return _expressionStatement();
                }
            } else {
                return _expressionStatement();
            }
        }

        function printStatement(...additionalterminators: BlockTerminator[]): Stmt.PrintStatement {
            let printKeyword = advance();

            let values: (
                | Expr.Expression
                | Stmt.PrintSeparator.Tab
                | Stmt.PrintSeparator.Space)[] = [];

            //print statements can be empty, so look for empty print conditions
            if (isAtEnd() || check(Lexeme.Newline, Lexeme.Colon)) {
                let emptyStringLiteral = new Expr.Literal(new BrsString(""), printKeyword.location);
                values.push(emptyStringLiteral);
            } else {
                values.push(expression());
            }

            while (!check(Lexeme.Newline, Lexeme.Colon, ...additionalterminators, Lexeme.Comment) && !isAtEnd()) {
                if (check(Lexeme.Semicolon)) {
                    values.push(advance() as Stmt.PrintSeparator.Space);
                }

                if (check(Lexeme.Comma)) {
                    values.push(advance() as Stmt.PrintSeparator.Tab);
                }

                if (!check(Lexeme.Newline, Lexeme.Colon) && !isAtEnd()) {
                    values.push(expression());
                }
            }

            if (!check(...additionalterminators, Lexeme.Comment)) {
                consume(
                    "Expected newline or ':' after printed values",
                    Lexeme.Newline,
                    Lexeme.Colon,
                    Lexeme.Eof
                );
            }

            return new Stmt.PrintStatement({ print: printKeyword }, values);
        }

        /**
         * Parses a return statement with an optional return value.
         * @returns an AST representation of a return statement.
         */
        function returnStatement(): Stmt.Return {
            let tokens = { return: previous() };

            if (check(Lexeme.Colon, Lexeme.Newline, Lexeme.Eof)) {
                while (match(Lexeme.Colon, Lexeme.Newline, Lexeme.Eof));
                return new Stmt.Return(tokens);
            }

            let toReturn = expression();
            while (match(Lexeme.Newline, Lexeme.Colon));

            return new Stmt.Return(tokens, toReturn);
        }

        /**
         * Parses a `label` statement
         * @returns an AST representation of an `label` statement.
         */
        function labelStatement() {
            let tokens = {
                identifier: advance(),
                colon: advance(),
            };

            consume("Labels must be declared on their own line", Lexeme.Newline, Lexeme.Eof);

            return new Stmt.Label(tokens);
        }

        /**
         * Parses a `goto` statement
         * @returns an AST representation of an `goto` statement.
         */
        function gotoStatement() {
            let tokens = {
                goto: advance(),
                label: consume("Expected label identifier after goto keyword", Lexeme.Identifier),
            };

            while (match(Lexeme.Newline, Lexeme.Colon));

            return new Stmt.Goto(tokens);
        }

        /**
         * Parses an `end` statement
         * @returns an AST representation of an `end` statement.
         */
        function endStatement() {
            let tokens = { end: advance() };

            while (match(Lexeme.Newline));

            return new Stmt.End(tokens);
        }
        /**
         * Parses a `stop` statement
         * @returns an AST representation of a `stop` statement
         */
        function stopStatement() {
            let tokens = { stop: advance() };

            while (match(Lexeme.Newline, Lexeme.Colon));

            return new Stmt.Stop(tokens);
        }

        /**
         * Parses a block, looking for a specific terminating Lexeme to denote completion.
         * @param terminators the token(s) that signifies the end of this block; all other terminators are
         *                    ignored.
         */
        function block(...terminators: BlockTerminator[]): Stmt.Block | undefined {
            let startingToken = peek();

            const statements: Statement[] = [];
            while (!check(...terminators) && !isAtEnd()) {
                //grab the location of the current token
                let loopCurrent = current;
                let dec = declaration();

                if (dec) {
                    statements.push(dec);
                } else {
                    //something went wrong. reset to the top of the loop
                    current = loopCurrent;

                    //scrap the entire line
                    consumeUntil(Lexeme.Colon, Lexeme.Newline, Lexeme.Eof);

                    //trash the newline character so we start the next iteraion on the next line
                    advance();
                }
            }

            if (isAtEnd()) {
                return undefined;
                // TODO: Figure out how to handle unterminated blocks well
            }

            return new Stmt.Block(statements, startingToken.location);
        }

        function expression(): Expression {
            return anonymousFunction();
        }

        function anonymousFunction(): Expression {
            if (check(Lexeme.Sub, Lexeme.Function)) {
                return functionDeclaration(true);
            }

            return boolean();
        }

        function boolean(): Expression {
            let expr = relational();

            while (match(Lexeme.And, Lexeme.Or)) {
                let operator = previous();
                let right = relational();
                expr = new Expr.Binary(expr, operator, right);
            }

            return expr;
        }

        function relational(): Expression {
            let expr = additive();

            while (
                match(
                    Lexeme.Equal,
                    Lexeme.LessGreater,
                    Lexeme.Greater,
                    Lexeme.GreaterEqual,
                    Lexeme.Less,
                    Lexeme.LessEqual
                )
            ) {
                let operator = previous();
                let right = additive();
                expr = new Expr.Binary(expr, operator, right);
            }

            return expr;
        }

        // TODO: bitshift

        function additive(): Expression {
            let expr = multiplicative();

            while (match(Lexeme.Plus, Lexeme.Minus)) {
                let operator = previous();
                let right = multiplicative();
                expr = new Expr.Binary(expr, operator, right);
            }

            return expr;
        }

        function multiplicative(): Expression {
            let expr = exponential();

            while (match(Lexeme.Slash, Lexeme.Backslash, Lexeme.Star, Lexeme.Mod)) {
                let operator = previous();
                let right = exponential();
                expr = new Expr.Binary(expr, operator, right);
            }

            return expr;
        }

        function exponential(): Expression {
            let expr = prefixUnary();

            while (match(Lexeme.Caret)) {
                let operator = previous();
                let right = prefixUnary();
                expr = new Expr.Binary(expr, operator, right);
            }

            return expr;
        }

        function prefixUnary(): Expression {
            if (match(Lexeme.Not, Lexeme.Minus)) {
                let operator = previous();
                let right = prefixUnary();
                return new Expr.Unary(operator, right);
            }

            return call();
        }

        function call(): Expression {
            let expr = primary();

            while (true) {
                if (match(Lexeme.LeftParen)) {
                    expr = finishCall(previous(), expr);
                } else if (match(Lexeme.LeftSquare)) {
                    let openingSquare = previous();
                    while (match(Lexeme.Newline));

                    let index = expression();

                    while (match(Lexeme.Newline));
                    let closingSquare = consume(
                        "Expected ']' after array or object index",
                        Lexeme.RightSquare
                    );

                    expr = new Expr.IndexedGetExpression(expr, index, openingSquare, closingSquare);
                } else if (match(Lexeme.Dot)) {
                    while (match(Lexeme.Newline));

                    let name = consume(
                        "Expected property name after '.'",
                        Lexeme.Identifier,
                        ...allowedProperties
                    );

                    // force it into an identifier so the AST makes some sense
                    name.kind = Lexeme.Identifier;

                    expr = new Expr.DottedGet(expr, name as Identifier);
                } else {
                    break;
                }
            }

            return expr;
        }

        function finishCall(openingParen: Token, callee: Expression): Expression {
            let args = [] as Expression[];
            while (match(Lexeme.Newline));

            if (!check(Lexeme.RightParen)) {
                do {
                    while (match(Lexeme.Newline));

                    if (args.length >= Expr.Call.MaximumArguments) {
                        throw addError(
                            peek(),
                            `Cannot have more than ${Expr.Call.MaximumArguments} arguments`
                        );
                    }
                    args.push(expression());
                } while (match(Lexeme.Comma));
            }

            while (match(Lexeme.Newline));
            const closingParen = consume(
                "Expected ')' after function call arguments",
                Lexeme.RightParen
            );

            return new Expr.Call(callee, openingParen, closingParen, args);
        }

        function primary(): Expression {
            switch (true) {
                case match(Lexeme.False):
                    return new Expr.Literal(BrsBoolean.False, previous().location);
                case match(Lexeme.True):
                    return new Expr.Literal(BrsBoolean.True, previous().location);
                case match(Lexeme.Invalid):
                    return new Expr.Literal(BrsInvalid.Instance, previous().location);
                case match(
                    Lexeme.Integer,
                    Lexeme.LongInteger,
                    Lexeme.Float,
                    Lexeme.Double,
                    Lexeme.String
                ):
                    return new Expr.Literal(previous().literal!, previous().location);
                case match(Lexeme.Identifier):
                    return new Expr.Variable(previous() as Identifier);
                case match(Lexeme.LeftParen):
                    let left = previous();
                    let expr = expression();
                    let right = consume(
                        "Unmatched '(' - expected ')' after expression",
                        Lexeme.RightParen
                    );
                    return new Expr.Grouping({ left, right }, expr);
                case match(Lexeme.LeftSquare):
                    let elements: Expression[] = [];
                    let openingSquare = previous();

                    while (match(Lexeme.Newline));

                    if (!match(Lexeme.RightSquare)) {
                        elements.push(expression());

                        while (match(Lexeme.Comma, Lexeme.Newline)) {
                            while (match(Lexeme.Newline));

                            if (check(Lexeme.RightSquare)) {
                                break;
                            }

                            elements.push(expression());
                        }

                        consume(
                            "Unmatched '[' - expected ']' after array literal",
                            Lexeme.RightSquare
                        );
                    }

                    let closingSquare = previous();

                    //consume("Expected newline or ':' after array literal", Lexeme.Newline, Lexeme.Colon, Lexeme.Eof);
                    return new Expr.ArrayLiteralExpression(elements, openingSquare, closingSquare);
                case match(Lexeme.LeftBrace):
                    let openingBrace = previous();
                    let members: Array<Expr.AAMember | Stmt.CommentStatement> = [];

                    var key = () => {
                        let result = {
                            colonToken: null as Token,
                            keyToken: null as Token,
                            key: null as BrsString
                        };
                        if (check(Lexeme.Identifier, ...allowedProperties)) {
                            result.keyToken = advance();
                            result.key = new BrsString(result.keyToken.text!);
                        } else if (check(Lexeme.String)) {
                            result.keyToken = advance();
                            result.key = result.keyToken.literal! as BrsString;
                        } else {
                            throw addError(
                                peek(),
                                `Expected identifier or string as associative array key, but received '${peek()
                                    .text || ""}'`
                            );
                        }

                        result.colonToken = consume(
                            "Expected ':' between associative array key and value",
                            Lexeme.Colon
                        );
                        return result;
                    }

                    while (match(Lexeme.Newline));

                    if (!match(Lexeme.RightBrace)) {
                        if (check(Lexeme.Comment)) {
                            members.push(advance() as any);
                        } else {
                            let k = key();
                            members.push({
                                key: k.key,
                                keyToken: k.keyToken,
                                colonToken: k.colonToken,
                                value: expression(),
                            });
                        }

                        while (match(Lexeme.Comma, Lexeme.Newline, Lexeme.Colon)) {
                            if (check(Lexeme.Comment)) {
                                members.push(advance() as any);
                            } else {
                                while (match(Lexeme.Newline, Lexeme.Colon));

                                if (check(Lexeme.RightBrace)) {
                                    break;
                                }
                                let k = key();
                                members.push({
                                    key: k.key,
                                    keyToken: k.keyToken,
                                    colonToken: k.colonToken,
                                    value: expression(),
                                });
                            }
                        }

                        consume(
                            "Unmatched '{' - expected '}' after associative array literal",
                            Lexeme.RightBrace
                        );
                    }

                    let closingBrace = previous();

                    return new Expr.AALiteralExpression(members, openingBrace, closingBrace);
                case match(Lexeme.Pos, Lexeme.Tab):
                    let token = Object.assign(previous(), {
                        kind: Lexeme.Identifier,
                    }) as Identifier;
                    return new Expr.Variable(token);
                case check(Lexeme.Function, Lexeme.Sub):
                    return anonymousFunction();
                default:
                    throw addError(peek(), `Found unexpected token '${peek().text}'`);
            }
        }

        /**
         * Pop tokens until we encounter a token not in the specified list
         * @param lexemes 
         */
        function match(...lexemes: Lexeme[]) {
            for (let lexeme of lexemes) {
                if (check(lexeme)) {
                    advance();
                    return true;
                }
            }

            return false;
        }

        /**
         * Consume tokens until one of the `stopLexemes` is encountered
         * @param lexemes
         * @return - the list of tokens consumed, EXCLUDING the `stopLexeme` (you can use `peek()` to see which one it was)
         */
        function consumeUntil(...stopLexemes: Lexeme[]) {
            let result = [] as Token[];
            //take tokens until we encounter one of the stopLexemes
            while (!stopLexemes.includes(peek().kind)) {
                result.push(advance());
            }
            return result;
        }

        function consume(errorMessage: string | DiagnosticMessage, ...lexemes: Lexeme[]): Token {
            let diagnostic = typeof errorMessage === 'string' ? { message: errorMessage, code: 1000 } : errorMessage;
            let foundLexeme = lexemes
                .map(lexeme => peek().kind === lexeme)
                .reduce((foundAny, foundCurrent) => foundAny || foundCurrent, false);

            if (foundLexeme) {
                return advance();
            }
            throw addError(peek(), diagnostic.message, diagnostic.code);
        }

        /**
         * Consume, or add a message if not found. But then continue and return undefined
         * @param message 
         * @param lexemes 
         */
        function consumeContinue(diagnostic: DiagnosticMessage, ...lexemes: Lexeme[]): Token | undefined {
            try {
                return consume(diagnostic, ...lexemes);
            } catch (e) {
                //do nothing;
            }
        }

        function advance(): Token {
            if (!isAtEnd()) {
                current++;
            }
            return previous();
        }

        function check(...lexemes: Lexeme[]) {
            if (isAtEnd()) {
                return false;
            }

            return lexemes.some(lexeme => peek().kind === lexeme);
        }

        function checkNext(...lexemes: Lexeme[]) {
            if (isAtEnd()) {
                return false;
            }

            return lexemes.some(lexeme => peekNext().kind === lexeme);
        }

        function isAtEnd() {
            return peek().kind === Lexeme.Eof;
        }

        function peekNext() {
            if (isAtEnd()) {
                return peek();
            }
            return tokens[current + 1];
        }

        function peek() {
            return tokens[current];
        }

        function previous() {
            return tokens[current - 1];
        }

        function synchronize() {
            advance(); // skip the erroneous token

            while (!isAtEnd()) {
                if (previous().kind === Lexeme.Newline || previous().kind === Lexeme.Colon) {
                    // newlines and ':' characters separate statements
                    return;
                }

                switch (peek().kind) {
                    case Lexeme.Function:
                    case Lexeme.Sub:
                    case Lexeme.If:
                    case Lexeme.For:
                    case Lexeme.ForEach:
                    case Lexeme.While:
                    case Lexeme.Print:
                    case Lexeme.Return:
                        // start parsing again from the next block starter or obvious
                        // expression start
                        return;
                }

                advance();
            }
        }
    }
}
