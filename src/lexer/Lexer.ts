/* eslint-disable func-names */
import { TokenKind, ReservedWords, Keywords, PreceedingRegexTypes } from './TokenKind';
import type { Token } from './Token';
import { isAlpha, isDecimalDigit, isAlphaNumeric, isHexDigit } from './Characters';
import type { Range, Diagnostic } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import util from '../util';

export class Lexer {
    /**
     * The zero-indexed position at which the token under consideration begins.
     */
    private start: number;

    /**
     * The zero-indexed position being examined for the token under consideration.
     */
    private current: number;

    /**
     * The zero-indexed begin line number being parsed.
     */
    private lineBegin: number;

    /**
     * The zero-indexed end line number being parsed
     */
    private lineEnd: number;

    /**
     * The zero-indexed begin column number being parsed.
     */
    private columnBegin: number;

    /**
     * The zero-indexed end column number being parsed
     */
    private columnEnd: number;

    /**
     * The BrightScript code being converted to an array of `Token`s.
     */
    public source: string;

    /**
     * The tokens produced from `source`.
     */
    public tokens: Token[];

    /**
     * The errors produced from `source.`
     */
    public diagnostics: Diagnostic[];

    /**
     * The options used to scan this file
     */
    public options: ScanOptions;

    /**
     * Contains all of the leading whitespace that has not yet been consumed by a token
     */
    private leadingWhitespace = '';

    /**
     * A convenience function, equivalent to `new Lexer().scan(toScan)`, that converts a string
     * containing BrightScript code to an array of `Token` objects that will later be used to build
     * an abstract syntax tree.
     *
     * @param toScan the BrightScript code to convert into tokens
     * @param options options used to customize the scan process
     * @returns an object containing an array of `errors` and an array of `tokens` to be passed to a parser.
     */
    static scan(toScan: string, options?: ScanOptions): Lexer {
        return new Lexer().scan(toScan, options);
    }

    /**
     * Converts a string containing BrightScript code to an array of `Token` objects that will
     * later be used to build an abstract syntax tree.
     *
     * @param toScan the BrightScript code to convert into tokens
     * @param options options used to customize the scan process
     * @returns an object containing an array of `errors` and an array of `tokens` to be passed to a parser.
     */
    public scan(toScan: string, options?: ScanOptions): this {
        this.source = toScan;
        this.options = this.sanitizeOptions(options);
        this.start = 0;
        this.current = 0;
        this.lineBegin = 0;
        this.lineEnd = 0;
        this.columnBegin = 0;
        this.columnEnd = 0;
        this.tokens = [];
        this.diagnostics = [];
        while (!this.isAtEnd()) {
            this.scanToken();
        }

        this.tokens.push({
            kind: TokenKind.Eof,
            isReserved: false,
            text: '',
            range: util.createRange(this.lineBegin, this.columnBegin, this.lineEnd, this.columnEnd + 1),
            leadingWhitespace: this.leadingWhitespace
        });
        this.leadingWhitespace = '';
        return this;
    }

    /**
     * Fill in missing/invalid options with defaults
     */
    private sanitizeOptions(options: ScanOptions) {
        return {
            includeWhitespace: false,
            ...options
        } as ScanOptions;
    }

    /**
     * Determines whether or not the lexer as reached the end of its input.
     * @returns `true` if the lexer has read to (or past) the end of its input, otherwise `false`.
     */
    private isAtEnd() {
        return this.current >= this.source.length;
    }

