import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser additive expressions', () => {
    it('parses left-associative addition chains', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Plus, '+'),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Plus, '+'),
            token(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('parses left-associative subtraction chains', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Minus, '-'),
            token(TokenKind.IntegerLiteral, '3'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('tracks starting and ending locations', () => {
        // 0   0   0   1
        // 0   4   8   2
        // ^^ columns ^^
        //
        // _ = 1 + 2 + 3
        let { statements, diagnostics } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: '_',
                isReserved: false,
                range: Range.create(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 2, 0, 2)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '1',
                isReserved: false,
                range: Range.create(0, 4, 0, 5)
            },
            {
                kind: TokenKind.Plus,
                text: '+',
                isReserved: false,
                range: Range.create(0, 6, 0, 7)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '2',
                isReserved: false,
                range: Range.create(0, 8, 0, 9)
            },
            {
                kind: TokenKind.Plus,
                text: '+',
                isReserved: false,
                range: Range.create(0, 10, 0, 11)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '3',
                isReserved: false,
                range: Range.create(0, 12, 0, 13)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(0, 13, 0, 14)
            }
        ]) as any;

        expect(diagnostics[0]?.message).to.not.exist;
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.range).to.deep.include(
            Range.create(0, 4, 0, 13)
        );
    });
});
