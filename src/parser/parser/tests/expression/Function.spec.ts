import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { Lexeme } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    describe('function expressions', () => {
        it('parses minimal empty function expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses colon-separated function declarations', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Colon, ':'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(Lexeme.Colon, ':'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty function expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with implicit-dynamic arguments', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                identifier('a'),
                token(Lexeme.Comma, ','),
                identifier('b'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(Lexeme.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.Comma, ','),
                identifier('separator'),
                identifier('as'),
                identifier('object'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with default argument expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),

                identifier('a'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '3', new Int32(3)),
                token(Lexeme.Comma, ','),

                identifier('b'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '4', new Int32(4)),
                token(Lexeme.Comma, ','),

                identifier('c'),
                token(Lexeme.Equal, '='),
                identifier('a'),
                token(Lexeme.Plus, '+'),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.RightParen, ')'),

                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments and default expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),

                identifier('a'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '3', new Int32(3)),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.Comma, ','),

                identifier('b'),
                token(Lexeme.Equal, '='),
                identifier('a'),
                token(Lexeme.Plus, '+'),
                token(Lexeme.Integer, '5', new Int32(5)),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.RightParen, ')'),

                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses return types', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                identifier('as'),
                identifier('void'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('sub expressions', () => {
        it('parses minimal sub expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Sub, 'sub'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty sub expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Sub, 'sub'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with implicit-dynamic arguments', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'sub'),
                token(Lexeme.LeftParen, '('),
                identifier('a'),
                token(Lexeme.Comma, ','),
                identifier('b'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Function, 'sub'),
                token(Lexeme.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(Lexeme.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.Comma, ','),
                identifier('cb'),
                identifier('as'),
                token(Lexeme.Function, 'function'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with default argument expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Sub, 'sub'),
                token(Lexeme.LeftParen, '('),

                identifier('a'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '3', new Int32(3)),
                token(Lexeme.Comma, ','),

                identifier('b'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '4', new Int32(4)),
                token(Lexeme.Comma, ','),

                identifier('c'),
                token(Lexeme.Equal, '='),
                identifier('a'),
                token(Lexeme.Plus, '+'),
                token(Lexeme.Integer, '5', new Int32(5)),
                token(Lexeme.RightParen, ')'),

                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments and default expressions', () => {
            let { statements, errors } = parser.parse([
                identifier('_'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Sub, 'sub'),
                token(Lexeme.LeftParen, '('),

                identifier('a'),
                token(Lexeme.Equal, '='),
                token(Lexeme.Integer, '3', new Int32(3)),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.Comma, ','),

                identifier('b'),
                token(Lexeme.Equal, '='),
                identifier('a'),
                token(Lexeme.Plus, '+'),
                token(Lexeme.Integer, '5', new Int32(5)),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.RightParen, ')'),

                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('usage', () => {
        it('allows sub expressions in call arguments', () => {
            const { statements, errors } = parser.parse([
                identifier('acceptsCallback'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.Newline, '\\n'),

                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'I\'m a callback', new BrsString('I\'m a callback')),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                token(Lexeme.Newline, '\\n'),

                token(Lexeme.RightParen, ')'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('allows function expressions in assignment RHS', () => {
            const { statements, errors } = parser.parse([
                identifier('anonymousFunction'),
                token(Lexeme.Equal, '='),

                token(Lexeme.Function, 'function'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'I\'m anonymous', new BrsString('I\'m anonymous')),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),

                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    it('location tracking', () => {
        /**
         *    0   0   0   1   1
         *    0   4   8   2   6
         *  +------------------
         * 1| _ = sub foo()
         * 2|
         * 3| end sub
         */
        let { statements, errors } = parser.parse([
            {
                kind: Lexeme.Identifier,
                text: '_',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 1 }
                }
            },
            {
                kind: Lexeme.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 2 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: Lexeme.Sub,
                text: 'sub',
                isReserved: true,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 7 }
                }
            },
            {
                kind: Lexeme.LeftParen,
                text: '(',
                isReserved: false,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 12 }
                }
            },
            {
                kind: Lexeme.RightParen,
                text: ')',
                isReserved: false,
                location: {
                    start: { line: 1, column: 12 },
                    end: { line: 1, column: 13 }
                }
            },
            {
                kind: Lexeme.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 14 }
                }
            },
            {
                kind: Lexeme.EndSub,
                text: 'end sub',
                isReserved: false,
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 7 }
                }
            },
            {
                kind: Lexeme.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 3, column: 7 },
                    end: { line: 3, column: 8 }
                }
            }
        ]);

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.location).to.deep.include({
            start: { line: 1, column: 4 },
            end: { line: 3, column: 7 }
        });
    });
});
