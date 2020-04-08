import { expect } from 'chai';

import { Parser } from '../../parser';
import { Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

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
        let { statements, errors } = Parser.parse([
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
         * 1| for i = 0 to 10
         * 2|   Rnd(i)
         * 3| end for
         */
        let { statements, errors } = Parser.parse([
            {
                kind: TokenKind.For,
                text: 'for',
                isReserved: true,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: TokenKind.Identifier,
                text: 'i',
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 7 }
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '0',
                literal: new Int32(0),
                isReserved: false,
                location: {
                    start: { line: 1, column: 8 },
                    end: { line: 1, column: 9 }
                }
            },
            {
                kind: TokenKind.To,
                text: 'to',
                isReserved: false,
                location: {
                    start: { line: 1, column: 10 },
                    end: { start: 1, column: 12 }
                }
            },
            {
                kind: TokenKind.IntegerLiteral,
                text: '10',
                literal: new Int32(10),
                isReserved: false,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 15 }
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 15 },
                    end: { line: 1, column: 16 }
                }
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
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 8 }
                }
            },
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).to.deep.include({
            start: { line: 1, column: 0 },
            end: { line: 3, column: 8 }
        });
    });
});
