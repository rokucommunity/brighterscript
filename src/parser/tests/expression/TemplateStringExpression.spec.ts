/* eslint-disable @typescript-eslint/no-for-in-array */
/* eslint no-template-curly-in-string: 0 */

import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer/Lexer';
import { Parser, ParseMode } from '../../Parser';
import { AssignmentStatement } from '../../Statement';
import { Program } from '../../../Program';
import { expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';

describe('TemplateStringExpression', () => {
    describe('parser template String', () => {
        it('throws exception when used in brightscript scope', () => {
            let { tokens } = Lexer.scan(`a = \`hello \=world`);
            let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
            expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
        });

        describe('in assignment', () => {
            it(`simple case`, () => {
                let { tokens } = Lexer.scan(`a = \`hello      world\``);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(AssignmentStatement);
            });

            it(`complex case`, () => {
                let { tokens } = Lexer.scan(`a = \`hello \${a.text} world \${"template" + m.getChars()} test\``);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(AssignmentStatement);
            });

            it(`complex case`, () => {
                let { tokens } = Lexer.scan(`a = \`hello \${"world"}!
                    I am a \${"template" + "\`string\`"}
                    and I am very \${["pleased"][0]} to meet you \${m.top.getChildCount()}
                    the end.
                    goodnight\`
                `);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics[0]?.message).not.to.exist;
                expect(statements[0]).instanceof(AssignmentStatement);
            });

            it(`complex case that tripped up the transpile tests`, () => {

                let { tokens } = Lexer.scan('a = ["one", "two", `I am a complex example\n${a.isRunning(["a","b","c"])}`]');
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expectZeroDiagnostics(diagnostics);
                expect(statements[0]).instanceof(AssignmentStatement);
            });
        });

        it('catches missing closing backtick', () => {
            let { tokens } = Lexer.scan('name = `hello world');
            let parser = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expect(parser.diagnostics[0]?.message).to.equal(DiagnosticMessages.unterminatedTemplateStringAtEndOfFile().message);
        });
    });

    describe('transpile', () => {
        let rootDir = process.cwd();
        let program: Program;

        let testTranspile = getTestTranspile(() => [program, rootDir]);

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });

        afterEach(() => {
            program.dispose();
        });

        it('uses the proper prefix when aliased package is installed', () => {
            program.addOrReplaceFile('source/roku_modules/rokucommunity_bslib/bslib.brs', '');
            testTranspile(
                'a = `${one},${two}`',
                `a = rokucommunity_bslib_toString(one) + "," + rokucommunity_bslib_toString(two)`
            );
        });

        it('properly transpiles simple template string with no leading text', () => {
            testTranspile(
                'a = `${one},${two}`',
                `a = bslib_toString(one) + "," + bslib_toString(two)`
            );
        });

        it('properly transpiles simple template string', () => {
            testTranspile(
                'a = `hello world`',
                'a = "hello world"'
            );
        });

        it('properly transpiles one line template string with expressions', () => {
            testTranspile(
                'a = `hello ${a.text} world ${"template" + m.getChars()} test`',
                `a = "hello " + bslib_toString(a.text) + " world " + bslib_toString("template" + m.getChars()) + " test"`
            );
        });

        it('handles escaped characters', () => {
            testTranspile(
                'a = `\\r\\n\\`\\$`',
                `a = chr(13) + chr(10) + chr(96) + chr(36)`
            );
        });

        it('handles escaped unicode char codes', () => {
            testTranspile(
                'a = `\\c2\\c987`',
                `a = chr(2) + chr(987)`
            );
        });

        it('properly transpiles simple multiline template string', () => {
            testTranspile(
                'a = `hello world\nI am multiline`',
                'a = "hello world" + chr(10) + "I am multiline"'
            );
        });

        it('properly handles newlines', () => {
            testTranspile(
                'a = `\n`',
                'a = chr(10)'
            );
        });

        it('properly handles clrf', () => {
            testTranspile(
                'a = `\r\n`',
                'a = chr(13) + chr(10)'
            );
        });

        it('properly transpiles more complex multiline template string', () => {
            testTranspile(
                'a = `I am multiline\n${a.isRunning()}\nmore`',
                'a = "I am multiline" + chr(10) + bslib_toString(a.isRunning()) + chr(10) + "more"'
            );
        });

        it('properly transpiles complex multiline template string in array def', () => {
            testTranspile(
                `a = [
                    "one",
                    "two",
                    \`I am a complex example\${a.isRunning(["a", "b", "c"])}\`
                ]
            `, `
                a = [
                    "one",
                    "two",
                    "I am a complex example" + bslib_toString(a.isRunning([
                        "a",
                        "b",
                        "c"
                    ]))
                ]
            `);
        });

        it('properly transpiles complex multiline template string in array def, with nested template', () => {
            testTranspile(`
                a = [
                    "one",
                    "two",
                    \`I am a complex example \${a.isRunning([
                        "a",
                        "b",
                        "c",
                        \`d_open \${"inside" + m.items[i]} d_close\`
                    ])}\`
                ]
            `, `
                a = [
                    "one",
                    "two",
                    "I am a complex example " + bslib_toString(a.isRunning([
                        "a",
                        "b",
                        "c",
                        "d_open " + bslib_toString("inside" + m.items[i]) + " d_close"
                    ]))
                ]
            `);
        });

        it('properly transpiles two template strings side-by-side', () => {
            testTranspile(
                'a = `${"hello"}${"world"}`',
                'a = "hello" + "world"'
            );
        });

        it('skips calling toString on strings', () => {
            testTranspile(`
                text = \`Hello \${"world"}\`
            `, `
                text = "Hello " + "world"
            `);
        });

        describe('tagged template strings', () => {
            it('properly transpiles with escaped characters and quasis', () => {
                testTranspile(`
                    function zombify(strings, values)
                    end function
                    sub main()
                        zombie = zombify\`Hello \${"world"}\`
                    end sub
                `, `
                    function zombify(strings, values)
                    end function

                    sub main()
                        zombie = zombify(["Hello ", ""], ["world"])
                    end sub
                `);
            });

            it('handles multiple embedded expressions', () => {
                testTranspile(`
                    function zombify(strings, values)
                    end function
                    sub main()
                        zombie = zombify\`Hello \${"world"} I am \${12} years old\`
                    end sub
                `, `
                    function zombify(strings, values)
                    end function

                    sub main()
                        zombie = zombify(["Hello ", " I am ", " years old"], ["world", 12])
                    end sub
                `);
            });

            it('can be concatenated with regular string', () => {
                testTranspile(`
                    sub main()
                        thing = "this" + \`that\`
                        otherThing = \`that\` + "this"
                    end sub
                `, `
                    sub main()
                        thing = "this" + "that"
                        otherThing = "that" + "this"
                    end sub
                `, undefined, 'source/main.bs');
            });
        });
    });
});
