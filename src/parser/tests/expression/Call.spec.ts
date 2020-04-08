import { expect } from 'chai';

import { Parser } from '../../parser';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser call expressions', () => {
    it('parses named function calls', () => {
        const { statements, errors } = Parser.parse([
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', line: 1 },
            token(TokenKind.RightParen, ')'),
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
        const { statements, errors } = Parser.parse(tokens);
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
        const { statements, errors } = Parser.parse(tokens);
        //there should only be 1 error
        expect(errors).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
        //the error should be BEFORE the `name = "bob"` statement
        expect(errors[0].location.end.column).to.be.lessThan(25);
        //expect(statements).toMatchSnapshot();
    });

    it('allows closing parentheses on separate line', () => {
        const { statements, errors } = Parser.parse([
            identifier('RebootSystem'),
            { kind: TokenKind.LeftParen, text: '(', line: 1 },
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.Newline, '\\n'),
            token(TokenKind.RightParen, ')'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('accepts arguments', () => {
        const { statements, errors } = Parser.parse([
            identifier('add'),
            { kind: TokenKind.LeftParen, text: '(', line: 1 },
            token(TokenKind.IntegerLiteral, '1', new Int32(1)),
            { kind: TokenKind.Comma, text: ',', line: 1 },
            token(TokenKind.IntegerLiteral, '2', new Int32(2)),
            token(TokenKind.RightParen, ')'),
            EOF
        ]) as any;

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
        const { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: 'foo',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: TokenKind.LeftParen,
                text: '(',
                isReserved: false,
                location: {
                    start: { line: 1, column: 3 },
                    end: { line: 1, column: 4 }
                }
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"bar"`,
                literal: new BrsString('bar'),
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 9 }
                }
            },
            {
                kind: TokenKind.Comma,
                text: ',',
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 }
                }
            },
            {
                kind: TokenKind.StringLiteral,
                text: `"baz"`,
                literal: new BrsString('baz'),
                isReserved: false,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 16 }
                }
            },
            {
                kind: TokenKind.RightParen,
                text: ')',
                isReserved: false,
                location: {
                    start: { line: 1, column: 16 },
                    end: { line: 1, column: 17 }
                }
            },
            {
                kind: TokenKind.Eof,
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
