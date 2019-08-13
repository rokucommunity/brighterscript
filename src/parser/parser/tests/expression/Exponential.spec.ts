import { expect } from 'chai';

import { Parser } from '../..';
import { Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    describe('exponential expressions', () => {
        it('parses exponential operators', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.Caret, '^'),
                token(Lexeme.Integer, '3', new Int32(3)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses repeated exponential operators as left-associative', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '2', new Int32(2)),
                token(Lexeme.Caret, '^'),
                token(Lexeme.Integer, '3', new Int32(3)),
                token(Lexeme.Caret, '^'),
                token(Lexeme.Integer, '4', new Int32(4)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
