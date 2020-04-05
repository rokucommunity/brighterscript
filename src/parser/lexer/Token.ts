import { TokenKind } from './TokenKind';
import { BrsType } from '../brsTypes';

/**
 * Represents a chunk of BrightScript scanned by the lexer.
 */
export interface Token {
    /** The type of token this represents. */
    kind: TokenKind;
    /** The text found in the original BrightScript source, if any. */
    text: string;
    /** True if this token's `text` is a reserved word, otherwise `false`. */
    isReserved: boolean;
    /** The literal value (using the BRS type system) associated with this token, if any. */
    literal?: BrsType;
    /** Where the token was found. */
    location: Location;
}

/** Represents the location at which a `Token` was found. */
export interface Location {
    /** The line and column at which this token began. */
    start: LineAndColumn;
    /**
     * The line and column at which this token ended.
     * *NOTE*: The ending column follows the one-past-last convention, to allow direct use with
     * `String.prototype.substring` and similar.
     * @example
     * // For input `foo = 1 + 2`
     * // (columns): 0   4   8
     *
     * foo.location.end === { line: 1, column: 3 };
     */
    end: LineAndColumn;
    /** The name of the file in which this token was found. */
    file: string;
}

/** A line-column pair. */
export interface LineAndColumn {
    /** A *one-indexed* line number. */
    line: number;
    /** A *zero-indexed* column number. */
    column: number;
}

/** Represents an identifier as scanned by the lexer. */
export interface Identifier extends Token {
    kind: TokenKind.Identifier;
}

/**
 * Determines whether or not `obj` is a `Token`.
 * @param obj the object to check for `Token`-ness
 * @returns `true` is `obj` is a `Token`, otherwise `false`
 */
export function isToken(obj: Record<string, any>): obj is Token {
    return !!(obj.kind && obj.text && obj.location);
}
