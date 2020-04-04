import { expect } from 'chai';

import { Parser } from '../..';
import { BrsBoolean, BrsString, Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser while statements', () => {

    it('while without exit', () => {
        const { statements, errors } = Parser.parse([
            token(Lexeme.While, 'while'),
            token(Lexeme.True, 'true', BrsBoolean.True),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.Print, 'print'),
            token(Lexeme.String, 'looping', new BrsString('looping')),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.EndWhile, 'end while'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('while with exit', () => {
        const { statements, errors } = Parser.parse([
            token(Lexeme.While, 'while'),
            token(Lexeme.True, 'true', BrsBoolean.True),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.Print, 'print'),
            token(Lexeme.String, 'looping', new BrsString('looping')),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.ExitWhile, 'exit while'),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.EndWhile, 'end while'),
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
         * 1| while true
         * 2|   Rnd(0)
         * 3| end while
         */
        const { statements, errors } = Parser.parse([
            {
                kind: Lexeme.While,
                text: 'while',
                isReserved: true,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: Lexeme.True,
                text: 'true',
                literal: BrsBoolean.True,
                isReserved: true,
                location: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 10 }
                }
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 10 },
                    end: { line: 1, column: 11 }
                }
            },
            // loop body isn't significant for location tracking, so helper functions are safe
            identifier('Rnd'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.Integer, '0', new Int32(0)),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\n'),

            {
                kind: Lexeme.EndWhile,
                text: 'end while',
                isReserved: false,
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 9 }
                }
            },
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).deep.include({
            start: { line: 1, column: 0 },
            end: { line: 3, column: 9 }
        });
    });
});
