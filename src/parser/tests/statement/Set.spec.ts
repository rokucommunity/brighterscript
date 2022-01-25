import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser indexed assignment', () => {
    describe('dotted', () => {
        it('assigns anonymous functions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });

        it('assigns boolean expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.And, 'and'),
                token(TokenKind.False, 'false'),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });

        it('assignment operator', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.StarEqual, '*='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });
    });

    describe('bracketed', () => {
        it('assigns anonymous functions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });

        it('assigns boolean expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.And, 'and'),
                token(TokenKind.False, 'false'),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });

        it('assignment operator', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.StarEqual, '*='),
                token(TokenKind.IntegerLiteral, '3'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| arr[0] = 1
         * 1| obj.a = 5
         */
        let { statements, diagnostics } = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: 'arr',
                isReserved: false,
                range: Range.create(0, 0, 0, 3),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                range: Range.create(0, 3, 0, 4),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                isReserved: false,
                range: Range.create(0, 4, 0, 5),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                range: Range.create(0, 5, 0, 6),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 7, 0, 8),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '1',
                isReserved: false,
                range: Range.create(0, 9, 0, 10),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 10, 0, 11),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Identifier,
                text: 'obj',
                isReserved: false,
                range: Range.create(1, 0, 1, 3),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Dot,
                text: '.',
                isReserved: false,
                range: Range.create(1, 3, 1, 4),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                range: Range.create(1, 4, 1, 5),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(1, 6, 1, 7),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '5',
                isReserved: false,
                range: Range.create(1, 8, 1, 9),
                leadingWhitespace: ''
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(1, 10, 1, 11),
                leadingWhitespace: ''
            }
        ]);

        expect(diagnostics).to.be.empty;
        expect(statements).to.be.lengthOf(2);
        expect(statements.map(s => s.range)).to.deep.equal([
            Range.create(0, 0, 0, 10),
            Range.create(1, 0, 1, 9)
        ]);
    });
});
