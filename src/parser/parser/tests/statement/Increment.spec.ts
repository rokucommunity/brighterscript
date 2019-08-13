import { expect } from 'chai';

import { Parser } from '../..';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser postfix unary expressions', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    it('parses postfix \'++\' for variables', () => {
        let { statements, errors } = parser.parse([
            identifier('foo'),
            token(Lexeme.PlusPlus, '++'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses postfix \'--\' for dotted get expressions', () => {
        let { statements, errors } = parser.parse([
            identifier('obj'),
            token(Lexeme.Dot, '.'),
            identifier('property'),
            token(Lexeme.MinusMinus, '--'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses postfix \'++\' for indexed get expressions', () => {
        let { statements, errors } = parser.parse([
            identifier('obj'),
            token(Lexeme.LeftSquare, '['),
            identifier('property'),
            token(Lexeme.RightSquare, ']'),
            token(Lexeme.PlusPlus, '++'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('disallows consecutive postfix operators', () => {
        let { errors } = parser.parse([
            identifier('foo'),
            token(Lexeme.PlusPlus, '++'),
            token(Lexeme.PlusPlus, '++'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(1);
        expect(errors[0]).deep.include({
            message: 'Consecutive increment/decrement operators are not allowed',
        });
    });

    it('disallows postfix \'--\' for function call results', () => {
        let { errors } = parser.parse([
            identifier('func'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.MinusMinus, '--'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(1);
        expect(errors[0]).to.deep.include({
            message: 'Increment/decrement operators are not allowed on the result of a function call'
        });
    });

    it('allows \'++\' at the end of a function', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.Sub, 'sub'),
            identifier('foo'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\n'),
            identifier('someValue'),
            token(Lexeme.PlusPlus, '++'),
            token(Lexeme.Newline, '\n'),
            token(Lexeme.EndSub, 'end sub'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1
         *    0   4   8   2
         *  +--------------
         * 1| someNumber++
         */
        let { statements, errors } = parser.parse([
            {
                kind: Lexeme.Identifier,
                text: 'someNumber',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 10 },
                },
            },
            {
                kind: Lexeme.PlusPlus,
                text: '++',
                isReserved: false,
                location: {
                    start: { line: 1, column: 10 },
                    end: { line: 1, column: 12 },
                },
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 12 },
                    end: { line: 1, column: 13 },
                },
            },
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).deep.include({
            start: { line: 1, column: 0 },
            end: { line: 1, column: 12 },
        });
    });
});