    /**
     * Map for looking up token functions based solely upon a single character
     * Should be used in conjunction with `tokenKindMap`
     */
    private static tokenFunctionMap = {
        '\r': Lexer.prototype.newline,
        '\n': Lexer.prototype.newline,
        ' ': Lexer.prototype.whitespace,
        '\t': Lexer.prototype.whitespace,
        '#': Lexer.prototype.preProcessedConditional,
        '"': Lexer.prototype.string,
        '\'': Lexer.prototype.comment,
        '`': Lexer.prototype.templateString,
        '.': function (this: Lexer) {
            // this might be a float/double literal, because decimals without a leading 0
            // are allowed
            if (isDecimalDigit(this.peek())) {
                this.decimalNumber(true);
            } else {
                this.addToken(TokenKind.Dot);
            }
        },
        '@': function (this: Lexer) {
            if (this.peek() === '.') {
                this.advance();
                this.addToken(TokenKind.Callfunc);
            } else {
                this.addToken(TokenKind.At);
            }
        },
        '+': function (this: Lexer) {
            switch (this.peek()) {
                case '=':
                    this.advance();
                    this.addToken(TokenKind.PlusEqual);
                    break;
                case '+':
                    this.advance();
                    this.addToken(TokenKind.PlusPlus);
                    break;
                default:
                    this.addToken(TokenKind.Plus);
                    break;
            }
        },
        '-': function (this: Lexer) {
            switch (this.peek()) {
                case '=':
                    this.advance();
                    this.addToken(TokenKind.MinusEqual);
                    break;
                case '-':
                    this.advance();
                    this.addToken(TokenKind.MinusMinus);
                    break;
                default:
                    this.addToken(TokenKind.Minus);
                    break;
            }
        },
        '*': function (this: Lexer) {
            switch (this.peek()) {
                case '=':
                    this.advance();
                    this.addToken(TokenKind.StarEqual);
                    break;
                default:
                    this.addToken(TokenKind.Star);
                    break;
            }
        },
        '/': function (this: Lexer) {
            //try capturing a regex literal. If that doesn't work, fall back to normal handling
            if (!this.regexLiteral()) {
                switch (this.peek()) {
                    case '=':
                        this.advance();
                        this.addToken(TokenKind.ForwardslashEqual);
                        break;
                    default:
                        this.addToken(TokenKind.Forwardslash);
                        break;
                }
            }
        },
        '\\': function (this: Lexer) {
            switch (this.peek()) {
                case '=':
                    this.advance();
                    this.addToken(TokenKind.BackslashEqual);
                    break;
                default:
                    this.addToken(TokenKind.Backslash);
                    break;
            }
        },
        '<': function (this: Lexer) {
            switch (this.peek()) {
                case '=':
                    this.advance();
                    this.addToken(TokenKind.LessEqual);
                    break;
                case '<':
                    this.advance();
                    switch (this.peek()) {
                        case '=':
                            this.advance();
                            this.addToken(TokenKind.LeftShiftEqual);
                            break;
                        default:
                            this.addToken(TokenKind.LeftShift);
                            break;
                    }
                    break;
                case '>':
                    this.advance();
                    this.addToken(TokenKind.LessGreater);
                    break;
                default:
                    this.addToken(TokenKind.Less);
                    break;
            }
        },
        '>': function (this: Lexer) {
            switch (this.peek()) {
                case '=':
                    this.advance();
                    this.addToken(TokenKind.GreaterEqual);
                    break;
                case '>':
                    this.advance();
                    switch (this.peek()) {
                        case '=':
                            this.advance();
                            this.addToken(TokenKind.RightShiftEqual);
                            break;
                        default:
                            this.addToken(TokenKind.RightShift);
                            break;
                    }
                    break;
                default:
                    this.addToken(TokenKind.Greater);
                    break;
            }
        },
        '?': function (this: Lexer) {
            if (this.peek() === '?') {
                this.advance();
                this.addToken(TokenKind.QuestionQuestion);
            } else if (this.peek() === '.') {
                this.advance();
                this.addToken(TokenKind.QuestionDot);
            } else if (this.peek() === '[') {
                this.advance();
                this.addToken(TokenKind.QuestionLeftSquare);
            } else if (this.peek() === '(') {
                this.advance();
                this.addToken(TokenKind.QuestionLeftParen);
            } else if (this.peek() === '@') {
                this.advance();
                this.addToken(TokenKind.QuestionAt);
            } else {
                this.addToken(TokenKind.Question);
            }
        }
    };

    /**
     * Map for looking up token kinds based solely on a single character.
     * Should be used in conjunction with `tokenFunctionMap`
     */
    private static tokenKindMap = {
        '(': TokenKind.LeftParen,
        ')': TokenKind.RightParen,
        '=': TokenKind.Equal,
        ',': TokenKind.Comma,
        '{': TokenKind.LeftCurlyBrace,
        '}': TokenKind.RightCurlyBrace,
        '[': TokenKind.LeftSquareBracket,
        ']': TokenKind.RightSquareBracket,
        '^': TokenKind.Caret,
        ':': TokenKind.Colon,
        ';': TokenKind.Semicolon
    };

