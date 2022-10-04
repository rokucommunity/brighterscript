import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser prefix unary expressions', () => {

    it('parses unary \'not\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Not, 'not'),
            token(TokenKind.True, 'true'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses consecutive unary \'not\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.Not, 'not'),
            token(TokenKind.True, 'true'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses unary \'-\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses consecutive unary \'-\'', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 1| _false = not true
         */
        let { statements, diagnostics } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: '_false',
                isReserved: false,
                range: Range.create(0, 0, 0, 6)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 7, 0, 8)
            },
            {
                kind: TokenKind.Not,
                text: 'not',
                isReserved: true,
                range: Range.create(0, 9, 0, 12)
            },
            {
                kind: TokenKind.True,
                text: 'true',
                isReserved: true,
                range: Range.create(0, 13, 0, 17)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 17, 0, 18)
            }
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect((statements[0] as any).value.range).to.deep.include(
            Range.create(0, 9, 0, 17)
        );
    });
});
