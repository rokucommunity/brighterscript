import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { util } from '../../../util';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';
import type { AssignmentStatement } from '../../Statement';

describe('parser', () => {

    describe('function expressions', () => {
        it('parses minimal empty function expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses colon-separated function declarations', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'Lorem ipsum'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses non-empty function expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'Lorem ipsum'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses functions with implicit-dynamic arguments', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                identifier('a'),
                token(TokenKind.Comma, ','),
                identifier('b'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses functions with typed arguments', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                token(TokenKind.As, 'as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),
                identifier('separator'),
                token(TokenKind.As, 'as'),
                identifier('object'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses functions with default argument expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '4'),
                token(TokenKind.Comma, ','),

                identifier('c'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses functions with typed arguments and default expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses return types', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.As, 'as'),
                identifier('void'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    describe('sub expressions', () => {
        it('parses minimal sub expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses non-empty sub expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'Lorem ipsum'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses subs with implicit-dynamic arguments', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'sub'),
                token(TokenKind.LeftParen, '('),
                identifier('a'),
                token(TokenKind.Comma, ','),
                identifier('b'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses subs with typed arguments', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'sub'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                token(TokenKind.As, 'as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),
                identifier('cb'),
                token(TokenKind.As, 'as'),
                token(TokenKind.Function, 'function'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses subs with default argument expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '4'),
                token(TokenKind.Comma, ','),

                identifier('c'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('parses subs with typed arguments and default expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    describe('usage', () => {
        it('allows sub expressions in call arguments', () => {
            const { ast, diagnostics } = Parser.parse([
                identifier('acceptsCallback'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.Newline, '\\n'),

                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'I\'m a callback'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                token(TokenKind.Newline, '\\n'),

                token(TokenKind.RightParen, ')'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('allows function expressions in assignment RHS', () => {
            const { ast, diagnostics } = Parser.parse([
                identifier('anonymousFunction'),
                token(TokenKind.Equal, '='),

                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'I\'m anonymous'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),

                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| _ = sub foo()
         * 1|
         * 2| end sub
         */
        const parser = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: '_',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 0, 0, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 2, 0, 3)
            },
            {
                kind: TokenKind.Sub,
                text: 'sub',
                leadingTrivia: [],
                isReserved: true,
                location: util.createLocation(0, 4, 0, 7)
            },
            {
                kind: TokenKind.LeftParen,
                text: '(',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 11, 0, 12)
            },
            {
                kind: TokenKind.RightParen,
                text: ')',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 12, 0, 13)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 13, 0, 14)
            },
            {
                kind: TokenKind.EndSub,
                text: 'end sub',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 0, 2, 7)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 7, 2, 8)
            }
        ]);

        expectZeroDiagnostics(parser);
        expect((parser.ast.statements[0] as AssignmentStatement).value.location.range).to.deep.include(
            Range.create(0, 4, 2, 7)
        );
    });
});
