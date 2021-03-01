import { expect } from 'chai';
import * as assert from 'assert';

import { Parser } from '../../Parser';
import { TokenKind, Lexer } from '../../../lexer';
import { EOF, identifier, token } from '../Parser.spec';
import { isBlock, isCommentStatement, isIfStatement } from '../../../astUtils';

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

        let ifs = statements[0];
        if (!isIfStatement(ifs) || !isIfStatement(ifs.thenBranch?.statements[1])) {
            assert.fail('Missing single-line if inside if-then');
        }
        if (!isIfStatement(ifs.elseBranch)) {
            assert.fail('Missing chained else-if statement');
        }
        expect(ifs.elseBranch.elseBranch).to.exist;
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

        let ifs = statements[0];
        if (!isIfStatement(ifs) || !isIfStatement(ifs.thenBranch?.statements[0])) {
            assert.fail('Missing single-line if inside if-then');
        }
        expect(ifs.elseBranch).to.exist;
        if (!isBlock(ifs.elseBranch) || !isCommentStatement(ifs.elseBranch.statements[0])) {
            assert.fail('Missing comment inside else branch');
        }
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
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Then, 'then'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('parses if-else', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Then, 'then'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Else, 'else'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.False, 'true'),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('parses if-elseif-else', () => {
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Then, 'then'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Else, 'else'),
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2'),
                token(TokenKind.Then, 'then'),
                identifier('same'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Else, 'else'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('allows \'then\' to be skipped', () => {
            // if 1 < 2 foo = true else if 1 = 2 same = true
            let { statements, diagnostics } = Parser.parse([
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Less, '<'),
                token(TokenKind.IntegerLiteral, '2'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Else, 'else'),
                token(TokenKind.If, 'if'),
                token(TokenKind.IntegerLiteral, '1'),
                token(TokenKind.Equal, '='),
                token(TokenKind.IntegerLiteral, '2'),
                identifier('same'),
                token(TokenKind.Equal, '='),
                token(TokenKind.True, 'true'),
                token(TokenKind.Else, 'else'),
                identifier('foo'),
                token(TokenKind.Equal, '='),
                token(TokenKind.False, 'false'),
                token(TokenKind.Newline, '\n'),
                EOF
            ]);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
        });

        it('parses print statement in inline block', () => {
            const { statements, diagnostics } = Parser.parse(`
                if true print 1 else print 1
                if true then print 1 else print 1
                if true print "x=" ; 1 else print 1
                if true then print "x=", 1 else print 1
                if true print "x=" 1 else print 1
            `);

            expect(diagnostics).to.be.lengthOf(0);
            expect(statements).to.be.length.greaterThan(0);
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
            let ifs = statements[0].func.body.statements[0];
            if (!isIfStatement(ifs) || !isIfStatement(ifs.elseBranch)) {
                assert.fail('Unexpected statement found');
            }
            expect(ifs.tokens.endIf).to.not.exist;
            expect(ifs.elseBranch.tokens.endIf).to.exist;
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
    });

    it('supports trailing colons for one-line if statements', () => {
        let { tokens } = Lexer.scan(`
            if 1 < 2: return true: end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches one-line if statement missing first colon', () => {
        //missing colon after 2
        let { tokens } = Lexer.scan(`
            if 1 < 2 return true : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches one-line if statement with multiple statements missing first colon', () => {
        //missing colon after 2
        let { tokens } = Lexer.scan(`
            if 1 < 2 print "ok" : return true : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches one-line if statement missing second colon', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2 : return true end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches one-line if statement with else missing colons', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2 : return true: else return false end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches one-line if statement with colon and missing end if', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2: return true
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.lengthOf(0);
    });

    it('catches one-line if multi-statement with colon and missing end if', () => {
        //missing colon after `2`
        let { tokens } = Lexer.scan(`
            if 1 < 2: print "ok": return true
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.lengthOf(0);
    });

    it('catches one-line if statement with colon and missing endif inside a function', () => {
        //missing 'end if'
        let { tokens } = Lexer.scan(`
            function missingendif()
                if true : return true
            end function
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(2);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches extraneous colon at the end of one-line if-else', () => {
        //colon at the end not allowed
        let { tokens } = Lexer.scan(`
            if 1 < 2 then return true else return false:
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches colon before if, unless there is `then` before', () => {
        //colon before if isn't allowed
        let { tokens } = Lexer.scan(`
            if 1 < 2 then: if 2<3: return false: end if
            : if 1 < 2: return true: end if
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches extraneous colon+end if at the end of one-line if-else', () => {
        //expected newline + unexpected endif
        let { tokens } = Lexer.scan(`
            if 1 < 2 then return true else return false: end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(2);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('recovers from extraneous endif at the end of one-line if-else', () => {
        //unexpected endif
        let { tokens } = Lexer.scan(`
            function test1()
                if 1 < 2: return true: else return false end if
            end function
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(2);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('recovers from missing end-if', () => {
        //unexpected endif
        let { tokens } = Lexer.scan(`
            function test1()
                if 1 < 2 then if 1 < 3
                    return true
            end function
            function test2()
            end function
        `);
        let { statements, diagnostics, references } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.lengthOf(2);
        expect(references.functionStatements).to.be.lengthOf(2);
    });

    it('catches extraneous colon at the end of one-line if', () => {
        //colon at the end not allowed
        let { tokens } = Lexer.scan(`
            if 1 < 2 then return true:
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches multi-line if inside a one-line if branch', () => {
        //second if should be inline
        let { tokens } = Lexer.scan(`
            if 1 < 2 then if 1 < 3
                return true
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports multiple statements in one-line if statements', () => {
        //second if should be inline
        let { tokens } = Lexer.scan(`
            if 1 < 2 then ok = true : m.ok = true : print "ok" : ook() else if 1 < 3
                return true
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches multi-line if inside a one-line if else branch', () => {
        //second if should be inline
        let { tokens } = Lexer.scan(`
            if 1 < 2 then return false else if 1 < 3
                return true
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(1);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('catches else statement missing colon', () => {
        //missing colon before `end if`
        let { tokens } = Lexer.scan(`
            if 1 < 2
              return true
            else return false end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.length.greaterThan(0);
        expect(statements).to.be.lengthOf(1);
    });

    it('supports if statement with condition and action on one line, but end if on separate line', () => {
        let { tokens } = Lexer.scan(`
            if 1 < 2: return true
            end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports colon after return in single-line if statement', () => {
        let { tokens } = Lexer.scan(`
            if false : print "true" : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports if elseif endif single line', () => {
        let { tokens } = Lexer.scan(`
            if true: print "8 worked": else if true: print "not run": else: print "not run": end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports comment at the end of one-line if', () => {
        let { tokens } = Lexer.scan(`
            if 1 > 2 then return true 'OK
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports colon at the beginning of a line', () => {
        let { tokens } = Lexer.scan(`
            if 1 < 2 then: if 1 < 4 then return false
            : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });

    it('supports one-line functions inside of one-line if statement', () => {
        let { tokens } = Lexer.scan(`
            if true then : test = sub() : print "yes" : end sub : end if
        `);
        let { statements, diagnostics } = Parser.parse(tokens);
        expect(diagnostics).to.be.lengthOf(0);
        expect(statements).to.be.length.greaterThan(0);
    });
});
