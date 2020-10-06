import { expect } from 'chai';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { createToken } from '../../../astUtils/creators';

describe('parser associative array literals', () => {
    describe('empty associative arrays', () => {
        it('on one line', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });
    });

    describe('filled arrays', () => {
        it('on one line', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines with commas', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines without commas', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Newline, '\n'),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Newline, '\n'),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                createToken(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });
    });

    it('allows separating properties with colons', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.Sub, 'sub'),
            identifier('main'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            identifier('person'),
            token(TokenKind.Equal, '='),
            token(TokenKind.LeftCurlyBrace, '{'),
            identifier('name'),
            token(TokenKind.Colon, ':'),
            createToken(TokenKind.StringLiteral, 'Bob'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            identifier('age'),
            token(TokenKind.Colon, ':'),
            createToken(TokenKind.IntegerLiteral, '50'),
            token(TokenKind.RightCurlyBrace, '}'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndSub, 'end sub'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('allows a mix of quoted and unquoted keys', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.LeftCurlyBrace, '{'),
            token(TokenKind.Newline, '\n'),
            createToken(TokenKind.StringLiteral, 'foo'),
            token(TokenKind.Colon, ':'),
            createToken(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Comma, ','),
            token(TokenKind.Newline, '\n'),
            identifier('bar'),
            token(TokenKind.Colon, ':'),
            createToken(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Comma, ','),
            token(TokenKind.Newline, '\n'),
            createToken(TokenKind.StringLiteral, 'requires-hyphens'),
            token(TokenKind.Colon, ':'),
            createToken(TokenKind.IntegerLiteral, '3'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.RightCurlyBrace, '}'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 1| a = {   }
         * 2|
         * 3| b = {
         * 4|
         * 5|
         * 6| }
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
                kind: TokenKind.LeftCurlyBrace,
                text: '{',
                isReserved: false,
                range: Range.create(0, 4, 0, 5)
            },
            {
                kind: TokenKind.RightCurlyBrace,
                text: '}',
                isReserved: false,
                range: Range.create(0, 8, 0, 9)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 9, 0, 10)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(1, 0, 1, 1)
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
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
                kind: TokenKind.LeftCurlyBrace,
                text: '{',
                isReserved: false,
                range: Range.create(2, 4, 2, 5)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(3, 0, 3, 1)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(4, 0, 4, 1)
            },
            {
                kind: TokenKind.RightCurlyBrace,
                text: '}',
                isReserved: false,
                range: Range.create(5, 0, 5, 1)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                range: Range.create(5, 1, 5, 2)
            }
        ]) as any;

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(2);
        expect(statements[0].value.range).to.deep.include(
            Range.create(0, 4, 0, 9)
        );
        expect(statements[1].value.range).to.deep.include(
            Range.create(2, 4, 5, 1)
        );
    });
});
