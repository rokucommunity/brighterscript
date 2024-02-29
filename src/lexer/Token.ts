import { TokenKind } from './TokenKind';
import type { Range } from 'vscode-languageserver';

/**
 * Represents a chunk of BrightScript scanned by the lexer.
 */
export interface Token {
    /** The type of token this represents. */
    kind: TokenKind;
    /** The text found in the original BrightScript source, if any. */
    text: string;
    /** True if this token's `text` is a reserved word, otherwise `false`. */
    isReserved?: boolean;
    /** Where the token was found. */
    range: Range;
    /**
     * Any leading whitespace found prior to this token. Excludes newline characters.
     */
    leadingWhitespace?: string;

    /**
     * Any tokens starting on the next line of the previous token, up to the start of this token
     */
    leadingTrivia: Token[];
}

/**
 * Any object that has a range
 */
export interface Locatable {
    range: Range;
    [key: string]: any;
}

/**
 * Represents an identifier as scanned by the lexer.
 */
export interface Identifier extends Token {
    kind: TokenKind.Identifier;
}

/**
 * Determines whether or not `obj` is a `Token`.
 * @param obj the object to check for `Token`-ness
 * @returns `true` is `obj` is a `Token`, otherwise `false`
 */
export function isToken(obj: Record<string, any>): obj is Token {
    return !!(obj.kind && (obj.kind === TokenKind.Eof || obj.text) && obj.range);
}

/**
 * Is this a token that has the `TokenKind.Identifier` kind?
 */
export function isIdentifier(obj: any): obj is Identifier {
    return obj?.kind === TokenKind.Identifier;
}
