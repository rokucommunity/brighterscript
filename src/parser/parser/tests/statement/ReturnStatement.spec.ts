/* eslint-disable */
import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser return statements', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    it('parses void returns', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.Function, 'function'),
            identifier('foo'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.Return, 'return'),
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.EndFunction, 'end function'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.ok;
        // //expect(statements).toMatchSnapshot();
    });

    it('parses literal returns', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.Function, 'function'),
            identifier('foo'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.Return, 'return'),
            { kind: Lexeme.String, literal: new BrsString('test'), text: '"test"', line: 2 },
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.EndFunction, 'end function'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.ok;
        // //expect(statements).toMatchSnapshot();
    });

    it('parses expression returns', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.Function, 'function'),
            identifier('foo'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.Return, 'return'),
            identifier('RebootSystem'),
            { kind: Lexeme.LeftParen, text: '(', line: 2 },
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.EndFunction, 'end function'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.ok;
        // //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| function foo()
         * 2|   return 5
         * 3| end function
         */
        let { statements, errors } = parser.parse([
            token(Lexeme.Function, 'function'),
            identifier('foo'),
            token(Lexeme.LeftParen, '('),
            token(Lexeme.RightParen, ')'),
            token(Lexeme.Newline, '\\n'),
            {
                kind: Lexeme.Return,
                text: 'return',
                isReserved: true,
                location: {
                    start: { line: 2, column: 2 },
                    end: { line: 2, column: 8 },
                },
            },
            {
                kind: Lexeme.Integer,
                text: '5',
                literal: new Int32(5),
                isReserved: false,
                location: {
                    start: { line: 2, column: 9 },
                    end: { line: 2, column: 10 },
                },
            },
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.EndFunction, 'end function'),
            EOF,
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements[0].func.body.statements[0].location).to.deep.include({
            start: { line: 2, column: 2 },
            end: { line: 2, column: 10 },
        });
    });
});
