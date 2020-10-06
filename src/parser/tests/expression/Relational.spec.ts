import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { createToken } from '../../../astUtils/creators';

describe('parser', () => {

    describe('relational expressions', () => {
        it('parses less-than expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Less, '<'),
                createToken(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('parses less-than-or-equal-to expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.LessEqual, '<='),
                createToken(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

        });

        it('parses greater-than expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Greater, '>'),
                createToken(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

        });

        it('parses greater-than-or-equal-to expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.GreaterEqual, '>='),
                createToken(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('parses equality expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

        });

        it('parses inequality expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.LessGreater, '<>'),
                createToken(TokenKind.IntegerLiteral, '2'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });
    });
});
