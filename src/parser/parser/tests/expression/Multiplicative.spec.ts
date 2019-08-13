import { expect } from 'chai';

import { Parser } from '../..';
import { Float } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    describe('multiplicative expressions', () => {
        it('parses left-associative multiplication chains', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Float, '3.0', new Float(3.0)),
                token(Lexeme.Star, '*'),
                token(Lexeme.Float, '5.0', new Float(5.0)),
                token(Lexeme.Star, '*'),
                token(Lexeme.Float, '7.0', new Float(7.0)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses left-associative division chains', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Float, '7.0', new Float(7.0)),
                token(Lexeme.Slash, '/'),
                token(Lexeme.Float, '5.0', new Float(5.0)),
                token(Lexeme.Slash, '/'),
                token(Lexeme.Float, '3.0', new Float(3.0)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses left-associative modulo chains', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Float, '7.0', new Float(7.0)),
                token(Lexeme.Mod, 'MOD'),
                token(Lexeme.Float, '5.0', new Float(5.0)),
                token(Lexeme.Mod, 'MOD'),
                token(Lexeme.Float, '3.0', new Float(3.0)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses left-associative integer-division chains', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Float, '32.5', new Float(32.5)),
                token(Lexeme.Backslash, '\\'),
                token(Lexeme.Float, '5.0', new Float(5.0)),
                token(Lexeme.Backslash, '\\'),
                token(Lexeme.Float, '3.0', new Float(3.0)),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });
});
