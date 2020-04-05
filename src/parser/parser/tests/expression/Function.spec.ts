import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {

    describe('function expressions', () => {
        it('parses minimal empty function expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses colon-separated function declarations', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Colon, ':'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(TokenKind.Colon, ':'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty function expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with implicit-dynamic arguments', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                identifier('a'),
                token(TokenKind.Comma, ','),
                identifier('b'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),
                identifier('separator'),
                identifier('as'),
                identifier('object'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with default argument expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Integer, '3', new Int32(3)),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Integer, '4', new Int32(4)),
                token(TokenKind.Comma, ','),

                identifier('c'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.Integer, '5', new Int32(5)),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments and default expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Integer, '3', new Int32(3)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.Integer, '5', new Int32(5)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses return types', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                identifier('as'),
                identifier('void'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('sub expressions', () => {
        it('parses minimal sub expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty sub expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with implicit-dynamic arguments', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'sub'),
                token(TokenKind.LeftParen, '('),
                identifier('a'),
                token(TokenKind.Comma, ','),
                identifier('b'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Function, 'sub'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),
                identifier('cb'),
                identifier('as'),
                token(TokenKind.Function, 'function'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with default argument expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Integer, '3', new Int32(3)),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Integer, '4', new Int32(4)),
                token(TokenKind.Comma, ','),

                identifier('c'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.Integer, '5', new Int32(5)),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments and default expressions', () => {
            let { statements, errors } = Parser.parse([
                identifier('_'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Sub, 'sub'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.Integer, '3', new Int32(3)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.Integer, '5', new Int32(5)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('usage', () => {
        it('allows sub expressions in call arguments', () => {
            const { statements, errors } = Parser.parse([
                identifier('acceptsCallback'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.Newline, '\\n'),

                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.String, 'I\'m a callback', new BrsString('I\'m a callback')),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                token(TokenKind.Newline, '\\n'),

                token(TokenKind.RightParen, ')'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('allows function expressions in assignment RHS', () => {
            const { statements, errors } = Parser.parse([
                identifier('anonymousFunction'),
                token(TokenKind.Equal, '='),

                token(TokenKind.Function, 'function'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.String, 'I\'m anonymous', new BrsString('I\'m anonymous')),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),

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
        let { statements, errors } = Parser.parse(<any>[
            {
                kind: TokenKind.Identifier,
                text: '_',
                isReserved: false,
                location: {
                    start: { line: 1, column: 0 },
                    end: { line: 1, column: 1 }
                }
            },
            {
                kind: TokenKind.Equal,
                text: '=',
                isReserved: false,
                location: {
                    start: { line: 1, column: 2 },
                    end: { line: 1, column: 3 }
                }
            },
            {
                kind: TokenKind.Sub,
                text: 'sub',
                isReserved: true,
                location: {
                    start: { line: 1, column: 4 },
                    end: { line: 1, column: 7 }
                }
            },
            {
                kind: TokenKind.LeftParen,
                text: '(',
                isReserved: false,
                location: {
                    start: { line: 1, column: 11 },
                    end: { line: 1, column: 12 }
                }
            },
            {
                kind: TokenKind.RightParen,
                text: ')',
                isReserved: false,
                location: {
                    start: { line: 1, column: 12 },
                    end: { line: 1, column: 13 }
                }
            },
            {
                kind: TokenKind.Newline,
                text: '\n',
                isReserved: false,
                location: {
                    start: { line: 1, column: 13 },
                    end: { line: 1, column: 14 }
                }
            },
            {
                kind: TokenKind.EndSub,
                text: 'end sub',
                isReserved: false,
                location: {
                    start: { line: 3, column: 0 },
                    end: { line: 3, column: 7 }
                }
            },
            {
                kind: TokenKind.Eof,
                text: '\0',
                isReserved: false,
                location: {
                    start: { line: 3, column: 7 },
                    end: { line: 3, column: 8 }
                }
            }
        ]) as any;

        expect(errors).to.be.lengthOf(0);
        expect(statements).to.be.lengthOf(1);
        expect(statements[0].value.location).to.deep.include({
            start: { line: 1, column: 4 },
            end: { line: 3, column: 7 }
        });
    });
});
