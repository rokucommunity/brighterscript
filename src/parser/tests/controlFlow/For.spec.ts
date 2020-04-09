import { expect } from 'chai';

import { Parser } from '../../Parser';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { Range } from 'vscode-languageserver';

describe('parser for loops', () => {
    it('accepts a \'step\' clause', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.For, 'for'),
            identifier('i'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '0', new Int32(0)),
            token(TokenKind.To, 'to'),
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            token(TokenKind.Step, 'step'),
            token(TokenKind.IntegerLiteral, '2', new Int32(2)),
            token(TokenKind.Newline, '\n'),
            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]) as any;

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        expect(statements[0]).to.exist;
        expect(statements[0].increment).to.exist;
        expect(statements[0].increment.value).to.include(new Int32(2));

        //expect(statements).toMatchSnapshot();
    });

    it('defaults a missing \'step\' clause to \'1\'', () => {
        let { statements, errors } = Parser.parse([
            token(TokenKind.For, 'for'),
            identifier('i'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '0', new Int32(0)),
            token(TokenKind.To, 'to'),
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            token(TokenKind.Newline, '\n'),
            // body would go here, but it's not necessary for this test
            token(TokenKind.EndFor, 'end for'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]) as any;

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        expect(statements[0]).to.exist;
        expect(statements[0].increment).to.exist;
        expect(statements[0].increment.value).to.include(new Int32(1));

        //expect(statements).toMatchSnapshot();
    });

    it('allows \'next\' to terminate loop', () => {
        let { statements, diagnostics: errors } = Parser.parse([
            token(TokenKind.For, 'for'),
            identifier('i'),
            token(TokenKind.Equal, '='),
            token(TokenKind.IntegerLiteral, '0', new Int32(0)),
            token(TokenKind.To, 'to'),
            token(TokenKind.IntegerLiteral, '5', new Int32(5)),
            token(TokenKind.Newline, '\n'),
            // body would go here, but it's not necessary for this test
            token(TokenKind.Next, 'next'),
            token(TokenKind.Newline, '\n'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
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
        let { statements, diagnostics: errors } = Parser.parse([
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
                literal: new Int32(0),
                isReserved: false,
                range: Range.create(0, 8, 0, 9)
            },
            {
                kind: TokenKind.To,
                text: 'to',
                isReserved: false,
                range: {
                    start: { line: 0, column: 10 },
                    end: { start: 0, column: 12 }
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '10',
                literal: new Int32(10),
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

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].range).to.deep.include(
            Range.create(0, 0, 2, 8)
        );
    });
});