    /**
     * Reads a non-deterministic number of characters from `source`, produces a `Token`, and adds it to
     * the `tokens` array.
     *
     * Accepts and returns nothing, because it's side-effect driven.
     */
    public scanToken(): void {
        this.advance();
        let c = this.source.charAt(this.current - 1);

        let tokenKind: TokenKind | undefined;
        let tokenFunction: (lexer: Lexer) => void | undefined;

        if (isAlpha(c)) {
            this.identifier();

            // eslint-disable-next-line no-cond-assign
        } else if (tokenFunction = Lexer.tokenFunctionMap[c]) {
            tokenFunction.call(this, undefined);

            // eslint-disable-next-line no-cond-assign
        } else if (tokenKind = Lexer.tokenKindMap[c]) {
            this.addToken(tokenKind);

        } else if (isDecimalDigit(c)) {
            this.decimalNumber(false);

        } else if (c === '&' && this.peek().toLowerCase() === 'h') {
            this.advance(); // move past 'h'
            this.hexadecimalNumber();

        } else {
            this.diagnostics.push({
                ...DiagnosticMessages.unexpectedCharacter(c),
                range: this.rangeOf()
            });
        }
    }

    private comment() {
        // BrightScript doesn't have block comments; only line
        while (this.peek() !== '\r' && this.peek() !== '\n' && !this.isAtEnd()) {
            this.advance();
        }
        this.addToken(TokenKind.Comment);
    }

    private whitespace() {
        while (this.peek() === ' ' || this.peek() === '\t') {
            this.advance();
        }
        const whitespaceToken = this.addToken(TokenKind.Whitespace);
        this.leadingWhitespace = whitespaceToken.text;
        //if we aren't keeping the whitespace tokens, then remove this one
        if (this.options.includeWhitespace === false) {
            this.tokens.pop();
        }
        this.start = this.current;
    }

    private newline() {
        //if this is a windows \r\n, we have already consumed the \r, so now consume the \n
        if (this.checkPrevious('\r')) {
            //consume the \n
            this.advance();
        }

        this.addToken(TokenKind.Newline);
        this.start = this.current;
        // advance the line counter
        this.lineBegin++;
        this.lineEnd = this.lineBegin;
        // and always reset the column counter
        this.columnBegin = 0;
        this.columnEnd = 0;
    }

    /**
     * Reads and returns the next character from `string` while **moving the current position forward**.
     * @returns the new "current" character.
     */
    private advance(): void {
        this.current++;
        this.columnEnd++;
    }

    private lookaheadStack = [] as Array<{ current: number; columnEnd: number }>;
    private pushLookahead() {
        this.lookaheadStack.push({
            current: this.current,
            columnEnd: this.columnEnd
        });
    }
    private popLookahead() {
        const { current, columnEnd } = this.lookaheadStack.pop();
        this.current = current;
        this.columnEnd = columnEnd;
    }

    /**
     * Returns the character at position `current` or a null character if we've reached the end of
     * input.
     *
     * @returns the current character if we haven't reached the end of input, otherwise a null
     *          character.
     */
    private peek() {
        if (this.isAtEnd()) {
            return '\0';
        }
        return this.source.charAt(this.current);
    }

    /**
     * Returns the character after position `current`, or a null character if we've reached the end of
     * input.
     *
     * @returns the character after the current one if we haven't reached the end of input, otherwise a
     *          null character.
     */
    private peekNext() {
        if (this.current + 1 > this.source.length) {
            return '\0';
        }
        return this.source.charAt(this.current + 1);
    }

