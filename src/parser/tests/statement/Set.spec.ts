import { testLocatable } from '../../../testHelpers.spec';
import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import util from '../../../util';

describe('parser indexed assignment', () => {
    describe('dotted', () => {
        it('assigns anonymous functions', () => {
            let { ast, diagnostics } = Parser.parse([
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
            expect(ast.statements).to.exist;
            expect(ast.statements).not.to.be.null;
        });

        it('assigns boolean expressions', () => {
            let { ast, diagnostics } = Parser.parse([
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
            expect(ast.statements).to.exist;
            expect(ast.statements).not.to.be.null;
        });

        it('assignment operator', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.StarEqual, '*='),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Newline, '\\n'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(ast.statements).to.exist;
            expect(ast.statements).not.to.be.null;
        });
    });

    describe('bracketed', () => {
        it('assigns anonymous functions', () => {
            let { ast, diagnostics } = Parser.parse([
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
            expect(ast.statements).to.exist;
            expect(ast.statements).not.to.be.null;
        });

        it('assigns boolean expressions', () => {
            let { ast, diagnostics } = Parser.parse([
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
            expect(ast.statements).to.exist;
            expect(ast.statements).not.to.be.null;
        });

        it('assignment operator', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('someArray'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.StarEqual, '*='),
                token(TokenKind.IntegerLiteral, '3'),
                EOF
            ]);

            expect(diagnostics).to.be.empty;
            expect(ast.statements).to.exist;
            expect(ast.statements).not.to.be.null;
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
        let { ast, diagnostics } = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: 'arr',
                isReserved: false,
                ...testLocatable(0, 0, 0, 3),
                leadingTrivia: []
            },
            {
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                isReserved: false,
                ...testLocatable(0, 3, 0, 4),
                leadingTrivia: []
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                isReserved: false,
                ...testLocatable(0, 4, 0, 5),
                leadingTrivia: []
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                isReserved: false,
                ...testLocatable(0, 5, 0, 6),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                ...testLocatable(0, 7, 0, 8),
                leadingTrivia: []
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '1',
                isReserved: false,
                ...testLocatable(0, 9, 0, 10),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                ...testLocatable(0, 10, 0, 11),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'obj',
                isReserved: false,
                ...testLocatable(1, 0, 1, 3),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Dot,
                text: '.',
                isReserved: false,
                ...testLocatable(1, 3, 1, 4),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                ...testLocatable(1, 4, 1, 5),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                ...testLocatable(1, 6, 1, 7),
                leadingTrivia: []
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '5',
                isReserved: false,
                ...testLocatable(1, 8, 1, 9),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                ...testLocatable(1, 10, 1, 11),
                leadingTrivia: []
            }
        ]);

        expect(diagnostics).to.be.empty;
        expect(ast.statements).to.be.lengthOf(2);
        expect(ast.statements.map(s => util.getLocation(s)?.range)).to.deep.equal([
            Range.create(0, 0, 0, 10),
            Range.create(1, 0, 1, 9)
        ]);
    });
});
