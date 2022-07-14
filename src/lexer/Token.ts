import type { TokenKind } from './TokenKind';
import type { Range } from 'vscode-languageserver';

/**
 * Represents a chunk of BrightScript scanned by the lexer.
 */
export interface Token {
    /**
     * The type of token this represents.
     */
    kind: TokenKind;
    /** The text found in the original BrightScript source, if any. */
    text: string;
}

/**
 * Any object that has a range
 */
export interface Locatable {
    range: Range;
    [key: string]: any;
}
