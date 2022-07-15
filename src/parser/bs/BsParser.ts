import type { DiagnosticSeverity } from 'vscode-languageserver';
import type { DiagnosticInfo } from '../../DiagnosticMessages';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Lexer } from '../../lexer/Lexer';
import type { Token } from '../../lexer/Token';
import { AllowedLocalIdentifiers, AssignmentOperators, BrighterScriptSourceLiterals, DisallowedLocalIdentifiersText, TokenKind } from '../../lexer/TokenKind';
import { Logger } from '../../Logger';

export class BsParser {
    constructor(
        private options: ParseOptions
    ) {
        this.options = this.sanitizeParseOptions(options);
    }

    private logger: Logger;

    public ast: Node;

    private tokens: Token[];

    /**
     * The current token index
     */
    public current: number;

    /**
     * Get the currently active global terminators
     */
    private get globalTerminators() {
        return this.globalTerminatorsStack[this.globalTerminatorsStack.length - 1] ?? [];
    }

    private globalTerminatorsStack = [] as TokenKind[][];

    /**
     * A list of identifiers that are permitted to be used as local variables. We store this in a property because we augment the list in the constructor
     * based on the parse mode
     */
    private allowedLocalIdentifiers: TokenKind[];

    /**
     * Static wrapper around creating a new parser and parsing a list of tokens
     */
    public static parse(toParse: Token[] | string, options?: ParseOptions): BsParser {
        return new BsParser(options).parse(toParse, options);
    }

    /**
     * Parses an array of `Token`s into an abstract syntax tree
     * @param toParse the array of tokens to parse. May not contain any whitespace tokens
     * @returns the same instance of the parser which contains the diagnostics and statements
     */
    public parse(toParse: Token[] | string, options?: ParseOptions) {
        if (typeof toParse === 'string') {
            this.tokens = Lexer.scan(toParse).tokens;
        } else {
            this.tokens = toParse;
        }
        this.logger = options?.logger ?? new Logger();
        this.options = this.sanitizeParseOptions(options);
        this.allowedLocalIdentifiers = [
            ...AllowedLocalIdentifiers,
            //when in plain brightscript mode, the BrighterScript source literals can be used as regular variables
            ...(this.options.mode === ParseMode.BrightScript ? BrighterScriptSourceLiterals : [])
        ];
        this.current = 0;
        this.ast = this.body();
        return this;
    }

    private body() {
        this.startNode(false);
        try {
            while (
                //not at end of tokens
                !this.isAtEnd() &&
                //the next token is not one of the end terminators
                !this.check(...this.globalTerminators)
            ) {
                this.consumeManyRaw(TokenKind.Whitespace, TokenKind.Comment, TokenKind.Newline);
                let dec = this.declaration();
                if (dec) {
                    this.children.push(dec);
                    this.consumeStatementSeparators(true);
                    //     if (!isAnnotationExpression(dec)) {
                    //         this.consumePendingAnnotations(dec);
                    //         body.children.push(dec);
                    //         //ensure statement separator
                    //         this.consumeStatementSeparators(false);
                    //     } else {
                    //         this.consumeStatementSeparators(true);
                    //     }
                    continue;
                }
                if (!this.isAtEnd()) {
                    //if we got here, something is wrong. Flag the current token and move on
                    this.unexpectedToken();
                }
            }
        } catch (parseError) {
            if ((parseError as ParseError).code) {
                this.children.push(parseError as ParseError);
            }
        }
        return this.finishNode(NodeType.Body);
    }

    private consumeStatementSeparators(optional = false) {
        //a comment or EOF mark the end of the statement
        if (this.isAtEnd() || this.check(TokenKind.Comment)) {
            return true;
        }
        let consumed = false;
        //consume any newlines and colons
        while (this.consume(TokenKind.Newline, TokenKind.Colon)) {
            consumed = true;
        }
        if (!optional && !consumed) {
            // this.diagnostics.push({
            //     ...DiagnosticMessages.expectedNewlineOrColon(),
            //     range: this.peek().range
            // });
        }
        return consumed;
    }

