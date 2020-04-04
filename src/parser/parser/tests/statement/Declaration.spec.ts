import { expect } from 'chai';

import { Parser } from '../..';
import { BrsInvalid, Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser variable declarations', () => {
    it('allows newlines before assignments', () => {
        let { statements, errors } = Parser.parse([
            token(Lexeme.Newline),
            token(Lexeme.Newline),
            token(Lexeme.Newline),
            identifier('hasNewlines'),
            token(Lexeme.Equal),
            token(Lexeme.True),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('allows newlines after assignments', () => {
        let { statements, errors } = Parser.parse([
            identifier('hasNewlines'),
            token(Lexeme.Equal),
            token(Lexeme.True),
            token(Lexeme.Newline),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
    });

    it('parses literal value assignments', () => {
        let { statements, errors } = Parser.parse([
            identifier('foo'),
            token(Lexeme.Equal),
            token(Lexeme.Integer, '5', new Int32(5)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses evaluated value assignments', () => {
        let { statements, errors } = Parser.parse([
            identifier('bar'),
            token(Lexeme.Equal),
            token(Lexeme.Integer, '5', new Int32(5)),
            token(Lexeme.Caret),
            token(Lexeme.Integer, '3', new Int32(3)),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses variable aliasing', () => {
        let { statements, errors } = Parser.parse([
            identifier('baz'),
            token(Lexeme.Equal),
            identifier('foo'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| foo = invalid
         */
        let { statements, errors } = Parser.parse(<any>[
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
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 }
                }
            },
            {
                kind: Lexeme.Invalid,
                text: 'invalid',
                literal: BrsInvalid.Instance,
                isReserved: true,
                location: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 13 }
                }
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 14 }
                }
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).to.deep.include({
            start: { line: 1, column: 0 },
            end: { line: 1, column: 13 }
        });
    });
});
