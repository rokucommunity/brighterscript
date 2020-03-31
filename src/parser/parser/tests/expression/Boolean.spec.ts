/* eslint-disable */
import { expect } from 'chai';

import { Parser } from '../..';
import { BrsBoolean } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser boolean expressions', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    it('parses boolean ANDs', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.Equal, '='),
            token(Lexeme.True, 'true', BrsBoolean.True),
            token(Lexeme.And, 'and'),
            token(Lexeme.False, 'false', BrsBoolean.False),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('parses boolean ORs', () => {
        let { statements, errors } = parser.parse([
            identifier('_'),
            token(Lexeme.Equal, '='),
            token(Lexeme.True, 'true', BrsBoolean.True),
            token(Lexeme.Or, 'or'),
            token(Lexeme.False, 'false', BrsBoolean.False),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 1| a = true and false
         */
        let { statements, errors } = parser.parse([
            {
                kind: Lexeme.Identifier,
                text: 'a',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 1 },
                },
            },
            {
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 2 },
                    end: { line: 1, column: 3 },
                },
            },
            {
                kind: Lexeme.True,
                text: 'true',
                literal: BrsBoolean.True,
                isReserved: true,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 8 },
                },
            },
            {
                kind: Lexeme.And,
                text: 'and',
                isReserved: true,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 12 },
                },
            },
            {
                kind: Lexeme.False,
                text: 'false',
                literal: BrsBoolean.False,
                isReserved: true,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 18 },
                },
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 18 },
                    end: { line: 1, column: 19 },
                },
            },
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.location).deep.include({
            start: { line: 1, column: 4 },
            end: { line: 1, column: 18 },
        });
    });
});
