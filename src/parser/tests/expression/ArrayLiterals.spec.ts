import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { isArrayLiteralExpression, isAssignmentStatement, isDottedGetExpression, isLiteralExpression } from '../../../astUtils/reflection';
import type { AssignmentStatement } from '../../Statement';
import type { ArrayLiteralExpression } from '../../Expression';
import { util } from '../../../util';

describe('parser array literals', () => {
    describe('empty arrays', () => {
        it('on one line', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    describe('filled arrays', () => {
        it('on one line', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines with commas', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines without commas', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    describe('contents', () => {
        it('can contain primitives', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('can contain other arrays', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Comma, ','),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '4'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '5'),
                token(TokenKind.Comma, ','),
                token(TokenKind.IntegerLiteral, '6'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('can contain expressions', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Not, 'not'),
                token(TokenKind.False, 'false'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    describe('unfinished', () => {
        it('will still be parsed', () => {
            // no closing brace:
            let { ast, diagnostics } = Parser.parse(`_ = [1, data.foo`);

            expectDiagnostics(diagnostics, [DiagnosticMessages.unmatchedLeftSquareBraceAfterArrayLiteral()]);
            expect(ast.statements).to.be.lengthOf(1);
            expect(isAssignmentStatement(ast.statements[0])).to.be.true;
            const assignStmt = ast.statements[0] as AssignmentStatement;
            expect(isArrayLiteralExpression(assignStmt.value));
            const arryLitExpr = assignStmt.value as ArrayLiteralExpression;
            expect(isLiteralExpression(arryLitExpr.elements[0])).to.be.true;
            expect(isDottedGetExpression(arryLitExpr.elements[1])).to.be.true;
        });

        it('gets correct diagnostic for missing square brace without elements', () => {
            let { diagnostics } = Parser.parse(`
                sub setData()
                    m.data = [
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.unmatchedLeftSquareBraceAfterArrayLiteral()
            ]);
        });

        it('gets correct diagnostic for missing curly brace with elements', () => {
            let { diagnostics } = Parser.parse(`
                sub setData()
                    m.data = [1,2,3
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.unmatchedLeftSquareBraceAfterArrayLiteral()
            ]);
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 0| a = [   ]
         * 1|
         * 2| b = [
         * 3|
         * 4|
         * 5| ]
         */
        const parser = Parser.parse([
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
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 4, 0, 5)
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 8, 0, 9)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 9, 0, 10)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(1, 0, 1, 1)
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
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
                kind: TokenKind.LeftSquareBracket,
                text: '[',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(2, 4, 2, 5)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(3, 0, 3, 1)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(4, 0, 4, 1)
            },
            {
                kind: TokenKind.RightSquareBracket,
                text: ']',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(5, 0, 5, 1)
            },
            {
                kind: TokenKind.Eof,
                text: '',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(5, 1, 5, 2)
            }
        ]);

        expectZeroDiagnostics(parser);
        expect((parser.ast.statements[0] as AssignmentStatement).value.location.range).deep.include(
            Range.create(0, 4, 0, 9)
        );
        expect((parser.ast.statements[1] as AssignmentStatement).value.location.range).deep.include(
            Range.create(2, 4, 5, 1)
        );
    });
});
