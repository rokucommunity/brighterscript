import { expect } from 'chai';
import { Parser } from '../../Parser';
import { TokenKind } from '../../../lexer/TokenKind';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';
import type { ForStatement } from '../../Statement';
import { LiteralExpression } from '../../Expression';

describe('parser for loops', () => {
    it('accepts a \'step\' clause', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.For, 'for'),
            identifier('i'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '0'),
            token(TokenKind.To, 'to'),
            token(TokenKind.IntegerLiteral, '5'),
            token(TokenKind.Step, 'step'),
            token(TokenKind.IntegerLiteral, '2'),
            token(TokenKind.Newline, '\n'),
            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]) as any;

        const statement = statements[0] as ForStatement;
        expect(diagnostics[0]?.message).not.to.exist;
        expect(statement.increment).to.be.instanceof(LiteralExpression);
        expect((statement.increment as LiteralExpression).tokens.value.text).to.equal('2');
    });

    it('supports omitted \'step\' clause', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.For, 'for'),
            identifier('i'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '0'),
            token(TokenKind.To, 'to'),
            token(TokenKind.IntegerLiteral, '5'),
            token(TokenKind.Newline, '\n'),
            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]) as any;

        expect(diagnostics[0]?.message).not.to.exist;
        expect((statements[0] as ForStatement).increment).not.to.exist;
    });

    it('catches unterminated for reaching function boundary', () => {
        const parser = Parser.parse(`
            function test()
                for i = 1 to 10
                    print "while"
            end function
        `);
        expect(parser.diagnostics).to.be.lengthOf(1);
        expect(parser.statements).to.be.lengthOf(1);
        expect(parser.references.functionStatements[0].func.body.statements).to.be.lengthOf(1);
    });

    it('allows \'next\' to terminate loop', () => {
        let { statements, diagnostics } = Parser.parse([
            token(TokenKind.For, 'for'),
            identifier('i'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '0'),
            token(TokenKind.To, 'to'),
            token(TokenKind.IntegerLiteral, '5'),
            token(TokenKind.Newline, '\n'),
            // body would go here, but it's not necessary for this test
            token(TokenKind.Next, 'next'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports a single trailing colon after the `to` expression', () => {
        const parser = Parser.parse(`
            for i = 1 to 3:
                print "for"
            end for
        `);
        expect(parser.diagnostics[0]?.message).to.be.undefined;
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 0| for i = 0 to 10
         * 1|   Rnd(i)
         * 2| end for
         */
        let { statements, diagnostics } = Parser.parse([
            {
                kind: TokenKind.For,
                text: 'for',
                isReserved: true,
                range: Range.create(0, 0, 0, 3)
            },
            {
                kind: TokenKind.Identifier,
                text: 'i',
                isReserved: false,
                range: Range.create(0, 4, 0, 5)
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                range: Range.create(0, 6, 0, 7)
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                isReserved: false,
                range: Range.create(0, 8, 0, 9)
            },
            {
                kind: TokenKind.To,
                text: 'to',
                isReserved: false,
                range: {
                    start: { line: 0, character: 10 },
                    end: { line: 0, character: 12 }
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '10',
                isReserved: false,
                range: Range.create(0, 13, 0, 15)
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
            identifier('i'),
            token(TokenKind.RightParen, ')'),
            token(TokenKind.Newline, '\n'),
            {
                kind: TokenKind.EndFor,
                text: 'end for',
                isReserved: false,
                range: Range.create(2, 0, 2, 8)
            },
            EOF
        ]);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).to.deep.include(
            Range.create(0, 0, 2, 8)
        );
    });
});
