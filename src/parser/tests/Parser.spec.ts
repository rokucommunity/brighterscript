import type { Token } from '../../lexer/Token';
import { TokenKind, ReservedWords } from '../../lexer/TokenKind';
import type { Range } from 'vscode-languageserver';

/* A set of utilities to be used while writing tests for the BRS parser. */

/**
 * Creates a token with the given `kind` and (optional) `literal` value.
 */
export function token(kind: TokenKind, text?: string): Token {
    return {
        kind: kind,
        text: text!,
        isReserved: ReservedWords.has((text ?? '').toLowerCase()),
        range: null,
        leadingWhitespace: '',
        leadingTrivia: []
    };
}

/**
 * Creates an Identifier token with the given `text`.
 */
export function identifier(text: string) {
    return token(TokenKind.Identifier, text);
}

/**
 * Test whether a range matches a group of elements with a `range`
 */
export function rangeMatch(range: Range, elements: ({ range?: Range })[]): boolean {
    return range.start.line === elements[0].range.start.line &&
        range.start.character === elements[0].range.start.character &&
        range.end.line === elements[elements.length - 1].range.end.line &&
        range.end.character === elements[elements.length - 1].range.end.character;
}

/** An end-of-file token. */
export const EOF = token(TokenKind.Eof, '\0');
