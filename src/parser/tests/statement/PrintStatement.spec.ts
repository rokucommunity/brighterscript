import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser print statements', () => {
    it('parses singular print statements', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Hello, world'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('supports empty print', () => {
        let { statements, diagnostics } = Parser.parse([token(TokenKind.Print), EOF]);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses print lists with no separator', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Foo', new BrsString('Foo')),
            token(TokenKind.StringLiteral, 'bar', new BrsString('bar')),
            token(TokenKind.StringLiteral, 'baz', new BrsString('baz')),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses print lists with separators', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            token(TokenKind.StringLiteral, 'Foo', new BrsString('Foo')),
            token(TokenKind.Semicolon),
            token(TokenKind.StringLiteral, 'bar', new BrsString('bar')),
            token(TokenKind.Semicolon),
            token(TokenKind.StringLiteral, 'baz', new BrsString('baz')),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it.only('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 1| print "foo"
         */
        let { statements, diagnostics } = Parser.parse([
            {
                kind: TokenKind.Print,
                text: 'print',
                isReserved: true,
                range: Range.create(0, 0, 1, 5)
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                isReserved: false,
                range: Range.create(0, 6, 0, 11)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 11, 0, 12)
            }
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).to.deep.include(Range.create(0, 0, 0, 11));
    });
});
