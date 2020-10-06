import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { createToken } from '../../../astUtils/creators';

describe('parser', () => {
    describe('exponential expressions', () => {
        it('parses exponential operators', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Caret, '^'),
                createToken(TokenKind.IntegerLiteral, '3'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('parses repeated exponential operators as left-associative', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                createToken(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Caret, '^'),
                createToken(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Caret, '^'),
                createToken(TokenKind.IntegerLiteral, '4'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });
    });
});