    /**
     * Reads characters within a string literal, advancing through escaped characters to the
     * terminating `"`, and adds the produced token to the `tokens` array. Creates a `BrsError` if the
     * string is terminated by a newline or the end of input.
     */
    private string() {
        let isUnterminated = false;
        while (!this.isAtEnd()) {
            if (this.peek() === '"') {
                if (this.peekNext() === '"') {
                    // skip over two consecutive `"` characters to handle escaped `"` literals
                    this.advance();
                } else {
                    // otherwise the string has ended
                    break;
                }
            }

            if (this.peekNext() === '\n' || this.peekNext() === '\r') {
                // BrightScript doesn't support multi-line strings
                this.diagnostics.push({
                    ...DiagnosticMessages.unterminatedStringAtEndOfLine(),
                    range: this.rangeOf()
                });
                isUnterminated = true;
                break;
            }

            this.advance();
        }

        if (this.isAtEnd()) {
            // terminating a string with EOF is also not allowed
            this.diagnostics.push({
                ...DiagnosticMessages.unterminatedStringAtEndOfFile(),
                range: this.rangeOf()
            });
            isUnterminated = true;
        }

        // move past the closing `"`
        this.advance();

        let endIndex = isUnterminated ? this.current : this.current - 1;

        //get the string text (and trim the leading and trailing quote)
        let value = this.source.slice(this.start + 1, endIndex);

        //replace escaped quotemarks "" with a single quote
        value = value.replace(/""/g, '"');
        this.addToken(TokenKind.StringLiteral);
    }
    /**
     * Reads characters within a string literal, advancing through escaped characters to the
     * terminating `"`, and adds the produced token to the `tokens` array. Creates a `BrsError` if the
     * string is terminated by a newline or the end of input.
     */
    private templateString() {
        this.addToken(TokenKind.BackTick);
        while (!this.isAtEnd() && !this.check('`')) {
            //handle line/column tracking when capturing newlines
            if (this.check('\n')) {
                this.templateQuasiString();

                this.advance();
                let token = this.addToken(TokenKind.EscapedCharCodeLiteral) as Token & { charCode: number };
                //store the char code
                token.charCode = 10;

                //move the location tracking to the next line
                this.lineEnd++;
                this.lineBegin = this.lineEnd;
                this.columnEnd = 0;
                this.columnBegin = this.columnEnd;
                continue;
            } else if (this.check('\r') && this.peekNext() === '\n') {
                this.templateQuasiString();

                this.advance();
                let token = this.addToken(TokenKind.EscapedCharCodeLiteral) as Token & { charCode: number };
                token.charCode = 13;

                this.advance();
                token = this.addToken(TokenKind.EscapedCharCodeLiteral) as Token & { charCode: number };
                token.charCode = 10;

                //move the location tracking to the next line
                this.lineEnd++;
                this.lineBegin = this.lineEnd;
                this.columnEnd = 0;
                this.columnBegin = this.columnEnd;
                continue;

                //escaped chars
            } else if (this.check('\\')) {
                this.templateQuasiString();

                //step past the escape character
                this.advance();
                let charCode: number;
                //a few common cases
                if (this.check('n')) {
                    charCode = '\n'.charCodeAt(0);
                } else if (this.check('r')) {
                    charCode = '\r'.charCodeAt(0);
                } else if (this.check('\\')) {
                    charCode = '\\'.charCodeAt(0);

                    //support escaped unicode codes
                } else if (this.check('c')) {
                    let numText = '';
                    //read tokens until we find a non-numeric one
                    while (
                        !isNaN(
                            parseInt(
                                this.peekNext()
                            )
                        )
                    ) {
                        this.advance();
                        numText += this.peek();
                    }
                    charCode = parseInt(numText);
                } else {
                    charCode = this.peek().charCodeAt(0);
                }
                this.advance();
                let token = this.addToken(TokenKind.EscapedCharCodeLiteral) as Token & { charCode: number };
                token.charCode = charCode;
                continue;
            } else if (this.check('"')) {
                this.templateQuasiString();

                this.advance();
                let token = this.addToken(TokenKind.EscapedCharCodeLiteral) as Token & { charCode: number };
                //store the char code
                token.charCode = '"'.charCodeAt(0);

                //move the location tracking to the next line
                this.lineEnd++;
                this.lineBegin = this.lineEnd;
                this.columnEnd = 0;
                this.columnBegin = this.columnEnd;
                continue;
            }

            if (this.check('$') && this.peekNext() === '{') {
                this.templateQuasiString();
                this.advance();
                this.advance();
                this.addToken(TokenKind.TemplateStringExpressionBegin);
                while (!this.isAtEnd() && !this.check('}')) {
                    this.start = this.current;
                    this.scanToken();
                }
                if (this.check('}')) {
                    this.current++;
                    this.addToken(TokenKind.TemplateStringExpressionEnd);
                } else {

                    this.diagnostics.push({
                        ...DiagnosticMessages.unexpectedConditionalCompilationString(),
                        range: this.rangeOf()
                    });
                }

                this.start = this.current;
            } else {
                this.advance();
            }
        }

        //get last quasi
        this.templateQuasiString();

        if (this.check('`')) {
            // move past the closing ```
            this.advance();
            this.addToken(TokenKind.BackTick);
        }
    }

    private templateQuasiString() {
        let value = this.source.slice(this.start, this.current);
        if (value !== '`') { // if this is an empty string straight after an expression, then we'll accidentally consume the backtick
            this.addToken(TokenKind.TemplateStringQuasi);
        }
    }

