import { expect } from 'chai';

import { Parser } from '../../Parser';
import { BrsBoolean, Int32 } from '../../../brsTypes';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';

describe('parser if statements', () => {
    it('allows empty if blocks', () => {
        let { tokens } = Lexer.scan(`
            if true then
                
            else if true then
                stop
            else
                stop
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);

        expect(diagnostics[0]?.message).not.to.exist;
        expect(statements).to.be.length.greaterThan(0);
    });

    it('allows empty elseif blocks', () => {
        let { tokens } = Lexer.scan(`
            if true then
                stop
            else if true then

            else
                stop
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);

        expect(diagnostics[0]?.message).not.to.exist;
        expect(statements).to.be.length.greaterThan(0);
    });

    it('allows empty else blocks', () => {
        let { tokens } = Lexer.scan(`
            if true then
                stop
            else if true then
                stop
            else
                
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);

        expect(diagnostics[0]?.message).not.to.exist;
        expect(statements).to.be.length.greaterThan(0);
    });

    it('single-line if next to else or endif', () => {
        let { tokens } = Lexer.scan(`
            if type(component.TextAttrs.font) = "roString"
                font = m.fonts.Lookup(component.TextAttrs.font)
                if font = invalid then font = m.fonts.medium
            else if type(component.TextAttrs.font) = "roFont"
                font = component.TextAttrs.font
            else
                font = m.fonts.reg.GetDefaultFont()
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('single-line if inside multi-line if', () => {
        let { tokens } = Lexer.scan(`
            if true
                if true then t = 1
            else
                ' empty line or line with just a comment causes crash
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);

        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('dotted set in else block', () => {
        let { tokens } = Lexer.scan(`
            if true then m.top.visible = true else m.top.visible = false
        `);
        let { statements, diagnostics } = Parser.parse(tokens);

        if (diagnostics.length > 0) {
            console.log(diagnostics);
        }

        expect(diagnostics).to.be.lengthOf(0);

        expect(statements).to.be.length.greaterThan(0);
    });

    describe('single-line if', () => {
        it('parses if only', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Then, 'then'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses if-else', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Then, 'then'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.Else, 'else'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.False, 'true', BrsBoolean.False),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses if-elseif-else', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Then, 'then'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.ElseIf, 'else if'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                token(TokenKind.Then, 'then'),
                identifier('same'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.Else, 'else'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.False),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('allows \'then\' to be skipped', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.ElseIf, 'else if'),
                token(TokenKind.IntegerLiteral, '1', new Int32(1)),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2', new Int32(2)),
                identifier('same'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true', BrsBoolean.True),
                token(TokenKind.Else, 'else'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.False, 'false', BrsBoolean.False),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });
    });

    describe('block if', () => {
        it('parses if only', () => {
            //because the parser depends on line numbers for certain if statements, this needs to be location-aware
            let { tokens } = Lexer.scan(`
                if 1 < 2 THEN
                    foo = true
                    bar = true
                end if
            `);
            let { statements, diagnostics } = Parser.parse(tokens);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses if-else', () => {
            //this test requires token locations, so use the lexer
            let { tokens } = Lexer.scan(`
                if 1 < 2 then
                    foo = true
                else
                    foo = false
                    bar = false
                end if
            `);
            let { statements, diagnostics } = Parser.parse(tokens);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('parses if-elseif-else', () => {
            //this test requires token locations, so use the lexer
            let { tokens } = Lexer.scan(`
                if 1 < 2 then
                    foo = true
                else if 1 > 2 then
                    foo = 3
                    bar = true
                else
                    foo = false
                end if
            `);
            let { statements, diagnostics } = Parser.parse(tokens);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('allows \'then\' to be skipped', () => {
            //this test requires token locations, so use the lexer
            let { tokens } = Lexer.scan(`
                if 1 < 2
                    foo = true
                else if 1 > 2
                    foo = 3
                    bar = true
                else
                    foo = false
                end if
            `);
            let { statements, diagnostics } = Parser.parse(tokens);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
            //expect(statements).toMatchSnapshot();
        });

        it('sets endif token properly', () => {
            //this test requires token locations, so use the lexer
            let { tokens } = Lexer.scan(`
                sub a()
                    if true then
                        print false
                    else if true then
                        print "true"
                    else
                        print "else"
                    end if 'comment
                end sub
            `);
            let { statements, diagnostics } = Parser.parse(tokens) as any;
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);

            //the endif token should be set
            expect(statements[0].func.body.statements[0].tokens.endIf).to.exist;
        });
    });

    it('supports trailing colons after conditional statements', () => {
        let { tokens } = Lexer.scan(`
            sub main()
                if 1 > 0:
                    print "positive!"
                else if 1 < 0:
                    print "negative!"
                else:
                    print "tHaT NuMbEr iS ZeRo"
                end if
            end sub
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('supports trailing colons for one-line if statements', () => {
        let { tokens } = Lexer.scan(`
            if 1 < 2: return true: end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('catches one-line if statement missing first colon', () => {
        //missing colon after 2
        let { tokens } = Lexer.scan(`
            if 1 < 2 return true : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('catches one-line if statement missing second colon', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2 : return true end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('catches one-line if statement with else missing colons', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2 : return true: else return false end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('catches one-line if statement with colon and missing end if', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2: return true
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.lengthOf(0);
        //expect(statements).toMatchSnapshot();
    });

    it('catches one-line if statement with colon and missing end if inside a function', () => {
        //missing 'end if'
        let { tokens } = Lexer.scan(`
            function missingendif()
                if true : return true
            end function
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('supports if statement with condition and action on one line, but end if on separate line', () => {
        let { tokens } = Lexer.scan(`
            if 1 < 2: return true
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('supports colon after return in single-line if statement', () => {
        let { tokens } = Lexer.scan(`
            if false : print "true" : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('supports if elseif endif single line', () => {
        let { tokens } = Lexer.scan(`
            if true: print "8 worked": else if true: print "not run": else: print "not run": end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    it('supports one-line functions inside of one-line if statement', () => {
        let { tokens } = Lexer.scan(`
            if true then : test = sub() : print "yes" : end sub : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
        //expect(statements).toMatchSnapshot();
    });

    // TODO: Improve `if` statement structure to allow a linter to require a `then` keyword for
});
