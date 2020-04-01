import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { Lexeme, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser call expressions', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    it('parses named function calls', () => {
        const { statements, errors } = parser.parse([
            identifier('RebootSystem'),
            { kind: Lexeme.LeftParen, text: '(', line: 1 },
            token(Lexeme.RightParen, ')'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('does not invalidate the rest of the file on incomplete statement', () => {
        const { tokens } = Lexer.scan(`
            sub DoThingOne()
                DoThin
            end sub
            sub DoThingTwo()
            end sub
        `);
        const { statements, errors } = parser.parse(tokens);
        expect(errors).to.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);

        //ALL of the errors should be on the `DoThin` line
        let lineNumbers = errors.map(x => x.location.start.line);
        for (let lineNumber of lineNumbers) {
            expect(lineNumber).to.equal(3);
        }
        //expect(statements).toMatchSnapshot();
    });

    it('does not invalidate the next statement on a multi-statement line', () => {
        const { tokens } = Lexer.scan(`
            sub DoThingOne()
                'missing closing paren
                DoThin(:name = "bob"
            end sub
            sub DoThingTwo()
            end sub
        `);
        const { statements, errors } = parser.parse(tokens);
        //there should only be 1 error
        expect(errors).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
        //the error should be BEFORE the `name = "bob"` statement
        expect(errors[0].location.end.column).to.be.lessThan(25);
        //expect(statements).toMatchSnapshot();
    });

    it('allows closing parentheses on separate line', () => {
        const { statements, errors } = parser.parse([
            identifier('RebootSystem'),
            { kind: Lexeme.LeftParen, text: '(', line: 1 },
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.Newline, '\\n'),
            token(Lexeme.RightParen, ')'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('accepts arguments', () => {
        const { statements, errors } = parser.parse([
            identifier('add'),
            { kind: Lexeme.LeftParen, text: '(', line: 1 },
            token(Lexeme.Integer, '1', new Int32(1)),
            { kind: Lexeme.Comma, text: ',', line: 1 },
            token(Lexeme.Integer, '2', new Int32(2)),
            token(Lexeme.RightParen, ')'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        expect(statements[0].expression.args).to.be.ok;
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1   2
         *    0   4   8   2   6   0
         *  +----------------------
         * 1| foo("bar", "baz")
         */
        const { statements, errors } = parser.parse([
            {
                kind: Lexeme.Identifier,
                text: 'foo',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: Lexeme.LeftParen,
                text: '(',
                isReserved: false,
                location: {
                    start: { line: 1, column: 3 },
                    end: { line: 1, column: 4 }
                }
            },
            {
                kind: Lexeme.String,
                text: `"bar"`,
                literal: new BrsString('bar'),
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 9 }
                }
            },
            {
                kind: Lexeme.Comma,
                text: ',',
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 }
                }
            },
            {
                kind: Lexeme.String,
                text: `"baz"`,
                literal: new BrsString('baz'),
                isReserved: false,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 16 }
                }
            },
            {
                kind: Lexeme.RightParen,
                text: ')',
                isReserved: false,
                location: {
                    start: { line: 1, column: 16 },
                    end: { line: 1, column: 17 }
                }
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 17 },
                    end: { line: 1, column: 18 }
                }
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).to.deep.include({
            start: { line: 1, column: 0 },
            end: { line: 1, column: 17 }
        });
    });
});
