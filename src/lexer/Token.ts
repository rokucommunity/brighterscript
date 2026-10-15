import { TokenKind } from './TokenKind';

/**
 * Represents a chunk of BrightScript scanned by the lexer.
 */
export interface Token extends Locatable {
    /**
     * The type of token this represents.
     */
    kind: TokenKind;
    /**
     * The text found in the original BrightScript source, if any.
     */
    text: string;
    /**
     * True if this token's `text` is a reserved word, otherwise `false`.
     *
     */
    isReserved?: boolean;
    /**
     * Any tokens starting on the next line of the previous token, up to the start of this token
     */
    leadingTrivia?: Token[];
}

/**
 * Any object that has a location in a source file. Use `util.getLocation()` to get the line/character `Location`
 */
export interface Locatable {
    /**
     * Where this item starts, counted from the start of the source.
     *
     * Positions are the gaps between characters, like an editor cursor. For the source `print`, `startPosition` is `0` (before the `p`) and `endPosition` is `5` (after the `t`).
     * Counted in UTF-16 code units, the same as an LSP `Position.character`
     */
    startPosition: number;
    /**
     * Where this item ends: the gap just after its last character, counted from the start of the source (see `startPosition`).
     * `endPosition - startPosition` is the item's length
     */
    endPosition: number;
    /**
     * Info about the source this item was parsed from. Shared by every item from the same parse. `undefined` for synthetic items
     */
    sourceInfo: SourceInfo | undefined;
}

/**
 * Info about a parsed source, shared by every `Locatable` produced from the same parse
 */
export interface SourceInfo {
    /**
     * The uri of the file
     */
    uri: string;
    /**
     * Where each line starts: the gap before its first character, counted from the start of the source in UTF-16 code units
     * (the same as `Locatable.startPosition`). `linePositions[0]` is always `0`, and the index of each entry is its 0-based line number.
     *
     * For the source `a = 1\nb = 2`, this is `[0, 6]`. `util.getLocation()` uses it to convert a position into a line/character `Position`
     */
    linePositions: number[];
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
    return !!(obj?.kind && (obj.text || obj.kind === TokenKind.Eof));
}

/**
 * Is this a token that has the `TokenKind.Identifier` kind?
 */
export function isIdentifier(obj: any): obj is Identifier {
    return obj?.kind === TokenKind.Identifier;
}
