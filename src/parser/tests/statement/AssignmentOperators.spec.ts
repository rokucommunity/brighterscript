import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser assignment operators', () => {
    it('+=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.PlusEqual),
            token(TokenKind.StringLiteral, `"lorem"`),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('-=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.MinusEqual),
            token(TokenKind.IntegerLiteral, '1'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('*=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.StarEqual),
            token(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('/=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.ForwardslashEqual),
            token(TokenKind.IntegerLiteral, '4'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('\\=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.BackslashEqual),
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('<<=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.LeftShiftEqual),
            token(TokenKind.IntegerLiteral, '6'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });

    it('>>=', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.RightShiftEqual),
            token(TokenKind.IntegerLiteral, '7'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
    });
});
