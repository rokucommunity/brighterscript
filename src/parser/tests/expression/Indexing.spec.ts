import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { AssignmentStatement, DottedSetStatement, IndexedSetStatement } from '../../Statement';
import { expectDiagnostics, expectDiagnosticsIncludes } from '../../../testHelpers.spec';
import { isAssignmentStatement, isDottedGetExpression, isDottedSetStatement, isIndexedGetExpression, isIndexedSetStatement, isLiteralExpression, isVariableExpression } from '../../../astUtils/reflection';
import type { DottedGetExpression, IndexedGetExpression, VariableExpression } from '../../Expression';
import { WalkMode } from '../../../astUtils/visitors';


describe('parser indexing', () => {
    describe('one level', () => {
        it('dotted', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });

        it('bracketed', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
        });

        describe('dotted and bracketed', () => {
            it('single dot', () => {
                let { statements, diagnostics } = Parser.parse([
                    identifier('_'),
                    token(TokenKind.Equal, '='),
                    identifier('foo'),
                    token(TokenKind.Dot, '.'),
                    token(TokenKind.LeftSquareBracket, '['),
                    token(TokenKind.Integer, '2'),
                    token(TokenKind.RightSquareBracket, ']'),
                    EOF
                ]);

                expect(diagnostics).to.be.empty;
                expect(statements[0]).to.be.instanceof(AssignmentStatement);
            });

            it('multiple dots', () => {
                let { diagnostics, statements } = Parser.parse([
                    identifier('_'),
                    token(TokenKind.Equal, '='),
                    identifier('foo'),
                    token(TokenKind.Dot, '.'),
                    token(TokenKind.Dot, '.'),
                    token(TokenKind.Dot, '.'),
                    token(TokenKind.LeftSquareBracket, '['),
                    token(TokenKind.Integer, '2'),
                    token(TokenKind.RightSquareBracket, ']'),
                    token(TokenKind.Newline),
                    EOF
                ]);

                expect(diagnostics.length).to.equal(3);
                expectDiagnostics(diagnostics, [
                    DiagnosticMessages.expectedPropertyNameAfterPeriod(), // expected name after first dot
                    DiagnosticMessages.expectedNewlineOrColon(), // expected newline after "_ = foo" statement
                    DiagnosticMessages.unexpectedToken('.') // everything after the 2nd dot is ignored
                ]);
                // expect statement "_ = foo" to still be included
                expect(statements.length).to.equal(1);
            });
        });

        it('location tracking', () => {
            /**
             *    0   0   0   1
             *    0   4   8   2
             *  +--------------
             * 0| a = foo.bar
             * 1| b = foo[2]
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
                    kind: TokenKind.Identifier,
                    text: 'foo',
                    isReserved: false,
                    range: Range.create(0, 4, 0, 7)
                },
                {
                    kind: TokenKind.Dot,
                    text: '.',
                    isReserved: false,
                    range: Range.create(0, 7, 0, 8)
                },
                {
                    kind: TokenKind.Identifier,
                    text: 'bar',
                    isReserved: false,
                    range: Range.create(0, 8, 0, 11)
                },
                {
                    kind: TokenKind.Newline,
                    text: '\n',
                    isReserved: false,
                    range: Range.create(0, 11, 0, 12)
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
                    kind: TokenKind.Identifier,
                    text: 'bar',
                    isReserved: false,
                    range: Range.create(1, 4, 1, 7)
                },
                {
                    kind: TokenKind.LeftSquareBracket,
                    text: '[',
                    isReserved: false,
                    range: Range.create(1, 7, 1, 8)
                },
                {
                    kind: TokenKind.IntegerLiteral,
                    text: '2',
                    isReserved: false,
                    range: Range.create(1, 8, 1, 9)
                },
                {
                    kind: TokenKind.RightSquareBracket,
                    text: ']',
                    isReserved: false,
                    range: Range.create(1, 9, 1, 10)
                },
                {
                    kind: TokenKind.Eof,
                    text: '\0',
                    isReserved: false,
                    range: Range.create(1, 10, 1, 11)
                }
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.lengthOf(2);
            expect(statements.map(s => (s as any).value.range)).to.deep.equal([
                Range.create(0, 4, 0, 11),
                Range.create(1, 4, 1, 10)
            ]);
        });
    });

    it('walks every index in the indexed get', () => {
        const parser = Parser.parse(`
            result = arr[0, 1, 2]
        `);
        const nodes = [];
        parser.ast.findChild<AssignmentStatement>(isAssignmentStatement).value.walk((x) => {
            if (isLiteralExpression(x)) {
                nodes.push(x.token.text);
            }
        }, { walkMode: WalkMode.visitAllRecursive });
        expect(nodes).to.eql(['0', '1', '2']);
    });

    it('walks every index in the indexed get', () => {
        const parser = Parser.parse(`
            arr[0, 1, 2] = "value"
        `);
        const nodes = [];
        parser.ast.findChild<IndexedSetStatement>(isIndexedSetStatement).walk((x) => {
            if (isLiteralExpression(x)) {
                nodes.push(x.token.text);
            }
        }, { walkMode: WalkMode.visitAllRecursive });
        expect(nodes).to.eql(['0', '1', '2', '"value"']);
    });

    describe('multi-level', () => {
        it('dotted', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('bracketed', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '6'),
                token(TokenKind.RightSquareBracket, ']'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('mixed', () => {
            let { statements, diagnostics } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                identifier('foo'),
                token(TokenKind.Dot, '.'),
                identifier('bar'),
                token(TokenKind.LeftSquareBracket, '['),
                token(TokenKind.IntegerLiteral, '0'),
                token(TokenKind.RightSquareBracket, ']'),
                token(TokenKind.Dot, '.'),
                identifier('baz'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });
    });

    describe('unfinished brackets', () => {
        it('parses expression inside of brackets', () => {
            let { statements, diagnostics } = Parser.parse(`_ = foo[bar.baz.`);

            expect(diagnostics.length).to.be.greaterThan(0);
            expect(statements).to.be.lengthOf(1);
            expect(isAssignmentStatement(statements[0])).to.be.true;
            const assignStmt = statements[0] as AssignmentStatement;
            expect(assignStmt.name.text).to.equal('_');
            expect(isIndexedGetExpression(assignStmt.value)).to.be.true;
            const indexedGetExpr = assignStmt.value as IndexedGetExpression;
            expect((indexedGetExpr.obj as VariableExpression).name.text).to.equal('foo');
            expect(isDottedGetExpression(indexedGetExpr.index)).to.be.true;
            const dottedGetExpr = indexedGetExpr.index as DottedGetExpression;
            expect(dottedGetExpr.name.text).to.equal('baz');
            expect(isVariableExpression(dottedGetExpr.obj)).to.be.true;
        });

        it('gets correct diagnostic for missing square brace without index', () => {
            let { diagnostics } = Parser.parse(`
                sub setData(obj)
                    m.data = obj[
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedRightSquareBraceAfterArrayOrObjectIndex()
            ]);
        });

        it('gets correct diagnostic for missing square brace with index', () => {
            let { diagnostics } = Parser.parse(`
                sub setData(obj)
                    m.data = obj[1
                end sub
            `);
            expectDiagnosticsIncludes(diagnostics, [
                DiagnosticMessages.expectedRightSquareBraceAfterArrayOrObjectIndex()
            ]);
        });
    });
});
