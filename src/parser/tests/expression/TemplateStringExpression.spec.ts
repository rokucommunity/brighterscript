/* eslint-disable @typescript-eslint/no-for-in-array */
/* eslint no-template-curly-in-string: 0 */

import { expect } from '../../../chai-config.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer/Lexer';
import { Parser, ParseMode } from '../../Parser';
import { AssignmentStatement } from '../../Statement';
import { Program } from '../../../Program';
import { expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';
import { util } from '../../../util';
import { TokenKind } from '../../../lexer/TokenKind';

describe('TemplateStringExpression', () => {
    describe('parser template String', () => {
        it('throws exception when used in brightscript scope', () => {
            let { tokens } = Lexer.scan(`a = \`hello \=world`);
            let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
            expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
        });

        describe('in assignment', () => {
            it('generates correct locations for quasis', () => {
                let { tokens } = Lexer.scan('print `0xAAAAAA${"0xBBBBBB"}0xCCCCCC`');
                expect(
                    tokens.filter(x => /"?0x/.test(x.text)).map(x => x.range)
                ).to.eql([
                    util.createRange(0, 7, 0, 15), // 0xAAAAAA
                    util.createRange(0, 17, 0, 27), // "0xBBBBBB"
                    util.createRange(0, 28, 0, 36) // 0xCCCCCC
                ]);
            });

            it('generates correct locations for items', () => {
                let { tokens } = Lexer.scan('print `${111}${222}${333}`');
                //throw out the `print` token
                tokens.shift();
                expect(
                    //compute the length of the token char spread
                    tokens.filter(x => x.text !== '').map(x => [x.range.end.character - x.range.start.character, x.text])
                ).to.eql([
                    '`',
                    '${',
                    '111',
                    '}',
                    '${',
                    '222',
                    '}',
                    '${',
                    '333',
                    '}',
                    '`'
                ].map(x => [x.length, x])
                );
            });


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
            program.setFile('source/roku_modules/rokucommunity_bslib/bslib.brs', '');
            testTranspile(`
                sub main()
                    a = \`\${LINE_NUM},\${LINE_NUM}\`
                end sub
            `, `
                sub main()
                    a = (rokucommunity_bslib_toString(LINE_NUM) + "," + rokucommunity_bslib_toString(LINE_NUM))
                end sub
            `);
        });

        it('properly transpiles simple template string with no leading text', () => {
            testTranspile(`
                    sub main()
                        a = \`\${LINE_NUM},\${LINE_NUM}\`
                    end sub
                `, `
                    sub main()
                        a = (bslib_toString(LINE_NUM) + "," + bslib_toString(LINE_NUM))
                    end sub
                `
            );
        });

        it('properly transpiles simple template string', () => {
            testTranspile(`
                sub main()
                    a = \`hello world\`
                end sub
            `, `
                sub main()
                    a = "hello world"
                end sub
            `);
        });

        it('properly transpiles one line template string with expressions', () => {
            testTranspile(`
                sub main()
                    a = \`hello \${LINE_NUM.text} world \${"template" + "".getChars()} test\`
                end sub
            `, `
                sub main()
                    a = ("hello " + bslib_toString(LINE_NUM.text) + " world " + bslib_toString("template" + "".getChars()) + " test")
                end sub
            `);
        });

        it('handles escaped characters', () => {
            testTranspile(`
                sub main()
                    a = \`\\r\\n\\\`\\$\`
                end sub
            `, `
                sub main()
                    a = chr(13) + chr(10) + chr(96) + chr(36)
                end sub
            `);
        });

        it('handles escaped unicode char codes', () => {
            testTranspile(`
                sub main()
                    a = \`\\c2\\c987\`
                end sub
            `, `
                sub main()
                    a = chr(2) + chr(987)
                end sub
            `);
        });

        it('properly transpiles simple multiline template string', () => {
            testTranspile(`
                sub main()
                    a = \`hello world\nI am multiline\`
                end sub
            `, `
                sub main()
                    a = "hello world" + chr(10) + "I am multiline"
                end sub
            `);
        });

        it('properly handles newlines', () => {
            testTranspile(`
                sub main()
                    a = \`\n\`
                end sub
            `, `
                sub main()
                    a = chr(10)
                end sub
            `);
        });

        it('properly handles clrf', () => {
            testTranspile(`
                sub main()
                    a = \`\r\n\`
                end sub
            `, `
                sub main()
                    a = chr(13) + chr(10)
                end sub
            `);
        });

        it('properly transpiles more complex multiline template string', () => {
            testTranspile(`
                sub main()
                    a = \`I am multiline\n\${a.isRunning()}\nmore\`
                end sub
            `, `
                sub main()
                    a = ("I am multiline" + chr(10) + bslib_toString(a.isRunning()) + chr(10) + "more")
                end sub
            `);
        });

        it('properly transpiles complex multiline template string in array def', () => {
            testTranspile(`
                sub main()
                    a = [
                        "one",
                        "two",
                        \`I am a complex example\${a.isRunning(["a", "b", "c"])}\`
                    ]
                end sub
            `, `
                sub main()
                    a = [
                        "one"
                        "two"
                        ("I am a complex example" + bslib_toString(a.isRunning([
                            "a"
                            "b"
                            "c"
                        ])))
                    ]
                end sub
            `);
        });

        it('properly transpiles complex multiline template string in array def, with nested template', () => {
            testTranspile(`
                sub main()
                    a = [
                        "one",
                        "two",
                        \`I am a complex example \${a.isRunning([
                            "a",
                            "b",
                            "c",
                            \`d_open \${"inside" + m.items[1]} d_close\`
                        ])}\`
                    ]
                end sub
            `, `
                sub main()
                    a = [
                        "one"
                        "two"
                        ("I am a complex example " + bslib_toString(a.isRunning([
                            "a"
                            "b"
                            "c"
                            ("d_open " + bslib_toString("inside" + m.items[1]) + " d_close")
                        ])))
                    ]
                end sub
            `);
        });

        it('properly transpiles two expressions side-by-side', () => {
            testTranspile(`
                sub main()
                    a = \`\${"hello"}\${"world"}\`
                end sub
            `, `
                sub main()
                    a = ("hello" + "world")
                end sub
            `);
        });

        it('skips calling toString on strings', () => {
            testTranspile(`
                sub main()
                    text = \`Hello \${"world"}\`
                end sub
            `, `
                sub main()
                    text = ("Hello " + "world")
                end sub
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
