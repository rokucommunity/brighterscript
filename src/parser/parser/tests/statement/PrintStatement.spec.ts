import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, token } from '../Parser.spec';

describe('parser print statements', () => {
    let parser: Parser;
    beforeEach(() => {
        parser = new Parser();
    });

    it('parses singular print statements', () => {
        let { statements, errors } = Parser.parse([
            token(Lexeme.Print),
            token(Lexeme.String, 'Hello, world'),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('supports empty print', () => {
        let { statements, errors } = parser.parse([token(Lexeme.Print), EOF]);
        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses print lists with no separator', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.Print),
            token(Lexeme.String, 'Foo', new BrsString('Foo')),
            token(Lexeme.String, 'bar', new BrsString('bar')),
            token(Lexeme.String, 'baz', new BrsString('baz')),
            EOF
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.exist;
        expect(statements).not.to.be.null;
        //expect(statements).toMatchSnapshot();
    });

    it('parses print lists with separators', () => {
        let { statements, errors } = parser.parse([
            token(Lexeme.Print),
            token(Lexeme.String, 'Foo', new BrsString('Foo')),
            token(Lexeme.Semicolon),
            token(Lexeme.String, 'bar', new BrsString('bar')),
            token(Lexeme.Semicolon),
            token(Lexeme.String, 'baz', new BrsString('baz')),
            EOF
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
         * 1| print "foo"
         */
        let { statements, errors } = parser.parse([
            {
                kind: Lexeme.Print,
                text: 'print',
                isReserved: true,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 5 },
                    file: 'test.brs'
                }
            },
            {
                kind: Lexeme.String,
                text: `"foo"`,
                literal: new BrsString('foo'),
                isReserved: false,
                location: {
                    start: { line: 1, column: 6 },
                    end: { line: 1, column: 11 },
                    file: 'test.brs'
                }
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 12 },
                    file: 'test.brs'
                }
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].location).to.deep.include({
            start: { line: 1, column: 0 },
            end: { line: 1, column: 11 }
        });
    });
});
