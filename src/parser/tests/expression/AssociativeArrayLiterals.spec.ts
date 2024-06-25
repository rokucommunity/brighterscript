import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import type { AssignmentStatement } from '../../Statement';
import type { AALiteralExpression, AAMemberExpression } from '../../Expression';
import { isAALiteralExpression, isAssignmentStatement, isDottedGetExpression, isLiteralExpression } from '../../../astUtils/reflection';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { util } from '../../../util';

describe('parser associative array literals', () => {
    describe('empty associative arrays', () => {
        it('on one line', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines', () => {
            let { ast, diagnostics } = Parser.parse([
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
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    describe('filled arrays', () => {
        it('on one line', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines with commas', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Comma, ','),
                token(TokenKind.Newline, '\n'),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });

        it('on multiple lines without commas', () => {
            let { ast, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.LeftCurlyBrace, '{'),
                token(TokenKind.Newline, '\n'),
                identifier('foo'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Newline, '\n'),
                identifier('bar'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Newline, '\n'),
                identifier('baz'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.IntegerLiteral, '3'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.RightCurlyBrace, '}'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(ast.statements).to.be.length.greaterThan(0);
        });
    });

    it('allows separating properties with colons', () => {
        let { ast, diagnostics } = Parser.parse([
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
            token(TokenKind.StringLiteral, 'Bob'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.Colon, ':'),
            identifier('age'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '50'),
            token(TokenKind.RightCurlyBrace, '}'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndSub, 'end sub'),
            EOF
        ]);
        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.length.greaterThan(0);
    });

    it('allows a mix of quoted and unquoted keys', () => {
        let { ast, diagnostics } = Parser.parse([
            identifier('_'),
            token(TokenKind.Equal, '='),
            token(TokenKind.LeftCurlyBrace, '{'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.StringLiteral, 'foo'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '1'),
            token(TokenKind.Comma, ','),
            token(TokenKind.Newline, '\n'),
            identifier('bar'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Comma, ','),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.StringLiteral, 'requires-hyphens'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.IntegerLiteral, '3'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.RightCurlyBrace, '}'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.length.greaterThan(0);
    });

    it('captures commas', () => {
        let { ast } = Parser.parse(`
            _ = {
                p1: 1,
                p2: 2, 'comment
                p3: 3
                p4: 4
                'comment
                p5: 5,
            }
        `);
        const commas = ((ast.statements[0] as AssignmentStatement).value as AALiteralExpression).elements
            .map(s => !!s.tokens.comma);
        expect(commas).to.deep.equal([
            true, // p1
            true, // p2
            false, // p3
            false, // p4
            true // p5
        ]);
    });

    describe('unfinished', () => {
        it('will still be parsed', () => {
            // No closing brace:
            let { ast, diagnostics } = Parser.parse(`_ = {name: "john", age: 42, address: data.address`);
            expectDiagnostics(diagnostics, [DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral()]);
            expect(ast.statements).to.be.lengthOf(1);
            expect(isAssignmentStatement(ast.statements[0])).to.be.true;
            const assignStmt = ast.statements[0] as AssignmentStatement;
            expect(isAALiteralExpression(assignStmt.value));
            const aaLitExpr = assignStmt.value as AALiteralExpression;
            expect(aaLitExpr.elements).to.be.lengthOf(3);
            const memberExprs = aaLitExpr.elements as AAMemberExpression[];
            expect(isLiteralExpression(memberExprs[0].value)).to.be.true;
            expect(isLiteralExpression(memberExprs[1].value)).to.be.true;
            expect(isDottedGetExpression(memberExprs[2].value)).to.be.true;
        });

        it('gets correct diagnostic for missing curly brace without final value', () => {
            let { diagnostics } = Parser.parse(`
                sub setData()
                    m.data = {hello:
                end sub
            `);
            expectDiagnostics(diagnostics, [
                DiagnosticMessages.unexpectedToken('\n'),
                DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral()
            ]);
        });

        it('gets correct diagnostic for missing curly brace with final value', () => {
            let { diagnostics } = Parser.parse(`

                sub setData()
                    m.data = {hello: "world"
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral()
            ]);
        });
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
                kind: TokenKind.LeftCurlyBrace,
                text: '{',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(0, 4, 0, 5)
            },
            {
                kind: TokenKind.RightCurlyBrace,
                text: '}',
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
                kind: TokenKind.LeftCurlyBrace,
                text: '{',
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
                kind: TokenKind.RightCurlyBrace,
                text: '}',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(5, 0, 5, 1)
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                leadingTrivia: [],
                isReserved: false,
                location: util.createLocation(5, 1, 5, 2)
            }
        ]);

        expectZeroDiagnostics(parser);
        expect((parser.ast.statements[0] as AssignmentStatement).value.location.range).to.deep.include(
            Range.create(0, 4, 0, 9)
        );
        expect((parser.ast.statements[1] as AssignmentStatement).value.location.range).to.deep.include(
            Range.create(2, 4, 5, 1)
        );
    });
});
