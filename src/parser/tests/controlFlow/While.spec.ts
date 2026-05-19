import { expect } from '../../../chai-config.spec';

import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import type { FunctionStatement } from '../../Statement';
import { isFunctionStatement } from '../../../astUtils/reflection';
import util from '../../../util';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import type { WhileStatement } from '../../Statement';

describe('parser while statements', () => {

    it('while without exit', () => {
        const { ast, diagnostics } = Parser.parse([
            token(TokenKind.While, 'while'),
            token(TokenKind.True, 'true'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Print, 'print'),
            token(TokenKind.StringLiteral, 'looping'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndWhile, 'end while'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.length.greaterThan(0);
    });

    it('while with exit', () => {
        const { ast, diagnostics } = Parser.parse([
            token(TokenKind.While, 'while'),
            token(TokenKind.True, 'true'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.Print, 'print'),
            token(TokenKind.StringLiteral, 'looping'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.ExitWhile, 'exit while'),
            token(TokenKind.Newline, '\n'),
            token(TokenKind.EndWhile, 'end while'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(ast.statements).to.be.length.greaterThan(0);
    });

    it('supports trailing colon at end of condition', () => {
        const parser = Parser.parse(`
            while i > 0:
                print "while"
            end while
        `);
        expect(parser.diagnostics[0]?.message).to.be.undefined;
    });

    it('catches unterminated while reaching function boundary', () => {
        const parser = Parser.parse(`
            function test()
                while i > 0:
                    print "while"
            end function
        `);
        expect(parser.diagnostics).to.be.lengthOf(1);
        expect(parser.ast.statements).to.be.lengthOf(1);
        const functionStatements = parser.ast.findChildren<FunctionStatement>(isFunctionStatement);
        expect(functionStatements[0].func.body.statements).to.be.lengthOf(1);
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| while true
         * 1|   Rnd(0)
         * 2| end while
         */
        const { ast, diagnostics } = Parser.parse([
            {
                kind: TokenKind.While,
                text: 'while',
                isReserved: true,
                location: util.createLocation(0, 0, 0, 5),
                leadingTrivia: []
            },
            {
                kind: TokenKind.True,
                text: 'true',
                isReserved: true,
                location: util.createLocation(0, 6, 0, 10),
                leadingTrivia: []
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: util.createLocation(0, 10, 0, 11),
                leadingTrivia: []
            },
            // loop body isn't significant for location tracking, so helper functions are safe
            identifier('Rnd'),
            token(TokenKind.LeftParen, '('),
            token(TokenKind.IntegerLiteral),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            {
                kind: TokenKind.EndWhile,
                text: 'end while',
                isReserved: false,
                location: util.createLocation(2, 0, 2, 9),
                leadingTrivia: []
            },
            EOF
        ]);

        expect(diagnostics[0]?.message).not.to.exist;
        expect(ast.statements).to.be.lengthOf(1);
        expect(ast.statements[0].location.range).deep.include(
            Range.create(0, 0, 2, 9)
        );
    });

    describe('terminator recovery', () => {
        it('emits a single targeted diagnostic for `while ... next`', () => {
            const parser = Parser.parse(`
                sub a()
                    while n <= 3
                        n = n + 1
                    next
                end sub
            `);
            expect(parser.diagnostics).to.be.lengthOf(1);
            expect(parser.diagnostics[0].code).to.equal(DiagnosticMessages.mismatchedEndingToken().code);
            expect((parser.diagnostics[0] as any).data).to.eql({ expected: ['end while'], found: 'next' });
        });

        it('stores the bogus `next` token on the WhileStatement so a quick fix can target it', () => {
            const parser = Parser.parse(`
                sub a()
                    while n <= 3
                        n = n + 1
                    next
                end sub
            `);
            const fn = parser.ast.findChild<FunctionStatement>(isFunctionStatement);
            const whileStmt = fn.func.body.statements[0] as WhileStatement;
            expect(whileStmt.tokens.endWhile.kind).to.equal(TokenKind.Next);
            expect(whileStmt.tokens.endWhile.text).to.equal('next');
        });

        it('does not flag a valid `for ... next` nested inside a while loop', () => {
            const parser = Parser.parse(`
                sub a()
                    while n <= 3
                        for i = 0 to 3
                            print i
                        next
                        n = n + 1
                    end while
                end sub
            `);
            expect(parser.diagnostics).to.be.lengthOf(0);
        });

        it('still reports the original diagnostic when the while runs off the end of the file', () => {
            const parser = Parser.parse(`
                while n <= 3
                    n = n + 1
            `);
            expect(parser.diagnostics).to.be.lengthOf(1);
            expect(parser.diagnostics[0].code).to.equal(DiagnosticMessages.couldNotFindMatchingEndKeyword('while').code);
        });
    });
});
