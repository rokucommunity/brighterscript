import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import type { AssignmentStatement } from '../../Statement';
import type { AALiteralExpression, AAMemberExpression } from '../../Expression';
import { isAALiteralExpression, isAAMemberExpression, isAssignmentStatement, isCommentStatement, isDottedGetExpression, isLiteralExpression } from '../../../astUtils/reflection';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics } from '../../../testHelpers.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';

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
        expect(statements).to.be.length.greaterThan(0);
    });

    it('allows a mix of quoted and unquoted keys', () => {
        let { statements, diagnostics } = Parser.parse([
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
        expect(statements).to.be.length.greaterThan(0);
    });

    it('captures commas', () => {
        let { statements } = Parser.parse(`
            _ = {
                p1: 1,
                p2: 2, 'comment
                p3: 3
                p4: 4
                'comment
                p5: 5,
            }
        `);
        const commas = ((statements[0] as AssignmentStatement).value as AALiteralExpression).elements
            .map(s => !isCommentStatement(s) && !!s.commaToken);
        expect(commas).to.deep.equal([
            true, // p1
            true, // p2
            false, // comment
            false, // p3
            false, // p4
            false, // comment
            true // p5
        ]);
    });

    describe('unfinished', () => {
        it('will still be parsed', () => {
            // No closing brace:
            let { statements, diagnostics } = Parser.parse(`_ = {name: "john", age: 42, address: data.address`);
            expectDiagnostics(diagnostics, [DiagnosticMessages.unmatchedLeftCurlyAfterAALiteral()]);
            expect(statements).to.be.lengthOf(1);
            expect(isAssignmentStatement(statements[0])).to.be.true;
            const assignStmt = statements[0] as AssignmentStatement;
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

    describe('computed keys', () => {
        it('parses [expr] computed key syntax', () => {
            const { statements, diagnostics } = Parser.parse(`
                _ = {
                    [someEnum.key]: "value"
                }
            `);
            expectZeroDiagnostics(diagnostics);
            const aaLit = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            expect(isAALiteralExpression(aaLit)).to.be.true;
            const member = aaLit.elements[0] as AAMemberExpression;
            expect(isAAMemberExpression(member)).to.be.true;
            expect(member.keyToken).to.be.null;
            expect(member.keyExpr).to.exist;
            expect(isDottedGetExpression(member.keyExpr)).to.be.true;
            expect(member.openBracketToken).to.exist;
            expect(member.closeBracketToken).to.exist;
        });

        it('parses [literal] computed key syntax', () => {
            const { statements, diagnostics } = Parser.parse(`
                _ = {
                    ["my-key"]: "value"
                }
            `);
            expectZeroDiagnostics(diagnostics);
            const aaLit = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            const member = aaLit.elements[0] as AAMemberExpression;
            expect(member.keyExpr).to.exist;
            expect(isLiteralExpression(member.keyExpr)).to.be.true;
        });

        it('errors on missing ] in computed key', () => {
            const { diagnostics } = Parser.parse(`
                _ = {
                    [someEnum.key: "value"
                }
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedRightSquareBracketAfterAAComputedKey()
            ]);
        });

        it('supports multiple computed keys in one AA', () => {
            const { statements, diagnostics } = Parser.parse(`
                _ = {
                    [myEnum.a]: 1,
                    [myEnum.b]: 2
                }
            `);
            expectZeroDiagnostics(diagnostics);
            const aaLit = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            expect(aaLit.elements).to.have.lengthOf(2);
            expect(isAAMemberExpression(aaLit.elements[0]) && (aaLit.elements[0] as AAMemberExpression).keyExpr).to.exist;
            expect(isAAMemberExpression(aaLit.elements[1]) && (aaLit.elements[1] as AAMemberExpression).keyExpr).to.exist;
        });

        it('supports mixing computed and non-computed keys', () => {
            const { statements, diagnostics } = Parser.parse(`
                _ = {
                    normalKey: 1,
                    [myEnum.computed]: 2
                }
            `);
            expectZeroDiagnostics(diagnostics);
            const aaLit = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            const first = aaLit.elements[0] as AAMemberExpression;
            const second = aaLit.elements[1] as AAMemberExpression;
            expect(first.keyExpr).to.not.exist;
            expect(first.keyToken).to.exist;
            expect(second.keyExpr).to.exist;
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