    /**
     * Reads characters within a base-10 number literal, advancing through fractional and
     * exponential portions as well as trailing type identifiers, and adds the produced token
     * to the `tokens` array. Also responsible for BrightScript's integer literal vs. float
     * literal rules.
     * @param hasSeenDecimal `true` if decimal point has already been found, otherwise `false`
     *
     * @see https://sdkdocs.roku.com/display/sdkdoc/Expressions%2C+Variables%2C+and+Types#Expressions,Variables,andTypes-NumericLiterals
     */
    private decimalNumber(hasSeenDecimal: boolean) {
        let containsDecimal = hasSeenDecimal;
        while (isDecimalDigit(this.peek())) {
            this.advance();
        }

        // look for a fractional portion
        if (!hasSeenDecimal && this.peek() === '.') {
            containsDecimal = true;

            // consume the "." parse the fractional part
            this.advance();

            // read the remaining digits
            while (isDecimalDigit(this.peek())) {
                this.advance();
            }
        }

        let asString = this.source.slice(this.start, this.current);
        let numberOfDigits = containsDecimal ? asString.length - 1 : asString.length;
        let designator = this.peek().toLowerCase();

        if (numberOfDigits >= 10 && designator !== '&' && designator !== 'e') {
            // numeric literals over 10 digits with no type designator are implicitly Doubles
            this.addToken(TokenKind.DoubleLiteral);
        } else if (designator === '#') {
            // numeric literals ending with "#" are forced to Doubles
            this.advance();
            this.addToken(TokenKind.DoubleLiteral);
        } else if (designator === 'd') {
            // literals that use "D" as the exponent are also automatic Doubles

            // consume the "D"
            this.advance();

            // exponents are optionally signed
            if (this.peek() === '+' || this.peek() === '-') {
                this.advance();
            }

            // consume the exponent
            while (isDecimalDigit(this.peek())) {
                this.advance();
            }

            // replace the exponential marker with a JavaScript-friendly "e"
            asString = this.source.slice(this.start, this.current).replace(/[dD]/, 'e');
            this.addToken(TokenKind.DoubleLiteral);
        } else if (designator === '!') {
            // numeric literals ending with "!" are forced to Floats
            this.advance();
            this.addToken(TokenKind.FloatLiteral);
        } else if (designator === 'e') {
            // literals that use "E" as the exponent are also automatic Floats

            // consume the "E"
            this.advance();

            // exponents are optionally signed
            if (this.peek() === '+' || this.peek() === '-') {
                this.advance();
            }

            // consume the exponent
            while (isDecimalDigit(this.peek())) {
                this.advance();
            }

            this.addToken(TokenKind.FloatLiteral);
        } else if (containsDecimal) {
            // anything with a decimal but without matching Double rules is a Float
            this.addToken(TokenKind.FloatLiteral);
        } else if (designator === '&') {
            // numeric literals ending with "&" are forced to LongIntegers
            this.advance();
            this.addToken(TokenKind.LongIntegerLiteral);
        } else if (designator === '%') {
            //numeric literals ending with "%" are forced to Integer
            this.advance();
            this.addToken(TokenKind.IntegerLiteral);
        } else {
            // otherwise, it's a regular integer
            this.addToken(TokenKind.IntegerLiteral);

        }
    }

    /**
     * Reads characters within a base-16 number literal, advancing through trailing type
     * identifiers, and adds the produced token to the `tokens` array. Also responsible for
     * BrightScript's integer literal vs. long-integer literal rules _for hex literals only_.
     *
     * @see https://sdkdocs.roku.com/display/sdkdoc/Expressions%2C+Variables%2C+and+Types#Expressions,Variables,andTypes-NumericLiterals
     */
    private hexadecimalNumber() {
        while (isHexDigit(this.peek())) {
            this.advance();
        }

        // fractional hex literals aren't valid
        if (this.peek() === '.' && isHexDigit(this.peekNext())) {
            this.advance(); // consume the "."
            this.diagnostics.push({
                ...DiagnosticMessages.fractionalHexLiteralsAreNotSupported(),
                range: this.rangeOf()
            });
            return;
        }

        if (this.peek() === '&') {
            // literals ending with "&" are forced to LongIntegers
            this.advance();
            this.addToken(TokenKind.LongIntegerLiteral);
        } else {
            this.addToken(TokenKind.IntegerLiteral);
        }
    }

