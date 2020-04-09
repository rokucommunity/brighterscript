import { expect } from 'chai';

import { Parser } from '../../Parser';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser primary expressions', () => {

    it('parses numeric literals', () => {
        let equals = token(TokenKind.Equal, '=');
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            equals,
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.have.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses string literals', () => {
        let equals = token(TokenKind.Equal, '=');
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            equals,
            token(TokenKind.StringLiteral, 'hello', new BrsString('hello')),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.have.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses expressions in parentheses', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '1', new Int32(1)),
            token(TokenKind.Plus, '+'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.IntegerLiteral, '2', new Int32(2)),
            token(TokenKind.Star, '*'),
            token(TokenKind.IntegerLiteral, '3', new Int32(3)),
            token(TokenKind.RightParen, ')'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.have.length.greaterThan(0);

        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 0| a = 5
         * 1| b = "foo"
         * 2| c = ( 0 )
         */
        let { statements, diagnostics } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                range: Range.create(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 2, 0, 3)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '5',
                literal: new Int32(5),
                isReserved: false,
                range: Range.create(0, 4, 0, 5)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 5, 0, 6)
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
                isReserved: false,
                range: Range.create(1, 0, 1, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(1, 2, 1, 3)
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                literal: new BrsString('foo'),
                isReserved: false,
                range: Range.create(1, 4, 1, 9)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(1, 9, 1, 10)
            },
            {
                kind: TokenKind.Identifier,
                text: 'c',
                isReserved: false,
                range: Range.create(2, 0, 2, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(2, 2, 2, 3)
            },
            {
                kind: TokenKind.LeftParen,
                text: '(',
                isReserved: false,
                range: Range.create(2, 4, 2, 5)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                literal: new Int32(0),
                isReserved: false,
                range: Range.create(2, 6, 2, 7)
            },
            {
                kind: TokenKind.RightParen,
                text: ')',
                isReserved: false,
                range: Range.create(2, 8, 2, 9)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(1, 9, 1, 10) //TODO are these numbers right?
            }
        ]) as any;

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(3);
        expect(statements[0].value.range).to.deep.include(
            Range.create(0, 4, 0, 5)
        );
        expect(statements[1].value.range).to.deep.include(
            Range.create(1, 4, 1, 9)
        );
        expect(statements[2].value.range).to.deep.include(
            Range.create(2, 4, 2, 9)
        );
    });
});
