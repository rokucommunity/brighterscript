import { EventEmitter } from 'events';

import { TokenKind, ReservedWords, Keywords } from './TokenKind';
import { Token, Location } from './Token';
import { BrsError } from '../Error';
import { isAlpha, isDecimalDigit, isAlphaNumeric, isHexDigit } from './Characters';

import { BrsType, BrsString, Int32, Int64, Float, Double } from '../brsTypes/index';

export class Lexer {
    /** Allows consumers to observe errors as they're detected. */
    readonly events = new EventEmitter();

    /**
     * The zero-indexed position at which the token under consideration begins.
     */
    private start: number;

    /**
     * The zero-indexed position being examined for the token under consideration.
     */
    private current: number;

    /**
     * The one-indexed line number being parsed.
     */
    private line: number;

    /**
     * The zero-indexed column number being parsed.
     */
    private column: number;

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
    public errors: BrsError[];

    /**
     * The options used to scan this file
     */
    public options: ScanOptions;

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
    public scan(toScan: string, options?: ScanOptions): Lexer {
        this.source = toScan;
        this.options = this.sanitizeOptions(options);
        this.start = 0;
        this.current = 0;
        this.line = 1;
        this.column = 0;
        this.tokens = [];
        this.errors = [];

        while (!this.isAtEnd()) {
            this.start = this.current;
            this.scanToken();
        }

        this.tokens.push({
            kind: TokenKind.Eof,
            isReserved: false,
            text: '',
            location: {
                start: {
                    line: this.line,
                    column: this.column
                },
                end: {
                    line: this.line,
                    column: this.column + 1
                }
            }
        });

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
     * Convenience function to subscribe to the `err` events emitted by `lexer.events`.
     * @param errorHandler the function to call for every Lexer error emitted after subscribing
     * @returns an object with a `dispose` function, used to unsubscribe from errors
     */
    public onError(errorHandler: (err: BrsError) => void) {
        this.events.on('err', errorHandler);
        return {
            dispose: () => {
                this.events.removeListener('err', errorHandler);
            }
        };
    }

    /**
     * Convenience function to subscribe to a single `err` event emitted by `lexer.events`.
     * @param errorHandler the function to call for the first Lexer error emitted after subscribing
     */
    public onErrorOnce(errorHandler: (err: BrsError) => void) {
        this.events.once('err', errorHandler);
    }

    private addError(err: BrsError) {
        this.errors.push(err);
        this.events.emit('err', err);
    }

    /**
     * Determines whether or not the lexer as reached the end of its input.
     * @returns `true` if the lexer has read to (or past) the end of its input, otherwise `false`.
     */
    private isAtEnd() {
        return this.current >= this.source.length;
    }

    /**
     * Reads a non-deterministic number of characters from `source`, produces a `Token`, and adds it to
     * the `tokens` array.
     *
     * Accepts and returns nothing, because it's side-effect driven.
     */
    private scanToken(): void {
        let c = this.advance();
        switch (c.toLowerCase()) {
            case '(':
                this.addToken(TokenKind.LeftParen);
                break;
            case ')':
                this.addToken(TokenKind.RightParen);
                break;
            case '{':
                this.addToken(TokenKind.LeftCurlyBrace);
                break;
            case '}':
                this.addToken(TokenKind.RightCurlyBrace);
                break;
            case '[':
                this.addToken(TokenKind.LeftSquareBracket);
                break;
            case ']':
                this.addToken(TokenKind.RightSquareBracket);
                break;
            case ',':
                this.addToken(TokenKind.Comma);
                break;
            case '.':
                // this might be a float/double literal, because decimals without a leading 0
                // are allowed
                if (isDecimalDigit(this.peek())) {
                    this.decimalNumber(true);
                } else {
                    this.addToken(TokenKind.Dot);
                }
                break;
            case '+':
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
                break;
            case '-':
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
                break;
            case '*':
                switch (this.peek()) {
                    case '=':
                        this.advance();
                        this.addToken(TokenKind.StarEqual);
                        break;
                    default:
                        this.addToken(TokenKind.Star);
                        break;
                }
                break;
            case '/':
                switch (this.peek()) {
                    case '=':
                        this.advance();
                        this.addToken(TokenKind.ForwardslashEqual);
                        break;
                    default:
                        this.addToken(TokenKind.Forwardslash);
                        break;
                }
                break;
            case '^':
                this.addToken(TokenKind.Caret);
                break;
            case '\\':
                switch (this.peek()) {
                    case '=':
                        this.advance();
                        this.addToken(TokenKind.BackslashEqual);
                        break;
                    default:
                        this.addToken(TokenKind.Backslash);
                        break;
                }
                break;
            case '=':
                this.addToken(TokenKind.Equal);
                break;
            case ':':
                this.addToken(TokenKind.Colon);
                break;
            case ';':
                this.addToken(TokenKind.Semicolon);
                break;
            case '?':
                this.addToken(TokenKind.Print);
                break;
            case '<':
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
                                this.addToken(TokenKind.LessLessEqual);
                                break;
                            default:
                                this.addToken(TokenKind.LessLess);
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
                break;
            case '>':
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
                                this.addToken(TokenKind.GreaterGreaterEqual);
                                break;
                            default:
                                this.addToken(TokenKind.GreaterGreater);
                                break;
                        }
                        break;
                    default:
                        this.addToken(TokenKind.Greater);
                        break;
                }
                break;
            case `'`:
                this.quoteComment();
                break;
            case ' ':
            case '\t':
                this.whitespace();
                break;
            case '\r':
            case '\n':
                this.newline();
                break;
            case '"':
                this.string();
                break;
            case '#':
                this.preProcessedConditional();
                break;
            default:
                if (isDecimalDigit(c)) {
                    this.decimalNumber(false);
                } else if (c === '&' && this.peek().toLowerCase() === 'h') {
                    this.advance(); // move past 'h'
                    this.hexadecimalNumber();
                } else if (isAlpha(c)) {
                    this.identifier();
                } else {
                    this.addError(new BrsError(`Unexpected character '${c}'`, this.locationOf(c)));
                }
                break;
        }
    }

    private quoteComment() {
        // BrightScript doesn't have block comments; only line
        while (this.peek() !== '\n' && !this.isAtEnd()) {
            this.advance();
        }
        this.addToken(TokenKind.Comment);
    }

    private remComment() {
        while (this.peek() !== '\n' && !this.isAtEnd()) {
            this.advance();
        }
        this.addToken(TokenKind.Comment);
    }

    private whitespace() {
        while (this.peek() === ' ' || this.peek() === '\t') {
            this.advance();
        }
        if (this.options.includeWhitespace) {
            this.addToken(TokenKind.Whitespace);
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
        this.line++;
        // and always reset the column counter
        this.column = 0;
    }

    /**
     * Reads and returns the next character from `string` while **moving the current position forward**.
     * @returns the new "current" character.
     */
    private advance(): string {
        this.current++;
        this.column++;
        return this.source.charAt(this.current - 1);
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

            if (this.peekNext() === '\n') {
                // BrightScript doesn't support multi-line strings
                this.addError(
                    new BrsError(
                        'Unterminated string at end of line',
                        this.locationOf(this.source.slice(this.start, this.current))
                    )
                );
                return;
            }

            this.advance();
        }

        if (this.isAtEnd()) {
            // terminating a string with EOF is also not allowed
            this.addError(
                new BrsError(
                    'Unterminated string at end of file',
                    this.locationOf(this.source.slice(this.start, this.current))
                )
            );
            return;
        }

        // move past the closing `"`
        this.advance();

        // trim the surrounding quotes, and replace the double-" literal with a single
        let value = this.source.slice(this.start + 1, this.current - 1).replace(/""/g, '"');
        this.addToken(TokenKind.StringLiteral, new BrsString(value));
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

        if (numberOfDigits >= 10 && designator !== '&') {
            // numeric literals over 10 digits with no type designator are implicitly Doubles
            this.addToken(TokenKind.DoubleLiteral, Double.fromString(asString));
            return;
        } else if (designator === '#') {
            // numeric literals ending with "#" are forced to Doubles
            this.advance();
            asString = this.source.slice(this.start, this.current);
            this.addToken(TokenKind.DoubleLiteral, Double.fromString(asString));
            return;
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
            this.addToken(TokenKind.DoubleLiteral, Double.fromString(asString));
            return;
        }

        if (designator === '!') {
            // numeric literals ending with "!" are forced to Floats
            this.advance();
            asString = this.source.slice(this.start, this.current);
            this.addToken(TokenKind.FloatLiteral, Float.fromString(asString));
            return;
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

            asString = this.source.slice(this.start, this.current);
            this.addToken(TokenKind.FloatLiteral, Float.fromString(asString));
            return;
        } else if (containsDecimal) {
            // anything with a decimal but without matching Double rules is a Float
            this.addToken(TokenKind.FloatLiteral, Float.fromString(asString));
            return;
        }

        if (designator === '&') {
            // numeric literals ending with "&" are forced to LongIntegers
            asString = this.source.slice(this.start, this.current);
            this.advance();
            this.addToken(TokenKind.LongIntegerLiteral, Int64.fromString(asString));

        } else {
            // otherwise, it's a regular integer
            this.addToken(TokenKind.IntegerLiteral, Int32.fromString(asString));

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
            this.addError(
                new BrsError(
                    'Fractional hex literals are not supported',
                    this.locationOf(this.source.slice(this.start, this.current))
                )
            );
            return;
        }

        if (this.peek() === '&') {
            // literals ending with "&" are forced to LongIntegers
            this.advance();
            let asString = this.source.slice(this.start, this.current);
            this.addToken(TokenKind.LongIntegerLiteral, Int64.fromString(asString));
        } else {
            let asString = this.source.slice(this.start, this.current);
            this.addToken(TokenKind.IntegerLiteral, Int32.fromString(asString));
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
            (lowerText === 'end' || lowerText === 'else' || lowerText === 'exit' || lowerText === 'for') &&
            (this.peek() === ' ' || this.peek() === '\t')
        ) {
            let endOfFirstWord = {
                position: this.current,
                column: this.column
            };

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
            //replace all of the whitespace with a single space character so we can properly match keyword token types
            twoWords = twoWords.replace(whitespace, ' ');
            let maybeTokenType = Keywords[twoWords.toLowerCase()];
            if (maybeTokenType) {
                this.addToken(maybeTokenType);
                return;
            } else {
                // reset if the last word and the current word didn't form a multi-word TokenKind
                this.current = endOfFirstWord.position;
                this.column = endOfFirstWord.column;
            }
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
                this.remComment();
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

            let twoWords = this.source.slice(this.start, this.current);
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
                this.addError(
                    new BrsError(
                        `Found unexpected conditional-compilation string '${text}'`,
                        this.locationOf(this.source.slice(this.start, this.current))
                    )
                );
        }
    }

    /**
     * Creates a `Token` and adds it to the `tokens` array.
     * @param kind the type of token to produce.
     * @param literal an optional literal value to include in the token.
     */
    private addToken(kind: TokenKind, literal?: BrsType) {
        let text = this.source.slice(this.start, this.current);
        let token = {
            kind: kind,
            text: text,
            isReserved: ReservedWords.has(text.toLowerCase()),
            literal: literal,
            location: this.locationOf(text)
        };
        this.tokens.push(token);
        return token;
    }

    /**
     * Creates a `TokenLocation` at the lexer's current position for the provided `text`.
     * @param text the text to create a location for
     * @returns the location of `text` as a `TokenLocation`
     */
    private locationOf(text: string): Location {
        let location = {
            start: {
                line: this.line,
                column: this.column - text.length
            },
            end: {
                line: this.line,
                column: Math.max(this.column - text.length + 1, this.column)
            }
        };
        return location;
    }
}

export interface ScanOptions {
    /**
     * If true, the whitespace tokens are included. If false, they are discarded
     */
    includeWhitespace: boolean;
}