    /**
     * Reads characters within an identifier, advancing through alphanumeric characters. Adds the
     * produced token to the `tokens` array.
     */
    private identifier() {
        while (isAlphaNumeric(this.peek())) {
            this.advance();
        }

        let text = this.source.slice(this.start, this.current);
        let lowerText = text.toLowerCase();

        // some identifiers can be split into two words, so check the "next" word and see what we get
        if (
            (lowerText === 'end' || lowerText === 'exit' || lowerText === 'for') &&
            (this.peek() === ' ' || this.peek() === '\t')
        ) {
            let savedCurrent = this.current;
            let savedColumnEnd = this.columnEnd;

            // skip past any whitespace
            let whitespace = '';
            while (this.peek() === ' ' || this.peek() === '\t') {
                //keep the whitespace so we can replace it later
                whitespace += this.peek();
                this.advance();
            }
            while (isAlphaNumeric(this.peek())) {
                this.advance();
            } // read the next word

            let twoWords = this.source.slice(this.start, this.current);
            // replace all of the whitespace with a single space character so we can properly match keyword token types
            twoWords = twoWords.replace(whitespace, ' ');
            let maybeTokenType = Keywords[twoWords.toLowerCase()];
            if (maybeTokenType) {
                this.addToken(maybeTokenType);
                return;
            } else {
                // reset if the last word and the current word didn't form a multi-word TokenKind
                this.current = savedCurrent;
                this.columnEnd = savedColumnEnd;
            }
        }

        // split `elseif` into `else` and `if` tokens
        if (lowerText === 'elseif' && !this.checkPreviousToken(TokenKind.Dot)) {
            let savedCurrent = this.current;
            let savedColumnEnd = this.columnEnd;
            this.current -= 2;
            this.columnEnd -= 2;
            this.addToken(TokenKind.Else);

            this.start = savedCurrent - 2;
            this.current = savedCurrent;
            this.columnBegin = savedColumnEnd - 2;
            this.columnEnd = savedColumnEnd;
            this.addToken(TokenKind.If);
            return;
        }

        // look for a type designator character ($ % ! # &). vars may have them, but functions
        // may not. Let the parser figure that part out.
        let nextChar = this.peek();
        if (['$', '%', '!', '#', '&'].includes(nextChar)) {
            lowerText += nextChar;
            this.advance();
        }

        let tokenType = Keywords[lowerText] || TokenKind.Identifier;
        if (tokenType === Keywords.rem) {
            //the rem keyword can be used as an identifier on objects,
            //so do a quick look-behind to see if there's a preceeding dot
            if (this.checkPreviousToken(TokenKind.Dot)) {
                this.addToken(TokenKind.Identifier);
            } else {
                this.comment();
            }
        } else {
            this.addToken(tokenType);
        }
    }

    /**
     * Check that the previous token was of the specified type
     * @param kind
     */
    private checkPreviousToken(kind: TokenKind) {
        let previous = this.tokens[this.tokens.length - 1];
        if (previous && previous.kind === kind) {
            return true;
        } else {
            return false;
        }
    }

    /**
     * Looks at the current char and returns true if at least one of the candidates is a match
     */
    private check(...candidates: string[]) {
        if (this.isAtEnd()) {
            return false;
        }
        return candidates.includes(this.source.charAt(this.current));
    }

    /**
     * Check the previous character
     */
    private checkPrevious(...candidates: string[]) {
        this.current--;
        let result = this.check(...candidates);
        this.current++;
        return result;
    }