    private declaration(): Node | undefined {
        try {
            // if (this.checkLibrary()) {
            //     return this.libraryStatement();
            // }

            // if (this.check(TokenKind.At) && this.checkNext(TokenKind.Identifier)) {
            //     return this.annotationExpression();
            // }

            // if (this.check(TokenKind.Comment)) {
            //     return this.commentStatement();
            // }

            // //catch certain global terminators to prevent unnecessary lookahead (i.e. like `end namespace`, no need to continue)
            // if (this.checkAny(...this.peekGlobalTerminators())) {
            //     return;
            // }

            //no declarations were found. Look for statements now
            return this.statement();
        } catch (error: any) {
            //if the error is not a diagnostic, then log the error for debugging purposes
            if (!(error as unknown as any).isDiagnostic) {
                this.logger.error(error);
            }
            // this.synchronize();
        }
    }

    private statement() {
        // variables can be declared without a `var`, `let`, (...) keyword.
        // As such, we must check the token *after* an identifier to figure out what to do with it.
        if (
            this.check(TokenKind.Identifier, ...this.allowedLocalIdentifiers) &&
            this.checkNext(...AssignmentOperators)
        ) {
            return this.assignmentStatement();
        } else if (
            this.check(TokenKind.Library) &&
            this.checkNext(TokenKind.StringLiteral)
        ) {
            return this.libraryStatement();
        } else if (this.check(TokenKind.Stop)) {
            return this.stopStatement();
        }
    }

    private expression() {
        if (
            this.check(
                TokenKind.False,
                TokenKind.True,
                TokenKind.Invalid,
                TokenKind.IntegerLiteral,
                TokenKind.LongIntegerLiteral,
                TokenKind.FloatLiteral,
                TokenKind.DoubleLiteral,
                TokenKind.StringLiteral
            )
        ) {
            return this.literalExpression();
        }
    }

    /**
     * A literal value, such as `true` or `"some string"`
     */
    private literalExpression() {
        this.startNode();
        this.advance();
        return this.finishNode(NodeType.LiteralExpression);
    }

    /**
     * Starts a new syntax node.
     */
    private startNode(consumeLeadingWhitespaceBeforeStart = true) {
        //add any leading whitespace to the previous child
        if (consumeLeadingWhitespaceBeforeStart) {
            this.consumeManyRaw(TokenKind.Whitespace);
        }
        this.children = [];
        this.nodeStack.push(this.children);
    }

    /**
     * Finalizes a node, pops its children from the stack, and returns it
     */
    private finishNode(nodeType: string) {
        const result = new Node(nodeType, this.nodeStack.pop());
        this.children = this.nodeStack[this.nodeStack.length - 1];
        return result;
    }
    /**
     * A collection of node children. Pushed to every time `startNode` is called,
     * and popped every time `finishNode` is called
     */
    private nodeStack: Array<NodeChild[]> = [];

    /**
     * The `children` array for the current node
     */
    private children: NodeChild[];

    private assignmentStatement(): Node | undefined {
        this.startNode();
        this.consumeIdentifierOrThrow(...this.allowedLocalIdentifiers);
        //add diagnostic if name is a reserved word that cannot be used as an identifier
        //TODO this should be done in SyntaxAnalyzer
        // if (DisallowedLocalIdentifiersText.has((name as Token)?.text.toLowerCase())) {
        //     children.push({
        //         ...DiagnosticMessages.cannotUseReservedWordAsIdentifier((name as Token).text)
        //     });
        // }

        this.consumeOrThrow(
            DiagnosticMessages.expectedOperatorAfterIdentifier(AssignmentOperators),
            ...AssignmentOperators
        );
        this.children.push(
            this.expression()
        );
        return this.finishNode(NodeType.AssignmentStatement);
    }

    private libraryStatement(): Node {
        this.startNode();
        this.consume(TokenKind.Library);
        this.consume(TokenKind.StringLiteral);
        return this.finishNode(NodeType.LibraryStatement);
    }

    private stopStatement() {
        this.startNode();
        this.consume(TokenKind.Stop);
        return this.finishNode(NodeType.StopStatement);
    }

    /**
     * Move the current token index to the next non-whitespace token
     */
    private advance() {
        if (!this.isAtEnd()) {
            //get the next concrete token (and any leading trivia tokens)
            const tokens = this.getConcreteToken(1);
            this.current += tokens.length;
            this.children.push(...tokens);
        }
    }

    /**
     * Peek at the previous token (including whitespace tokens)
     */
    private peekPreviousRaw() {
        return this.tokens[this.current - 1];
    }

    /**
     * Flag the current token as unexpected
     */
    private unexpectedToken() {
        this.advance();
        this.children.push({
            ...DiagnosticMessages.unexpectedToken(this.peekPreviousRaw().text)
        });
    }

