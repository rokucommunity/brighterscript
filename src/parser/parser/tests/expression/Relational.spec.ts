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

    describe('relational expressions', () => {
        it('parses less-than expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.Less, '<'),
                token(Lexeme.Integer, '2', new Int32(2)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses less-than-or-equal-to expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.LessEqual, '<='),
                token(Lexeme.Integer, '2', new Int32(2)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses greater-than expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.Greater, '>'),
                token(Lexeme.Integer, '2', new Int32(2)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses greater-than-or-equal-to expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.GreaterEqual, '>='),
                token(Lexeme.Integer, '2', new Int32(2)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses equality expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '2', new Int32(2)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses inequality expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.LessGreater, '<>'),
                token(Lexeme.Integer, '2', new Int32(2)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
