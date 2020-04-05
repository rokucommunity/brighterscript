import { expect } from 'chai';

import { Parser } from '../..';
import { BrsString, Int32 } from '../../../brsTypes';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser', () => {

    describe('function declarations', () => {
        it('recovers when using `end sub` instead of `end function`', () => {
            const { tokens } = Lexer.scan(`
                function Main()
                    print "Hello world"
                end sub

                sub DoSomething()

                end sub
            `);
            let { statements, errors } = Parser.parse(tokens);
            expect(errors).to.be.lengthOf(1);
            expect(statements).to.length.greaterThan(0);

            //expect({ errors, statements }).toMatchSnapshot();
        });

        it('parses minimal empty function declarations', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('foo'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty function declarations', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('foo'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with implicit-dynamic arguments', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('add2'),
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
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('repeat'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with default argument expressions', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('add'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '4', new Int32(4)),
                token(TokenKind.Comma, ','),

                identifier('c'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses functions with typed arguments and default expressions', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('add'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses return types', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('foo'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                identifier('as'),
                identifier('void'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
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
            const { statements, errors } = Parser.parse(tokens);
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
            let { statements, errors } = Parser.parse(tokens);
            expect(errors).to.be.lengthOf(1);
            expect(statements).to.length.greaterThan(0);

            //expect({ errors, statements }).toMatchSnapshot();
        });

        it('parses minimal sub declarations', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Sub, 'sub'),
                identifier('bar'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses non-empty sub declarations', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Sub, 'sub'),
                identifier('foo'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.Print, 'print'),
                token(TokenKind.StringLiteral, 'Lorem ipsum', new BrsString('Lorem ipsum')),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with implicit-dynamic arguments', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'sub'),
                identifier('add2'),
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
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Function, 'sub'),
                identifier('repeat'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                identifier('as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with default argument expressions', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Sub, 'sub'),
                identifier('add'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '4', new Int32(4)),
                token(TokenKind.Comma, ','),

                identifier('c'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(errors).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses subs with typed arguments and default expressions', () => {
            let { statements, errors } = Parser.parse([
                token(TokenKind.Sub, 'sub'),
                identifier('add'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                identifier('as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
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
            const { statements, errors } = Parser.parse(tokens);
            expect(errors).to.be.lengthOf(4);
            expect(statements).to.length.greaterThan(0);
            //expect({ errors, statements }).toMatchSnapshot();
        });
    });
});
