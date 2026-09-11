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
        //synthetic test tokens used to default to `null`, but the parser does range arithmetic
        //on token.location.range for paths like splitting `exitwhile` into two tokens. Give a
        //zero-width location at (0,0) so those paths work without each test having to spell it out.
        location: { uri: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
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