    /**
     * Get the next non-trivia token (and any leading trivia tokens)
     * @param count 1 means the next non-trivia token. 2 means the second non-trivia token, etc.
     */
    private getConcreteToken(step: 1 | 2 | 3 | 4 | 5): Token[] {
        const tokens = [];
        let currentStep = 0;
        for (let i = this.current; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            tokens.push(token);
            if (token.kind !== TokenKind.Whitespace) {
                currentStep++;
            }
            if (currentStep === step) {
                return tokens;
            }
        }
    }

    /**
     * Get the next non-whitespace token, but don't modify the current index
     */
    private peek() {
        return this.getConcreteToken(1).pop();
    }

    /**
     * Get the next-next non-whitespace token, but don't modify the current index
     */
    private peekNext() {
        return this.getConcreteToken(2).pop();
    }

    /**
     * Is the next non-whitespace token one of the supplied types
     */
    private check(...tokenKinds: TokenKind[]): boolean {
        return tokenKinds.includes(this.getConcreteToken(1).pop()?.kind);
    }

    /**
     * Is the next-next non-whitespace token one of the supplied types
     */
    private checkNext(...tokenKinds: TokenKind[]): boolean {
        return tokenKinds.includes(this.getConcreteToken(2).pop()?.kind);
    }

    /**
     * Is at the end of the tokens list
     */
    private isAtEnd(): boolean {
        return this.peek().kind === TokenKind.Eof;
    }

    /**
     * Consumes tokens until a non-listed token kind is encountered.
     * Whitespace tokens are NOT ignored in this function
     */
    private consumeManyRaw(...tokenKinds: TokenKind[]) {
        for (let i = this.current; i < this.tokens.length; i++) {
            const token = this.tokens[i];
            if (tokenKinds.includes(token.kind)) {
                this.children.push(token);
                this.current++;
            } else {
                break;
            }
        }
    }

    /**
     * Consumes a token if it matches one of the supplied TokenKinds
     */
    private consume(...tokenKinds: TokenKind[]) {
        const tokens = this.getConcreteToken(1);
        if (tokenKinds.includes(tokens[tokens.length - 1]?.kind)) {
            this.children.push(...tokens);
            this.current += tokens.length;
            return true;
        }
        return false;
    }

    /**
     * Consumes tokens until a non-listed token kind is encountered.
     */
    private consumeMany(...tokenKinds: TokenKind[]) {
        while (this.consume(...tokenKinds)) { }
    }

    /**
     * Get next token matching a specified list (and any leading whitespace tokens).
     * @throws `ParseError` if not found
     */
    private consumeOrThrow(diagnosticInfo: DiagnosticInfo, ...tokenKinds: TokenKind[]) {
        const nextKind = this.peek().kind;
        let foundTokenKind = tokenKinds.some(tokenKind => nextKind === tokenKind);

        if (foundTokenKind) {
            this.advance();
        } else {
            throw diagnosticInfo;
        }
    }

    /**
     * Consume an identifier, or throw an exception if an identifier wasn't found
     */
    private consumeIdentifierOrThrow(...additionalTokenKinds: TokenKind[]) {
        this.consumeOrThrow(
            DiagnosticMessages.expectedIdentifier(),
            TokenKind.Identifier,
            ...additionalTokenKinds
        );
        const identifier = this.children[this.children.length - 1];
        // force the name into an identifier so the AST makes some sense
        if ((identifier as Token).kind) {
            (identifier as Token).kind = TokenKind.Identifier;
        }
    }

    private sanitizeParseOptions(options: ParseOptions) {
        return {
            mode: 'brightscript',
            ...(options || {})
        } as ParseOptions;
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

export type NodeChild = Node | Token | ParseError;

export class Node {
    constructor(
        public type: string,
        public children: NodeChild[]
    ) {
    }
}

/**
 * An error found during parsing. This will be attached to the node/token following the ParseError
 */
export interface ParseError {
    message: string;
    code: number;
    severity: DiagnosticSeverity;
}

export function isParseError(item: any): item is ParseError {
    return item?.constructor.name === 'XmlScope';
}

export enum NodeType {
    Body = 'Body',
    //statements
    AssignmentStatement = 'AssignmentStatement',
    LibraryStatement = 'LibraryStatement',
    StopStatement = 'StopStatement',

    //expressions
    AALiteralExpression = 'AALiteralExpression',
    LiteralExpression = 'LiteralExpression'

}
