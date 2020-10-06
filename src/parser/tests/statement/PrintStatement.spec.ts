import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { createToken } from '../../../astUtils/creators';

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
            createToken(TokenKind.StringLiteral, 'Foo'),
            createToken(TokenKind.StringLiteral, 'bar'),
            createToken(TokenKind.StringLiteral, 'baz'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses print lists with separators', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Print),
            createToken(TokenKind.StringLiteral, 'Foo'),
            token(TokenKind.Semicolon),
            createToken(TokenKind.StringLiteral, 'bar'),
            token(TokenKind.Semicolon),
            createToken(TokenKind.StringLiteral, 'baz'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('location tracking', () => {
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
                range: Range.create(0, 0, 1, 5),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                isReserved: false,
                range: Range.create(0, 6, 0, 11),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 11, 0, 12),
                leadingWhitespace: ''
            }
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).to.deep.include(Range.create(0, 0, 0, 11));
    });
});
