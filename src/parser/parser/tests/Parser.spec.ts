import { TokenKind, Location, ReservedWords } from '../../lexer';

/* A set of utilities to be used while writing tests for the BRS parser. */

/**
 * Creates a token with the given `kind` and (optional) `literal` value.
 * @param {TokenKind} kind the lexeme the produced token should represent.
 * @param {string} text the text represented by this token.
 * @param {*} [literal] the literal value that the produced token should contain, if any
 * @returns {object} a token of `kind` representing `text` with value `literal`.
 */
export function token(kind, text?, literal?) {
    return {
        kind: kind,
        text: text,
        isReserved: ReservedWords.has((text || '').toLowerCase()),
        literal: literal,
        location: <Location>{
            start: { line: -9, column: -9 },
            end: { line: -9, column: -9 }
        }
    };
}

/**
 * Creates an Identifier token with the given `text`.
 * @param {string} text
 * @returns {object} a token with the provided `text`.
 */
export function identifier(text) {
    return exports.token(TokenKind.IdentifierLiteral, text);
}

/** An end-of-file token. */
export const EOF = token(TokenKind.Eof, '\0');
