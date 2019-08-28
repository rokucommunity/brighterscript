//tslint:disable
import { EventEmitter } from "events";

import { Lexeme } from "./Lexeme";
import { Token, Location } from "./Token";
import { ReservedWords, KeyWords } from "./ReservedWords";
import { BrsError } from "../Error";
import { isAlpha, isDecimalDigit, isAlphaNumeric, isHexDigit } from "./Characters";

import { BrsType, BrsString, Int32, Int64, Float, Double } from "../brsTypes";

/** The results of a Lexer's scanning pass. */
interface ScanResults {
    /** The tokens produced by the Lexer. */
    tokens: Token[];
    /** The errors encountered by the Lexer. */
    errors: BrsError[];
}

export class Lexer {
    /** Allows consumers to observe errors as they're detected. */
    readonly events = new EventEmitter();

    /**
     * A convenience function, equivalent to `new Lexer().scan(toScan)`, that converts a string
     * containing BrightScript code to an array of `Token` objects that will later be used to build
     * an abstract syntax tree.
     *
     * @param toScan the BrightScript code to convert into tokens
     * @param filename the name of the file to be scanned
     * @returns an object containing an array of `errors` and an array of `tokens` to be passed to a parser.
     */
    static scan(toScan: string, filename: string = ""): ScanResults {
        return new Lexer().scan(toScan, filename);
    }

    /**
     * Convenience function to subscribe to the `err` events emitted by `lexer.events`.
     * @param errorHandler the function to call for every Lexer error emitted after subscribing
     * @returns an object with a `dispose` function, used to unsubscribe from errors
     */
    public onError(errorHandler: (err: BrsError) => void) {
        this.events.on("err", errorHandler);
        return {
            dispose: () => {
                this.events.removeListener("err", errorHandler);
            },
        };
    }

    /**
     * Convenience function to subscribe to a single `err` event emitted by `lexer.events`.
     * @param errorHandler the function to call for the first Lexer error emitted after subscribing
     */
    public onErrorOnce(errorHandler: (err: BrsError) => void) {
        this.events.once("err", errorHandler);
    }

