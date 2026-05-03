import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import { ForEachStatement } from '../../Statement';
import { VariableExpression } from '../../Expression';
import { DiagnosticMessages } from '../../../DiagnosticMessages';

describe('parser foreach loops', () => {
    it('requires a name and target', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.ForEach, 'for each'),
            identifier('word'),
            identifier('in'),
            identifier('lipsum'),
            token(TokenKind.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;

        let forEach = statements[0] as any;
        expect(forEach).to.be.instanceof(ForEachStatement);

        expect(forEach.item).to.deep.include(identifier('word'));
        expect(forEach.target).to.be.instanceof(VariableExpression);
        expect(forEach.target.name).to.deep.include(identifier('lipsum'));
    });

    it('allows \'next\' to terminate loop', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.ForEach, 'for each'),
            identifier('word'),
            identifier('in'),
            identifier('lipsum'),
            token(TokenKind.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(TokenKind.Next, 'next'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).to.be.length.greaterThan(0);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| for each a in b
         * 1|   Rnd(a)
         * 2| end for
         */
        let { statements, diagnostics } = Parser.parse([
            {
                kind: TokenKind.ForEach,
                text: 'for each',
                isReserved: true,
                range: Range.create(0, 0, 0, 8)
            },
            {
                kind: TokenKind.Identifier,
                text: 'a',
                isReserved: false,
                range: Range.create(0, 9, 0, 10)
            },
            {
                kind: TokenKind.Identifier,
                text: 'in',
                isReserved: true,
                range: Range.create(0, 11, 0, 13)
            },
            {
                kind: TokenKind.Identifier,
                text: 'b',
                isReserved: false,
                range: Range.create(0, 14, 0, 15)
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                range: Range.create(0, 15, 0, 16)
            },
            // loop body isn't significant for location tracking, so helper functions are safe
            identifier('Rnd'),
            token(TokenKind.LeftParen, '('),
            identifier('a'),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            {
                kind: TokenKind.EndFor,
                text: 'end for',
                isReserved: false,
                range: Range.create(2, 0, 2, 7)
            },
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).deep.include(
            Range.create(0, 0, 2, 7)
        );
    });

    describe('terminator recovery', () => {
        it('emits a single targeted diagnostic for `for each ... end while`', () => {
            const parser = Parser.parse(`
                sub a()
                    for each x in arr
                        print x
                    end while
                end sub
            `);
            expect(parser.diagnostics).to.be.lengthOf(1);
            expect(parser.diagnostics[0].code).to.equal(DiagnosticMessages.forLoopTerminatedWithEndWhile().code);
        });

        it('stores the bogus `end while` token on the ForEachStatement', () => {
            const parser = Parser.parse(`
                sub a()
                    for each x in arr
                        print x
                    end while
                end sub
            `);
            const fn = parser.references.functionStatements[0];
            const forEachStmt = fn.func.body.statements[0] as ForEachStatement;
            expect(forEachStmt.tokens.endFor.kind).to.equal(TokenKind.EndWhile);
        });

        it('does not regress on the canonical `for each ... next` form', () => {
            const parser = Parser.parse(`
                sub a()
                    for each x in arr
                        print x
                    next
                end sub
            `);
            expect(parser.diagnostics).to.be.lengthOf(0);
        });
    });
});
