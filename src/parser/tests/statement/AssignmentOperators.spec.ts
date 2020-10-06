import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { createToken } from '../../../astUtils/creators';

describe('parser assignment operators', () => {
    it('+=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.PlusEqual),
            createToken(TokenKind.StringLiteral, `"lorem"`),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('-=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.MinusEqual),
            createToken(TokenKind.IntegerLiteral, '1'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('*=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.StarEqual),
            createToken(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('/=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.ForwardslashEqual),
            createToken(TokenKind.IntegerLiteral, '4'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('\\=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.BackslashEqual),
            createToken(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('<<=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.LeftShiftEqual),
            createToken(TokenKind.IntegerLiteral, '6'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('>>=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.RightShiftEqual),
            createToken(TokenKind.IntegerLiteral, '7'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });
});