    /**
     * Converts a string containing BrightScript code to an array of `Token` objects that will
     * later be used to build an abstract syntax tree.
     *
     * @param toScan the BrightScript code to convert into tokens
     * @param filename the name of the file to be scanned
     * @returns an object containing an array of `errors` and an array of `tokens` to be passed to a parser.
     */
    public scan(toScan: string, filename: string): ScanResults {
        /** The zero-indexed position at which the token under consideration begins. */
        let start = 0;
        /** The zero-indexed position being examined for the token under consideration. */
        let current = 0;
        /** The one-indexed line number being parsed. */
        let line = 1;
        /** The zero-indexed column number being parsed. */
        let column = 0;

        /** The BrightScript code being converted to an array of `Token`s. */
        let source = toScan;

        /** The tokens produced from `source`. */
        let tokens: Token[] = [];

        /** The errors produced from `source.` */
        let errors: BrsError[] = [];

        const addError = (err: BrsError) => {
            errors.push(err);
            this.events.emit("err", err);
        };

        while (!isAtEnd()) {
            start = current;
            scanToken();
        }

        tokens.push({
            kind: Lexeme.Eof,
            isReserved: false,
            text: "\0",
            location: {
                start: {
                    line: line,
                    column: column,
                },
                end: {
                    line: line,
                    column: column + 1,
                },
                file: filename,
            },
        });

        return { tokens, errors };

        /**
         * Determines whether or not the lexer as reached the end of its input.
         * @returns `true` if the lexer has read to (or past) the end of its input, otherwise `false`.
         */
        function isAtEnd() {
            return current >= source.length;
        }

        /**
         * Reads a non-deterministic number of characters from `source`, produces a `Token`, and adds it to
         * the `tokens` array.
         *
         * Accepts and returns nothing, because it's side-effect driven.
         */
        function scanToken(): void {
            let c = advance();
            switch (c.toLowerCase()) {
                case "(":
                    addToken(Lexeme.LeftParen);
                    break;
                case ")":
                    addToken(Lexeme.RightParen);
                    break;
                case "{":
                    addToken(Lexeme.LeftBrace);
                    break;
                case "}":
                    addToken(Lexeme.RightBrace);
                    break;
                case "[":
                    addToken(Lexeme.LeftSquare);
                    break;
                case "]":
                    addToken(Lexeme.RightSquare);
                    break;
                case ",":
                    addToken(Lexeme.Comma);
                    break;
                case ".":
                    // this might be a float/double literal, because decimals without a leading 0
                    // are allowed
                    if (isDecimalDigit(peek())) {
                        decimalNumber(true);
                    } else {
                        addToken(Lexeme.Dot);
                    }
                    break;
                case "+":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.PlusEqual);
                            break;
                        case "+":
                            advance();
                            addToken(Lexeme.PlusPlus);
                            break;
                        default:
                            addToken(Lexeme.Plus);
                            break;
                    }
                    break;
                case "-":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.MinusEqual);
                            break;
                        case "-":
                            advance();
                            addToken(Lexeme.MinusMinus);
                            break;
                        default:
                            addToken(Lexeme.Minus);
                            break;
                    }
                    break;
                case "*":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.StarEqual);
                            break;
                        default:
                            addToken(Lexeme.Star);
                            break;
                    }
                    break;
                case "/":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.SlashEqual);
                            break;
                        default:
                            addToken(Lexeme.Slash);
                            break;
                    }
                    break;
                case "^":
                    addToken(Lexeme.Caret);
                    break;
                case "\\":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.BackslashEqual);
                            break;
                        default:
                            addToken(Lexeme.Backslash);
                            break;
                    }
                    break;
                case "=":
                    addToken(Lexeme.Equal);
                    break;
                case ":":
                    addToken(Lexeme.Colon);
                    break;
                case ";":
                    addToken(Lexeme.Semicolon);
                    break;
                case "?":
                    addToken(Lexeme.Print);
                    break;
                case "<":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.LessEqual);
                            break;
                        case "<":
                            advance();
                            switch (peek()) {
                                case "=":
                                    advance();
                                    addToken(Lexeme.LeftShiftEqual);
                                    break;
                                default:
                                    addToken(Lexeme.LeftShift);
                                    break;
                            }
                            break;
                        case ">":
                            advance();
                            addToken(Lexeme.LessGreater);
                            break;
                        default:
                            addToken(Lexeme.Less);
                            break;
                    }
                    break;
                case ">":
                    switch (peek()) {
                        case "=":
                            advance();
                            addToken(Lexeme.GreaterEqual);
                            break;
                        case ">":
                            advance();
                            switch (peek()) {
                                case "=":
                                    advance();
                                    addToken(Lexeme.RightShiftEqual);
                                    break;
                                default:
                                    addToken(Lexeme.RightShift);
                                    break;
                            }
                            break;
                        default:
                            addToken(Lexeme.Greater);
                            break;
                    }
                    break;
                case "'":
                    let comment = '';
                    // BrightScript doesn't have block comments; only line
                    while (peek() !== "\n" && !isAtEnd()) {
                        comment += advance();
                    }
                    tokens.push({
                        text: comment,
                        isReserved: false,
                        kind: Lexeme.SingleLineComment,
                        location: locationOf(comment),
                    });
                    break;
                case " ":
                case "\r":
                case "\t":
                    // ignore whitespace; indentation isn't signficant in BrightScript
                    break;
                case "\n":
                    // consecutive newlines aren't significant, because they're just blank lines
                    // so only add blank lines when they're not consecutive
                    let previous = lastToken();
                    if (previous && previous.kind !== Lexeme.Newline) {
                        addToken(Lexeme.Newline);
                    }
                    // but always advance the line counter
                    line++;
                    // and always reset the column counter
                    column = 0;
                    break;
                case '"':
                    string();
                    break;
                case "#":
                    preProcessedConditional();
                    break;
                default:
                    if (isDecimalDigit(c)) {
                        decimalNumber(false);
                    } else if (c === "&" && peek().toLowerCase() === "h") {
                        advance(); // move past 'h'
                        hexadecimalNumber();
                    } else if (isAlpha(c)) {
                        identifier();
                    } else {
                        addError(new BrsError(`Unexpected character '${c}'`, locationOf(c)));
                    }
                    break;
            }
        }

        /**
         * Reads and returns the next character from `string` while **moving the current position forward**.
         * @returns the new "current" character.
         */
        function advance(): string {
            current++;
            column++;
            return source.charAt(current - 1);
        }

        /**
         * Determines whether the "current" character matches an `expected` character and advances the
         * "current" character if it does.
         *
         * @param expected a single-character string to test for.
         * @returns `true` if `expected` is strictly equal to the current character, otherwise `false`
         *          (including if we've reached the end of the input).
         */
        function match(expected: string) {
            if (expected.length > 1) {
                throw new Error(`Lexer#match expects a single character; received '${expected}'`);
            }

            if (isAtEnd()) {
                return false;
            }
            if (source.charAt(current) !== expected) {
                return false;
            }

            current++;
            return true;
        }

        /**
         * Returns the character at position `current` or a null character if we've reached the end of
         * input.
         *
         * @returns the current character if we haven't reached the end of input, otherwise a null
         *          character.
         */
        function peek() {
            if (isAtEnd()) {
                return "\0";
            }
            return source.charAt(current);
        }

        /**
         * Returns the character after position `current`, or a null character if we've reached the end of
         * input.
         *
         * @returns the character after the current one if we haven't reached the end of input, otherwise a
         *          null character.
         */
        function peekNext() {
            if (current + 1 > source.length) {
                return "\0";
            }
            return source.charAt(current + 1);
        }

        /**
         * Reads characters within a string literal, advancing through escaped characters to the
         * terminating `"`, and adds the produced token to the `tokens` array. Creates a `BrsError` if the
         * string is terminated by a newline or the end of input.
         */
        function string() {
            while (!isAtEnd()) {
                if (peek() === '"') {
                    if (peekNext() === '"') {
                        // skip over two consecutive `"` characters to handle escaped `"` literals
                        advance();
                    } else {
                        // otherwise the string has ended
                        break;
                    }
                }

                if (peekNext() === "\n") {
                    // BrightScript doesn't support multi-line strings
                    addError(
                        new BrsError(
                            "Unterminated string at end of line",
                            locationOf(source.slice(start, current))
                        )
                    );
                    return;
                }

                advance();
            }

            if (isAtEnd()) {
                // terminating a string with EOF is also not allowed
                addError(
                    new BrsError(
                        "Unterminated string at end of file",
                        locationOf(source.slice(start, current))
                    )
                );
                return;
            }

            // move past the closing `"`
            advance();

            // trim the surrounding quotes, and replace the double-" literal with a single
            let value = source.slice(start + 1, current - 1).replace(/""/g, '"');
            addToken(Lexeme.String, new BrsString(value));
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
        function decimalNumber(hasSeenDecimal: boolean) {
            let containsDecimal = hasSeenDecimal;
            while (isDecimalDigit(peek())) {
                advance();
            }

            // look for a fractional portion
            if (!hasSeenDecimal && peek() === ".") {
                containsDecimal = true;

                // consume the "." parse the fractional part
                advance();

                // read the remaining digits
                while (isDecimalDigit(peek())) {
                    advance();
                }
            }

            let asString = source.slice(start, current);
            let numberOfDigits = containsDecimal ? asString.length - 1 : asString.length;
            let designator = peek().toLowerCase();

            if (numberOfDigits >= 10 && designator !== "&") {
                // numeric literals over 10 digits with no type designator are implicitly Doubles
                addToken(Lexeme.Double, Double.fromString(asString));
                return;
            } else if (designator === "#") {
                // numeric literals ending with "#" are forced to Doubles
                advance();
                asString = source.slice(start, current);
                addToken(Lexeme.Double, Double.fromString(asString));
                return;
            } else if (designator === "d") {
                // literals that use "D" as the exponent are also automatic Doubles

                // consume the "D"
                advance();

                // exponents are optionally signed
                if (peek() === "+" || peek() === "-") {
                    advance();
                }

                // consume the exponent
                while (isDecimalDigit(peek())) {
                    advance();
                }

                // replace the exponential marker with a JavaScript-friendly "e"
                asString = source.slice(start, current).replace(/[dD]/, "e");
                addToken(Lexeme.Double, Double.fromString(asString));
                return;
            }

            if (designator === "!") {
                // numeric literals ending with "!" are forced to Floats
                advance();
                asString = source.slice(start, current);
                addToken(Lexeme.Float, Float.fromString(asString));
                return;
            } else if (designator === "e") {
                // literals that use "E" as the exponent are also automatic Floats

                // consume the "E"
                advance();

                // exponents are optionally signed
                if (peek() === "+" || peek() === "-") {
                    advance();
                }

                // consume the exponent
                while (isDecimalDigit(peek())) {
                    advance();
                }

                asString = source.slice(start, current);
                addToken(Lexeme.Float, Float.fromString(asString));
                return;
            } else if (containsDecimal) {
                // anything with a decimal but without matching Double rules is a Float
                addToken(Lexeme.Float, Float.fromString(asString));
                return;
            }

            if (designator === "&") {
                // numeric literals ending with "&" are forced to LongIntegers
                asString = source.slice(start, current);
                advance();
                addToken(Lexeme.LongInteger, Int64.fromString(asString));
                return;
            } else {
                // otherwise, it's a regular integer
                addToken(Lexeme.Integer, Int32.fromString(asString));
                return;
            }
        }

        /**
         * Reads characters within a base-16 number literal, advancing through trailing type
         * identifiers, and adds the produced token to the `tokens` array. Also responsible for
         * BrightScript's integer literal vs. long-integer literal rules _for hex literals only_.
         *
         * @see https://sdkdocs.roku.com/display/sdkdoc/Expressions%2C+Variables%2C+and+Types#Expressions,Variables,andTypes-NumericLiterals
         */
        function hexadecimalNumber() {
            while (isHexDigit(peek())) {
                advance();
            }

            // fractional hex literals aren't valid
            if (peek() === "." && isHexDigit(peekNext())) {
                advance(); // consume the "."
                addError(
                    new BrsError(
                        "Fractional hex literals are not supported",
                        locationOf(source.slice(start, current))
                    )
                );
                return;
            }

            if (peek() === "&") {
                // literals ending with "&" are forced to LongIntegers
                advance();
                let asString = source.slice(start, current);
                addToken(Lexeme.LongInteger, Int64.fromString(asString));
            } else {
                let asString = source.slice(start, current);
                addToken(Lexeme.Integer, Int32.fromString(asString));
            }
        }

        /**
         * Reads characters within an identifier, advancing through alphanumeric characters. Adds the
         * produced token to the `tokens` array.
         */
        function identifier() {
            while (isAlphaNumeric(peek())) {
                advance();
            }

            let text = source.slice(start, current).toLowerCase();

            // some identifiers can be split into two words, so check the "next" word and see what we get
            if (
                (text === "end" || text === "else" || text === "exit" || text === "for") &&
                (peek() === " " || peek() === "\t")
            ) {
                let endOfFirstWord = {
                    position: current,
                    column: column,
                };

                // skip past any whitespace
                let whitespace = "";
                while (peek() === " " || peek() === "\t") {
                    //keep the whitespace so we can replace it later
                    whitespace += peek();
                    advance();
                }
                while (isAlphaNumeric(peek())) {
                    advance();
                } // read the next word

                let twoWords = source.slice(start, current);
                //replace all of the whitespace with a single space character so we can properly match keyword token types
                twoWords = twoWords.replace(whitespace, " ");
                let maybeTokenType = KeyWords[twoWords.toLowerCase()];
                if (maybeTokenType) {
                    addToken(maybeTokenType);
                    return;
                } else {
                    // reset if the last word and the current word didn't form a multi-word Lexeme
                    current = endOfFirstWord.position;
                    column = endOfFirstWord.column;
                }
            }

            // look for a type designator character ($ % ! # &). vars may have them, but functions
            // may not. Let the parser figure that part out.
            let nextChar = peek();
            if (["$", "%", "!", "#", "&"].includes(nextChar)) {
                text += nextChar;
                advance();
            }

            let tokenType = KeyWords[text.toLowerCase()] || Lexeme.Identifier;
            if (tokenType === KeyWords.rem) {
                //the rem keyword can be used as an identifier on objects,
                //so do a quick look-behind to see if there's a preceeding dot
                if (checkPrevious(Lexeme.Dot)) {
                    addToken(Lexeme.Identifier);
                } else {
                    // The 'rem' keyword can be used to indicate comments as well, so
                    // consume the rest of the line
                    let comment = '';
                    while (peek() !== "\n" && !isAtEnd()) {
                        comment += advance();
                    }
                    tokens.push({
                        text: comment,
                        isReserved: false,
                        kind: Lexeme.SingleLineComment,
                        location: locationOf(comment),
                    });
                }
            } else {
                addToken(tokenType);
            }
        }

        /**
         * Check that the previous token was of the specified type
         * @param kind
         */
        function checkPrevious(kind: Lexeme) {
            let previous = tokens[tokens.length - 1];
            if (previous && previous.kind === kind) {
                return true;
            } else {
                return false;
            }
        }

        /**
         * Reads characters within an identifier with a leading '#', typically reserved for conditional
         * compilation. Adds the produced token to the `tokens` array.
         */
        function preProcessedConditional() {
            advance(); // advance past the leading #
            while (isAlphaNumeric(peek())) {
                advance();
            }

            let text = source.slice(start, current).toLowerCase();

            // some identifiers can be split into two words, so check the "next" word and see what we get
            if ((text === "#end" || text === "#else") && peek() === " ") {
                let endOfFirstWord = current;

                advance(); // skip past the space
                while (isAlphaNumeric(peek())) {
                    advance();
                } // read the next word

                let twoWords = source.slice(start, current);
                switch (twoWords.replace(/ {2,}/g, " ")) {
                    case "#else if":
                        addToken(Lexeme.HashElseIf);
                        return;
                    case "#end if":
                        addToken(Lexeme.HashEndIf);
                        return;
                }

                // reset if the last word and the current word didn't form a multi-word Lexeme
                current = endOfFirstWord;
            }

            switch (text) {
                case "#if":
                    addToken(Lexeme.HashIf);
                    return;
                case "#else":
                    addToken(Lexeme.HashElse);
                    return;
                case "#elseif":
                    addToken(Lexeme.HashElseIf);
                    return;
                case "#endif":
                    addToken(Lexeme.HashEndIf);
                    return;
                case "#const":
                    addToken(Lexeme.HashConst);
                    return;
                case "#error":
                    addToken(Lexeme.HashError);

                    // #error must be followed by a message; scan it separately to preserve whitespace
                    start = current;
                    while (!isAtEnd() && peek() !== "\n") {
                        advance();
                    }

                    // grab all text since we found #error as one token
                    addToken(Lexeme.HashErrorMessage);

                    // consume the trailing newline here; it's not semantically significant
                    match("\n");

                    start = current;
                    return;
                default:
                    addError(
                        new BrsError(
                            `Found unexpected conditional-compilation string '${text}'`,
                            locationOf(source.slice(start, current))
                        )
                    );
            }
        }

        /**
         * Retrieves the token that was most recently added.
         * @returns the most recently added token.
         */
        function lastToken(): Token | undefined {
            return tokens[tokens.length - 1];
        }

        /**
         * Creates a `Token` and adds it to the `tokens` array.
         * @param kind the type of token to produce.
         * @param literal an optional literal value to include in the token.
         */
        function addToken(kind: Lexeme, literal?: BrsType): void {
            let withWhitespace = source.slice(start, current);
            let text = withWhitespace.trimLeft() || withWhitespace;
            tokens.push({
                kind: kind,
                text: text,
                isReserved: ReservedWords.has(text.toLowerCase()),
                literal: literal,
                location: locationOf(text),
            });
        }

        /**
         * Creates a `TokenLocation` at the lexer's current position for the provided `text`.
         * @param text the text to create a location for
         * @returns the location of `text` as a `TokenLocation`
         */
        function locationOf(text: string): Location {
            return {
                start: {
                    line: line,
                    column: column - text.length,
                },
                end: {
                    line: line,
                    column: Math.max(column - text.length + 1, column),
                },
                file: filename,
            };
        }
    }
}
