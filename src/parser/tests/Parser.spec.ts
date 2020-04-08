import { TokenKind, ReservedWords, Token } from '../../lexer';
import { Range } from 'vscode-languageserver';

/* A set of utilities to be used while writing tests for the BRS parser. */

/**
 * Creates a token with the given `kind` and (optional) `literal` value.
 * @param {TokenKind} kind the tokenKind the produced token should represent.
 * @param {string} text the text represented by this token.
 * @param {*} [literal] the literal value that the produced token should contain, if any
 * @returns {object} a token of `kind` representing `text` with value `literal`.
 */
export function token(kind, text?, literal?): Token {
    return {
        kind: kind,
        text: text,
        isReserved: ReservedWords.has((text || '').toLowerCase()),
        literal: literal,
        range: Range.create(-9, -9, -9, -9)
    };
}

/**
 * Creates an Identifier token with the given `text`.
 * @param {string} text
 * @returns {object} a token with the provided `text`.
 */
export function identifier(text) {
    return exports.token(TokenKind.Identifier, text);
}

/** An end-of-file token. */
export const EOF = token(TokenKind.Eof, '\0');
