import { expect } from '../../../chai-config.spec';
import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { util } from '../../../util';
import type { AssignmentStatement } from '../../Statement';
import { expectZeroDiagnostics } from '../../../testHelpers.spec';

describe('parser primary expressions', () => {

    it('parses numeric literals', () => {
        let equals = token(TokenKind.Equal, '=');
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            equals,
            token(TokenKind.IntegerLiteral, '5'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.have.length.greaterThan(0);
    });

    it('parses string literals', () => {
        let equals = token(TokenKind.Equal, '=');
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            equals,
            token(TokenKind.StringLiteral, 'hello'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.have.length.greaterThan(0);
    });

    it('parses expressions in parentheses', () => {
        let { statements, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Plus, '+'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Star, '*'),
            token(TokenKind.IntegerLiteral, '3'),
            token(TokenKind.RightParen, ')'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.have.length.greaterThan(0);

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
        let parser = Parser.parse([
            {
                kind: TokenKind.Identifier,
                text: 'a',
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
                kind: TokenKind.IntegerLiteral,
                text: '5',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 4, 0, 5)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 5, 0, 6)
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(1, 0, 1, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(1, 2, 1, 3)
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"foo"`,
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(1, 4, 1, 9)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(1, 9, 1, 10)
            },
            {
                kind: TokenKind.Identifier,
                text: 'c',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 0, 2, 1)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 2, 2, 3)
            },
            {
                kind: TokenKind.LeftParen,
                text: '(',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 4, 2, 5)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 6, 2, 7)
            },
            {
                kind: TokenKind.RightParen,
                text: ')',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 8, 2, 9)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(1, 9, 1, 10) //TODO are these numbers right?
            }
        ]);
        const statements = parser.ast.statements as AssignmentStatement[];

        expectZeroDiagnostics(parser);
        expect(statements[0].value.location.range).to.deep.include(
            Range.create(0, 4, 0, 5)
        );
        expect(statements[1].value.location.range).to.deep.include(
            Range.create(1, 4, 1, 9)
        );
        expect(statements[2].value.location.range).to.deep.include(
            Range.create(2, 4, 2, 9)
        );
    });
});
