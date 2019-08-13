import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { Lexeme, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {
    let parser;

    beforeEach(() => {
        parser = new Parser();
    });

    describe('function declarations', () => {
        it('recovers when using `end sub` instead of `end function`', () => {
            const { tokens } = Lexer.scan(`
                function Main()
                    print "Hello world"
                end sub

                sub DoSomething()

                end sub
            `);
            let { statements, errors } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(1);
            expect(statements).to.length.greaterThan(0);

            //expect({ errors, statements }).toMatchSnapshot();
        });

        it('parses minimal empty function declarations', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('foo'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty function declarations', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('foo'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with implicit-dynamic arguments', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('add2'),
                token(Lexeme.LeftParen, '('),
                identifier('a'),
                token(Lexeme.Comma, ','),
                identifier('b'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('repeat'),
                token(Lexeme.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(Lexeme.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with default argument expressions', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('add'),
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
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments and default expressions', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('add'),
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
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses return types', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'function'),
                identifier('foo'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                identifier('as'),
                identifier('void'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end function'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('does not allow type designators at end of name', () => {
            const { tokens } = Lexer.scan(`
                function StringFunc#()
                    return 1
                end function

                function IntegerFunc%()
                    return 1
                end function

                function FloatFunc!()
                    return 1
                end function

                function DoubleFunc#()
                    return 1
                end function
            `);
            const { statements, errors } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(4);
            expect(statements).to.length.greaterThan(0);

            //expect({ errors, statements }).toMatchSnapshot();
        });
    });

    describe('sub declarations', () => {
        it('recovers when using `end function` instead of `end sub`', () => {
            const { tokens } = Lexer.scan(`
                sub Main()
                    print "Hello world"
                end function

                sub DoSomething()

                end sub
            `);
            let { statements, errors } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(1);
            expect(statements).to.length.greaterThan(0);

            //expect({ errors, statements }).toMatchSnapshot();
        });

        it('parses minimal sub declarations', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Sub, 'sub'),
                identifier('bar'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndSub, 'end sub'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty sub declarations', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Sub, 'sub'),
                identifier('foo'),
                token(Lexeme.LeftParen, '('),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.Print, 'print'),
                token(Lexeme.String, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndSub, 'end sub'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with implicit-dynamic arguments', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'sub'),
                identifier('add2'),
                token(Lexeme.LeftParen, '('),
                identifier('a'),
                token(Lexeme.Comma, ','),
                identifier('b'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end sub'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Function, 'sub'),
                identifier('repeat'),
                token(Lexeme.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(Lexeme.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(Lexeme.RightParen, ')'),
                token(Lexeme.Newline, '\\n'),
                token(Lexeme.EndFunction, 'end sub'),
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with default argument expressions', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Sub, 'sub'),
                identifier('add'),
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
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments and default expressions', () => {
            let { statements, errors } = parser.parse([
                token(Lexeme.Sub, 'sub'),
                identifier('add'),
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
                EOF,
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('does not allow type designators at end of name', () => {
            const { tokens } = Lexer.scan(`
                sub StringSub#()
                end sub

                sub IntegerSub%()
                end sub

                sub FloatSub!()
                end sub

                sub DoubleSub#()
                end sub
            `);
            const { statements, errors } = parser.parse(tokens);
            expect(errors).to.be.lengthOf(4);
            expect(statements).to.length.greaterThan(0);
            //expect({ errors, statements }).toMatchSnapshot();
        });
    });
});
