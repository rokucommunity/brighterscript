import type { Token } from '../../lexer/Token';
import { TokenKind, ReservedWords } from '../../lexer/TokenKind';

/* A set of utilities to be used while writing tests for the BRS parser. */

/**
 * Creates a token with the given `kind` and (optional) `literal` value.
 */
export function token(kind: TokenKind, text?: string): Token {
    return {
        kind: kind,
        text: text!,
        isReserved: ReservedWords.has((text ?? '').toLowerCase()),
        location: null,
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

/** An end-of-file token. */
export const EOF = token(TokenKind.Eof, '\0');
