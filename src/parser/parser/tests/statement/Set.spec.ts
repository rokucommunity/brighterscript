/* eslint-disable */
import { expect } from 'chai';

import { Parser } from '../..';
import { Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser indexed assignment', () => {
    let parser: Parser;

    beforeEach(() => {
        parser = new Parser();
    });

    describe('dotted', () => {
        it('assigns anonymous functions', () => {
            let { statements, errors } = parser.parse([
                identifier('foo'),
                token(Lexeme.Dot, '.'),
                identifier('bar'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assigns boolean expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('foo'),
                token(Lexeme.Dot, '.'),
                identifier('bar'),
                token(Lexeme.Equal, '='),
                token(Lexeme.True, 'true'),
                token(Lexeme.And, 'and'),
                token(Lexeme.False, 'false'),
                token(Lexeme.Newline, '\\n'),
                EOF,
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assignment operator', () => {
            let { statements, errors } = parser.parse([
                identifier('foo'),
                token(Lexeme.Dot, '.'),
                identifier('bar'),
                token(Lexeme.StarEqual, '*='),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.Newline, '\\n'),
                EOF,
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });
    });

    describe('bracketed', () => {
        it('assigns anonymous functions', () => {
            let { statements, errors } = parser.parse([
                identifier('someArray'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '0', new Int32(0)),
                token(Lexeme.RightSquare, ']'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assigns boolean expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('someArray'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '0', new Int32(0)),
                token(Lexeme.RightSquare, ']'),
                token(Lexeme.Equal, '='),
                token(Lexeme.True, 'true'),
                token(Lexeme.And, 'and'),
                token(Lexeme.False, 'false'),
                token(Lexeme.Newline, '\\n'),
                EOF,
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });

        it('assignment operator', () => {
            let { statements, errors } = parser.parse([
                identifier('someArray'),
                token(Lexeme.LeftSquare, '['),
                token(Lexeme.Integer, '0', new Int32(0)),
                token(Lexeme.RightSquare, ']'),
                token(Lexeme.StarEqual, '*='),
                token(Lexeme.Integer, '3', new Int32(3)),
                EOF,
            ]);

            expect(errors).to.be.empty;
            expect(statements).to.exist;
            expect(statements).not.to.be.null;
            // //expect(statements).toMatchSnapshot();
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| arr[0] = 1
         * 2| obj.a = 5
         */
        let { statements, errors } = parser.parse([
            {
                kind: Lexeme.Identifier,
                text: 'arr',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 3 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.LeftSquare,
                text: '[',
                isReserved: false,
                location: {
                    start: { line: 1, column: 3 },
                    end: { line: 1, column: 4 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Integer,
                text: '0',
                literal: new Int32(0),
                isReserved: false,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 5 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.RightSquare,
                text: ']',
                isReserved: false,
                location: {
                    start: { line: 1, column: 5 },
                    end: { line: 1, column: 6 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 7 },
                    end: { line: 1, column: 8 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Integer,
                text: '1',
                literal: new Int32(1),
                isReserved: false,
                location: {
                    start: { line: 1, column: 9 },
                    end: { line: 1, column: 10 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 10 },
                    end: { line: 1, column: 11 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Identifier,
                text: 'obj',
                isReserved: false,
                location: {
                    start: { line: 2, column: 0 },
                    end: { line: 2, column: 3 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Dot,
                text: '.',
                isReserved: false,
                location: {
                    start: { line: 2, column: 3 },
                    end: { line: 2, column: 4 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Identifier,
                text: 'a',
                isReserved: false,
                location: {
                    start: { line: 2, column: 4 },
                    end: { line: 2, column: 5 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 2, column: 6 },
                    end: { line: 2, column: 7 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Integer,
                text: '5',
                literal: new Int32(5),
                isReserved: false,
                location: {
                    start: { line: 2, column: 8 },
                    end: { line: 2, column: 9 },
                    file: 'Test.brs'
                },
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 2, column: 10 },
                    end: { line: 2, column: 11 },
                    file: 'Test.brs'
                },
            },
        ]);

        expect(errors).to.be.empty;
        expect(statements).to.be.lengthOf(2);
        expect(statements.map(s => s.location)).to.deep.equal([
            {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 10 },
                file: 'Test.brs'
            },
            {
                start: { line: 2, column: 0 },
                end: { line: 2, column: 9 },
                file: 'Test.brs'
            },
        ]);
    });
});