    /**
     * Reads characters within an identifier with a leading '#', typically reserved for conditional
     * compilation. Adds the produced token to the `tokens` array.
     */
    private preProcessedConditional() {
        this.advance(); // advance past the leading #
        while (isAlphaNumeric(this.peek())) {
            this.advance();
        }

        let text = this.source.slice(this.start, this.current).toLowerCase();

        // some identifiers can be split into two words, so check the "next" word and see what we get
        if ((text === '#end' || text === '#else') && this.check(' ', '\t')) {
            let endOfFirstWord = this.current;

            //skip past whitespace
            while (this.check(' ', '\t')) {
                this.advance();
            }

            while (isAlphaNumeric(this.peek())) {
                this.advance();
            } // read the next word

            let twoWords = this.source.slice(this.start, this.current).toLowerCase();
            switch (twoWords.replace(/[\s\t]+/g, ' ')) {
                case '#else if':
                    this.addToken(TokenKind.HashElseIf);
                    return;
                case '#end if':
                    this.addToken(TokenKind.HashEndIf);
                    return;
            }

            // reset if the last word and the current word didn't form a multi-word TokenKind
            this.current = endOfFirstWord;
        }

        switch (text) {
            case '#if':
                this.addToken(TokenKind.HashIf);
                return;
            case '#else':
                this.addToken(TokenKind.HashElse);
                return;
            case '#elseif':
                this.addToken(TokenKind.HashElseIf);
                return;
            case '#endif':
                this.addToken(TokenKind.HashEndIf);
                return;
            case '#const':
                this.addToken(TokenKind.HashConst);
                return;
            case '#error':
                this.addToken(TokenKind.HashError);
                this.start = this.current;

                //create a token from whitespace after the #error token
                if (this.check(' ', '\t')) {
                    this.whitespace();
                }

                while (!this.isAtEnd() && !this.check('\n')) {
                    this.advance();
                }

                // grab all text since we found #error as one token
                this.addToken(TokenKind.HashErrorMessage);

                this.start = this.current;
                return;
            default:
                this.diagnostics.push({
                    ...DiagnosticMessages.unexpectedConditionalCompilationString(),
                    range: this.rangeOf()
                });
        }
    }

    /**
     * Find the closest previous non-whtespace token
     */
    private getPreviousNonWhitespaceToken() {
        for (let i = this.tokens.length - 1; i >= 0; i--) {
            let token = this.tokens[i];
            if (token && token.kind !== TokenKind.Whitespace) {
                return this.tokens[i];
            }
        }
    }

    /**
     * Capture a regex literal token. Returns false if not found.
     * This is lookahead lexing which might techincally belong in the parser,
     * but it's easy enough to do here in the lexer
     */
    private regexLiteral() {
        this.pushLookahead();

        let nextCharNeedsEscaped = false;

        //regexps can only occur when preceeded by exactly one of these tokens:
        const previousKind = this.getPreviousNonWhitespaceToken()?.kind;

        //preceeded by an allowed token, or if there are no previous tokens (i.e. this is the first token in the file).
        if (PreceedingRegexTypes.has(previousKind) || !previousKind) {

            //finite loop to prevent infinite loop if something went wrong
            for (let i = this.current; i < this.source.length; i++) {

                //if we reached the end of the regex, consume any flags
                if (this.check('/') && !nextCharNeedsEscaped) {
                    this.advance();
                    //consume all flag-like chars (let the parser validate the actual values)
                    while (/[a-z]/i.exec(this.peek())) {
                        this.advance();
                    }
                    //finalize the regex literal and EXIT
                    this.addToken(TokenKind.RegexLiteral);
                    return true;

                    //if we found a non-escaped newline, there's a syntax error with this regex (or it's not a regex), so quit
                } else if (this.check('\n') || this.isAtEnd()) {
                    break;
                } else if (this.check('\\')) {
                    this.advance();
                    nextCharNeedsEscaped = true;
                } else {
                    this.advance();
                    nextCharNeedsEscaped = false;
                }
            }
        }
        this.popLookahead();
        return false;
    }

    /**
     * Creates a `Token` and adds it to the `tokens` array.
     * @param kind the type of token to produce.
     * @param literal an optional literal value to include in the token.
     */
    private addToken(kind: TokenKind) {
        let text = this.source.slice(this.start, this.current);
        let token: Token = {
            kind: kind,
            text: text,
            isReserved: ReservedWords.has(text.toLowerCase()),
            range: this.rangeOf(),
            leadingWhitespace: this.leadingWhitespace
        };
        this.leadingWhitespace = '';
        this.tokens.push(token);
        this.sync();
        return token;
    }

    /**
     * Move all location and char pointers to current position. Normally called after adding a token.
     */
    private sync() {
        this.start = this.current;
        this.lineBegin = this.lineEnd;
        this.columnBegin = this.columnEnd;
    }

    /**
     * Creates a `TokenLocation` at the lexer's current position for the provided `text`.
     * @param text the text to create a range for
     * @returns the range of `text` as a `TokenLocation`
     */
    private rangeOf(): Range {
        return util.createRange(this.lineBegin, this.columnBegin, this.lineEnd, this.columnEnd);
    }
}

export interface ScanOptions {
    /**
     * If true, the whitespace tokens are included. If false, they are discarded
     */
    includeWhitespace: boolean;
}
