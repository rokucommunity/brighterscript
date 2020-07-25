import { expect } from 'chai';

import { Parser } from '../../Parser';
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
            let { statements, diagnostics } = Parser.parse(tokens);
            expect(diagnostics).to.be.lengthOf(1);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses minimal empty function declarations', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('foo'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses non-empty function declarations', () => {
            let { statements, diagnostics } = Parser.parse([
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

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses functions with implicit-dynamic arguments', () => {
            let { statements, diagnostics } = Parser.parse([
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

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses functions with typed arguments', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('repeat'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                token(TokenKind.As, 'as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses functions with default argument expressions', () => {
            let { statements, diagnostics } = Parser.parse([
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

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses functions with typed arguments and default expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('add'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses return types', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Function, 'function'),
                identifier('foo'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.As, 'as'),
                token(TokenKind.Void, 'void'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end function'),
                EOF
            ]);

            expect(diagnostics[0]?.message).to.not.exist;
            expect(statements).to.length.greaterThan(0);

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
            const { statements, diagnostics } = Parser.parse(tokens);
            expect(diagnostics).to.be.lengthOf(4);
            expect(statements).to.length.greaterThan(0);

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
            let { statements, diagnostics } = Parser.parse(tokens);
            expect(diagnostics).to.be.lengthOf(1);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses minimal sub declarations', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Sub, 'sub'),
                identifier('bar'),
                token(TokenKind.LeftParen, '('),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses non-empty sub declarations', () => {
            let { statements, diagnostics } = Parser.parse([
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

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses subs with implicit-dynamic arguments', () => {
            let { statements, diagnostics } = Parser.parse([
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

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses subs with typed arguments', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Function, 'sub'),
                identifier('repeat'),
                token(TokenKind.LeftParen, '('),
                identifier('str'),
                token(TokenKind.As, 'as'),
                identifier('string'),
                token(TokenKind.Comma, ','),
                identifier('count'),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),
                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndFunction, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);

        });

        it('parses subs with default argument expressions', () => {
            let { statements, diagnostics } = Parser.parse([
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

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);
        });

        it('parses subs with typed arguments and default expressions', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.Sub, 'sub'),
                identifier('add'),
                token(TokenKind.LeftParen, '('),

                identifier('a'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '3', new Int32(3)),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.Comma, ','),

                identifier('b'),
                token(TokenKind.Equal, '='),
                identifier('a'),
                token(TokenKind.Plus, '+'),
                token(TokenKind.IntegerLiteral, '5', new Int32(5)),
                token(TokenKind.As, 'as'),
                identifier('integer'),
                token(TokenKind.RightParen, ')'),

                token(TokenKind.Newline, '\\n'),
                token(TokenKind.EndSub, 'end sub'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.length.greaterThan(0);
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
            const { statements, diagnostics } = Parser.parse(tokens);
            expect(diagnostics).to.be.lengthOf(4);
            expect(statements).to.length.greaterThan(0);
        });
    });
});
