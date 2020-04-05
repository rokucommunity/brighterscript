import { EventEmitter } from 'events';

import { BrsError, ParseError } from '../Error';
import { TokenKind, Token } from '../lexer';
import * as CC from './Chunk';

/** The results of a Preprocessor's filtering pass. */
export interface FilterResults {
    /** The tokens remaining after preprocessing. */
    processedTokens: Token[];
    /** The encountered during preprocessing. */
    errors: ReadonlyArray<BrsError>;
}

/**
 * A simple pre-processor that executes BrightScript's conditional compilation directives by
 * selecting chunks of tokens to be considered for later evaluation.
 */
export class Preprocessor implements CC.Visitor {
    private constants = new Map<string, boolean>();

    /** Allows consumers to observe errors as they're detected. */
    public readonly events = new EventEmitter();

    /** The set of errors encountered when pre-processing conditional compilation directives. */
    public errors: ParseError[] = [];

    /**
     * Emits an error via this processor's `events` property, then throws it.
     * @param err the ParseError to emit then throw
     */
    private addError(err: BrsError) {
        this.errors.push(err);
        this.events.emit('err', err);
        return err;
    }

    /**
     * Filters the tokens contained within a set of chunks based on a set of constants.
     * @param chunks the chunks from which to retrieve tokens
     * @param bsConst the set of constants defined in a BrightScript `manifest` file's `bs_const` property
     * @returns an object containing an array of `errors` and an array of `processedTokens` filtered by conditional
     *          compilation directives included within
     */
    public filter(chunks: ReadonlyArray<CC.Chunk>, bsConst: Map<string, boolean>): FilterResults {
        this.constants = new Map(bsConst);
        return {
            processedTokens: chunks
                .map(chunk => chunk.accept(this))
                .reduce(
                    (allTokens: Token[], chunkTokens: Token[]) => [...allTokens, ...chunkTokens],
                    []
                ),
            errors: this.errors
        };
    }

    /**
     * Handles a simple chunk of BrightScript tokens by returning the tokens contained within.
     * @param chunk the chunk to extract tokens from
     * @returns the array of tokens contained within `chunk`
     */
    public visitBrightScript(chunk: CC.BrightScript) {
        return chunk.tokens;
    }

    /**
     * Handles a BrightScript `#const` directive, creating a variable in-scope only for the
     * conditional compilation pass.
     * @param chunk the `#const` directive, including the name and variable to use for the constant
     * @returns an empty array, since `#const` directives are always removed from the evaluated script.
     */
    public visitDeclaration(chunk: CC.Declaration) {
        if (this.constants.has(chunk.name.text)) {
            this.addError(
                new BrsError(
                    `Attempting to re-declare #const with name '${chunk.name.text}'`,
                    chunk.name.location
                )
            );
        }

        let value;
        switch (chunk.value.kind) {
            case TokenKind.True:
                value = true;
                break;
            case TokenKind.False:
                value = false;
                break;
            case TokenKind.IdentifierLiteral:
                if (this.constants.has(chunk.value.text)) {
                    value = this.constants.get(chunk.value.text);
                    break;
                }

                this.addError(
                    new BrsError(
                        `Attempting to create #const alias of '${chunk.value.text}', but no such #const exists`,
                        chunk.value.location
                    )
                );
                break;
            default:
                this.addError(
                    new BrsError(
                        '#const declarations can only have values of `true`, `false`, or other #const names',
                        chunk.value.location
                    )
                );
        }

        this.constants.set(chunk.name.text, value);

        return [];
    }

    /**
     * Throws an error, stopping "compilation" of the program.
     * @param chunk the error to report to users
     * @throws a JavaScript error with the provided message
     */
    public visitError(chunk: CC.Error): never {
        throw this.addError(new ParseError(chunk.hashError, chunk.message));
    }

    /**
     * Produces tokens from a branch of a conditional-compilation `#if`, or no tokens if no branches evaluate to `true`.
     * @param chunk the `#if` directive, any `#else if` or `#else` directives, and their associated BrightScript chunks.
     * @returns an array of tokens to include in the final executed script.
     */
    public visitIf(chunk: CC.If): Token[] {
        if (this.evaluateCondition(chunk.condition)) {
            return chunk.thenChunks
                .map(chunk => chunk.accept(this))
                .reduce((allTokens, chunkTokens: Token[]) => [...allTokens, ...chunkTokens], []);
        } else {
            for (const elseIf of chunk.elseIfs) {
                if (this.evaluateCondition(elseIf.condition)) {
                    return elseIf.thenChunks
                        .map(chunk => chunk.accept(this))
                        .reduce(
                            (allTokens, chunkTokens: Token[]) => [...allTokens, ...chunkTokens],
                            []
                        );
                }
            }
        }

        if (chunk.elseChunks) {
            return chunk.elseChunks
                .map(chunk => chunk.accept(this))
                .reduce((allTokens, chunkTokens: Token[]) => [...allTokens, ...chunkTokens], []);
        }

        return [];
    }

    /**
     * Resolves a token to a JavaScript boolean value, or throws an error.
     * @param token the token to resolve to either `true`, `false`, or an error
     * @throws if attempting to reference an undefined `#const` or if `token` is neither `true`, `false`, nor an identifier.
     */
    public evaluateCondition(token: Token): boolean {
        switch (token.kind) {
            case TokenKind.True:
                return true;
            case TokenKind.False:
                return false;
            case TokenKind.IdentifierLiteral:
                if (this.constants.has(token.text)) {
                    return this.constants.get(token.text);
                }

                this.addError(
                    new BrsError(
                        `Attempting to reference undefined #const with name '${token.text}'`,
                        token.location
                    )
                );
                break;
            default:
                this.addError(
                    new BrsError(
                        '#if conditionals can only be `true`, `false`, or other #const names',
                        token.location
                    )
                );
        }
    }
}
