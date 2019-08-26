import { expect } from 'chai';

import { Expr, Parser, Stmt } from '../..';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser foreach loops', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    it('requires a name and target', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.ForEach, 'for each'),
            identifier('word'),
            identifier('in'),
            identifier('lipsum'),
            token(Lexeme.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(Lexeme.EndFor, 'end for'),
            token(Lexeme.Newline, '\n'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;

        let forEach = statements[0];
        expect(forEach).to.be.instanceof(Stmt.ForEachStatement);

        expect(forEach.item).to.deep.include(identifier('word'));
        expect(forEach.target).to.be.instanceof(Expr.Variable);
        expect(forEach.target.name).to.deep.include(identifier('lipsum'));

        //expect(statements).toMatchSnapshot();
    });

    it('allows \'next\' to terminate loop', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.ForEach, 'for each'),
            identifier('word'),
            identifier('in'),
            identifier('lipsum'),
            token(Lexeme.Newline, '\n'),

            // body would go here, but it's not necessary for this test
            token(Lexeme.Next, 'next'),
            token(Lexeme.Newline, '\n'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| for each a in b
         * 2|   Rnd(a)
         * 3| end for
         */
        let { statements, errors } = parser.parse([
            {
                kind: Lexeme.ForEach,
                text: 'for each',
                isReserved: true,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 8 },
                },
            },
            {
                kind: Lexeme.Identifier,
                text: 'a',
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 },
                },
            },
            {
                kind: Lexeme.Identifier,
                text: 'in',
                isReserved: true,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 13 },
                },
            },
            {
                kind: Lexeme.Identifier,
                text: 'b',
                isReserved: false,
                location: {
                    start: { line: 1, column: 14 },
                    end: { line: 1, column: 15 },
                },
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 15 },
                    end: { line: 1, column: 16 },
                },
            },
            // loop body isn't significant for location tracking, so helper functions are safe
            identifier('Rnd'),
            token(Lexeme.LeftParen, '('),
            identifier('a'),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\n'),
            {
                kind: Lexeme.EndFor,
                text: 'end for',
                isReserved: false,
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 7 },
                },
            },
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).deep.include({
            start: { line: 1, column: 0 },
            end: { line: 3, column: 7 },
        });
    });
});
