/* eslint-disable @typescript-eslint/no-for-in-array */
/* eslint no-template-curly-in-string: 0 */

import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer';
import { Parser, ParseMode } from '../../Parser';
import { AssignmentStatement } from '../../Statement';
import { getTestTranspile } from '../../../files/BrsFile.spec';
import { Program } from '../../../Program';

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
                    goodnight`
                );
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(AssignmentStatement);
            });

            it(`complex case that tripped up the transpile tests`, () => {

                let { tokens } = Lexer.scan('a = ["one", "two", `I am a complex example\n${a.isRunning(["a","b","c"])}`]');
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.lengthOf(0);
                expect(statements[0]).instanceof(AssignmentStatement);
            });
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

        it('properly transpiles simple template string', async () => {
            await testTranspile(
                'a = `hello world`',
                'a = "hello world"'
            );
        });

        it('properly transpiles one line template string with expressions', async () => {
            await testTranspile(
                'a = `hello ${a.text} world ${"template" + m.getChars()} test`',
                `a = "hello " + bslib_toString(a.text) + " world " + bslib_toString("template" + m.getChars()) + " test"`
            );
        });

        it('properly transpiles simple multiline template string', async () => {
            await testTranspile(
                'a = `hello world\nI am multiline`',
                'a = "hello world" + chr(10) + "I am multiline"'
            );
        });

        it('properly handles newlines', async () => {
            await testTranspile(
                'a = `\n`',
                'a = chr(10)'
            );
        });

        it('properly handles clrf', async () => {
            await testTranspile(
                'a = `\r\n`',
                'a = chr(13) + chr(10)'
            );
        });

        it('properly transpiles more complex multiline template string', async () => {
            await testTranspile(
                'a = `I am multiline\n${a.isRunning()}\nmore`',
                'a = "I am multiline" + chr(10) + bslib_toString(a.isRunning()) + chr(10) + "more"'
            );
        });

        it('properly transpiles complex multiline template string in array def', async () => {
            await testTranspile(
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

        it('properly transpiles complex multiline template string in array def, with nested template', async () => {
            await testTranspile(`
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
    });
});
