import { assert, expect } from 'chai';
import * as sinonImport from 'sinon';
import { CompletionItemKind, Position, Range } from 'vscode-languageserver';
import type { Callable, CommentFlag } from '../interfaces';
import { Program } from '../Program';
import { BooleanType } from '../types/BooleanType';
import { DynamicType } from '../types/DynamicType';
import { TypedFunctionType } from '../types/TypedFunctionType';
import { IntegerType } from '../types/IntegerType';
import { StringType } from '../types/StringType';
import { BrsFile } from './BrsFile';
import { SourceMapConsumer } from 'source-map';
import { Lexer } from '../lexer/Lexer';
import { TokenKind, Keywords } from '../lexer/TokenKind';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { StandardizedFileEntry } from 'roku-deploy';
import util, { standardizePath as s } from '../util';
import PluginInterface from '../PluginInterface';
import { expectCompletionsIncludes, expectDiagnostics, expectHasDiagnostics, expectSymbolTableEquals, expectZeroDiagnostics, getTestTranspile, trim } from '../testHelpers.spec';
import { ParseMode } from '../parser/Parser';
import { Logger } from '../Logger';
import { ImportStatement } from '../parser/Statement';
import { createToken } from '../astUtils/creators';
import * as fsExtra from 'fs-extra';
import undent from 'undent';
import type { FunctionExpression } from '../parser/Expression';
import { ArrayType } from '../types/ArrayType';
import type { BscType } from '../types/BscType';
import { FloatType } from '../types/FloatType';
import { ObjectType } from '../types/ObjectType';
import { VoidType } from '../types/VoidType';
import { URI } from 'vscode-uri';

let sinon = sinonImport.createSandbox();

describe('BrsFile', () => {
    let tempDir = s`${process.cwd()}/.tmp`;
    let rootDir = s`${tempDir}/rootDir`;
    let program: Program;
    let srcPath = s`${rootDir}/source/main.brs`;
    let destPath = 'source/main.brs';
    let file: BrsFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, sourceMap: true });
        file = new BrsFile(srcPath, destPath, program);
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('allowBrighterScriptInBrightScript', () => {
        it('is false by default', () => {
            program.setFile('source/main.brs', `
                namespace CustomApp
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('namespace')
            }]);
        });

        it('allows bs features in brs', () => {
            program.options.allowBrighterScriptInBrightScript = true;
            program.setFile('source/main.brs', `
                namespace CustomApp
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    it('supports the third parameter in CreateObject', () => {
        program.setFile('source/main.brs', `
            sub main()
                regexp = CreateObject("roRegex", "[a-z]+", "i")
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('supports the 6 params in CreateObject for roRegion', () => {
        program.setFile('source/main.brs', `
            sub createRegion(bitmap as object)
                region = CreateObject("roRegion", bitmap, 20, 40, 100, 200)
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('sets needsTranspiled to true for .bs files', () => {
        //BrightScript
        expect(new BrsFile(`${rootDir}/source/main.brs`, 'source/main.brs', program).needsTranspiled).to.be.false;
        //BrighterScript
        expect(new BrsFile(`${rootDir}/source/main.bs`, 'source/main.bs', program).needsTranspiled).to.be.true;
    });

    it('computes new import statements after clearing parser references', () => {
        const file = program.setFile<BrsFile>('source/main.bs', ``);
        expect(file.ownScriptImports).to.be.empty;
        file.parser.ast.statements.push(
            new ImportStatement(createToken(TokenKind.Import), createToken(TokenKind.StringLiteral, 'pkg:/source/lib.brs'))
        );
        expect(file.ownScriptImports).to.be.empty;
        file.parser.invalidateReferences();
        expect(file.ownScriptImports.map(x => x.text)).to.eql(['pkg:/source/lib.brs']);
    });

    it('allows adding diagnostics', () => {
        const expected = [{
            message: 'message',
            file: undefined,
            range: undefined
        }];
        file.addDiagnostics(expected);
        expectDiagnostics(file, expected);
    });

    describe('getPartialVariableName', () => {
        let entry = {
            src: `${rootDir}/source/lib.brs`,
            dest: `source/lib.brs`
        } as StandardizedFileEntry;

        it('creates proper tokens', () => {
            file = program.setFile<BrsFile>(entry, `call(ModuleA.ModuleB.ModuleC.`);
            expect(file['getPartialVariableName'](file.parser.tokens[7])).to.equal('ModuleA.ModuleB.ModuleC.');
            expect(file['getPartialVariableName'](file.parser.tokens[6])).to.equal('ModuleA.ModuleB.ModuleC');
            expect(file['getPartialVariableName'](file.parser.tokens[5])).to.equal('ModuleA.ModuleB.');
            expect(file['getPartialVariableName'](file.parser.tokens[4])).to.equal('ModuleA.ModuleB');
            expect(file['getPartialVariableName'](file.parser.tokens[3])).to.equal('ModuleA.');
            expect(file['getPartialVariableName'](file.parser.tokens[2])).to.equal('ModuleA');
        });
    });

    describe('getScopesForFile', () => {
        it('finds the scope for the file', () => {
            let file = program.setFile('source/main.brs', ``);
            expect(program.getScopesForFile(file)[0]?.name).to.equal('source');
        });
    });

    describe('getCompletions', () => {
        it('does not crash for callfunc on a function call', () => {
            const file = program.setFile('source/main.brs', `
                sub main()
                    getManager()@.
                end sub
            `);
            expect(() => {
                program.getCompletions(file.srcPath, util.createPosition(2, 34));
            }).not.to.throw;
        });

        it('suggests pkg paths in strings that match that criteria', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print "pkg:"
                end sub
            `);
            const result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 31));
            const names = result.map(x => x.label);
            expect(names.sort()).to.eql([
                'pkg:/source/main.brs'
            ]);
        });

        it('suggests libpkg paths in strings that match that criteria', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print "libpkg:"
                end sub
            `);
            const result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 31));
            const names = result.map(x => x.label);
            expect(names.sort()).to.eql([
                'libpkg:/source/main.brs'
            ]);
        });

        it('suggests pkg paths in template strings', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print \`pkg:\`
                end sub
            `);
            const result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 31));
            const names = result.map(x => x.label);
            expect(names.sort()).to.eql([
                'pkg:/source/main.brs'
            ]);
        });

        it('waits for the file to be processed before collecting completions', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile('source/main.brs', `
                sub Main()
                    print "hello"
                    Say
                end sub

                sub SayHello()
                end sub
            `);

            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 23));
            let names = result.map(x => x.label);
            expect(names).to.includes('Main');
            expect(names).to.includes('SayHello');
        });

        it('includes every type of item at base level', () => {
            program.setFile('source/main.bs', `
                sub main()
                    print
                end sub
                sub speak()
                end sub
                namespace stuff
                end namespace
                class Person
                end class
                enum Direction
                end enum
            `);
            expectCompletionsIncludes(program.getCompletions('source/main.bs', util.createPosition(2, 26)), [{
                label: 'main',
                kind: CompletionItemKind.Function
            }, {
                label: 'speak',
                kind: CompletionItemKind.Function
            }, {
                label: 'stuff',
                kind: CompletionItemKind.Module
            }, {
                label: 'Person',
                kind: CompletionItemKind.Class
            }, {
                label: 'Direction',
                kind: CompletionItemKind.Enum
            }]);
        });

        describe('namespaces', () => {
            it('gets full namespace completions at any point through the leading identifier', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        foo.bar
                    end sub

                    namespace foo.bar
                    end namespace

                    class Person
                    end class
                `);

                const result = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(2, 24)).map(x => x.label);
                expect(result).includes('main');
                expect(result).includes('foo');
                expect(result).includes('Person');
            });

            it('gets namespace completions', () => {
                program.setFile('source/main.bs', `
                    namespace foo.bar
                        function sayHello()
                        end function
                    end namespace

                    sub Main()
                        print "hello"
                        foo.ba
                        foo.bar.
                    end sub
                `);

                let result = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(8, 30));
                let names = result.map(x => x.label);
                expect(names).to.includes('bar');

                result = program.getCompletions(`${rootDir}/source/main.bs`, Position.create(9, 32));
                names = result.map(x => x.label);
                expect(names).to.includes('sayHello');
            });
        });

        it('always includes `m`', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()

                end sub
            `);

            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            let names = result.map(x => x.label);
            expect(names).to.contain('m');
        });

        it('does not fail for missing previousToken', () => {
            //add a single character to the file, and get completions after it
            program.setFile('source/main.brs', `i`);
            expect(() => {
                program.getCompletions(`${rootDir}/source/main.brs`, Position.create(0, 1)).map(x => x.label);
            }).not.to.throw;
        });

        it('includes all keywords`', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()

                end sub
            `);

            let keywords = Object.keys(Keywords).filter(x => !x.includes(' '));

            //inside the function
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            let names = result.map(x => x.label);
            for (let keyword of keywords) {
                expect(names).to.include(keyword);
            }

            //outside the function
            result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(4, 8));
            names = result.map(x => x.label);
            for (let keyword of keywords) {
                expect(names).to.include(keyword);
            }
        });

        it('does not provide completions within a comment', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    'some comment
                end sub
            `);

            //inside the function
            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 33));
            expect(result).to.be.lengthOf(0);
        });

        it('does not provide duplicate entries for variables', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    name = "bob"
                    age = 12
                    name = "john"
                end sub
            `);

            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 23));

            let count = result.reduce((total, x) => {
                return x.label === 'name' ? total + 1 : total;
            }, 0);
            expect(count).to.equal(1);
        });

        it('does not include `as` and `string` text options when used in function params', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)

                end sub
            `);

            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 23));
            expect(result.filter(x => x.kind === CompletionItemKind.Text)).not.to.contain('as');
            expect(result.filter(x => x.kind === CompletionItemKind.Text)).not.to.contain('string');
        });

        it('does not provide intellisense results when inside a comment', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)
                    'this is a comment
                end sub
            `);

            let results = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(2, 30));
            expect(results).to.be.empty;
        });

        it('does provide intellisence for labels only after a goto keyword', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)
                    something:
                    goto \nend sub
            `);

            let results = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 25));
            expect(results.length).to.equal(1);
            expect(results[0]?.label).to.equal('something');
        });


        it('includes properties of objects', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile('source/main.brs', `
                sub Main()
                    myObj = {name:"Bob", age: 34, height:6.0}
                    myObj.
                end sub
            `);

            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 26));
            let names = result.map(x => x.label);
            expect(names).to.contain('name');
            expect(names).to.contain('age');
            expect(names).to.contain('height');
        });

        it('includes properties of m', () => {
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.setFile('source/main.brs', `
                sub Main()
                    m.someField= "hello"
                    m.
                end sub
            `);

            let result = program.getCompletions(`${rootDir}/source/main.brs`, Position.create(3, 22));
            let names = result.map(x => x.label);
            expect(names).to.contain('someField');
        });
    });

    describe('comment flags', () => {
        describe('bs:disable-next-line', () => {
            it('disables critical diagnostic issues', () => {
                program.setFile('source/main.brs', `
                    sub main()
                        Dim requestData
                    end sub
                `);
                //should have an error
                program.validate();
                expectHasDiagnostics(program);

                program.setFile('source/main.brs', `
                    sub main()
                        'bs:disable-next-line
                        Dim requestData
                    end sub
                `);
                //should not have an error
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('works with leading whitespace', () => {
                program.setFile('source/main.brs', `
                    sub main()
                        ' bs:disable-next-line
                        =asdf=sadf=
                    end sub
                `);
                //should have an error
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('works for all', () => {
                let file = program.setFile<BrsFile>({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub Main()
                        'bs:disable-next-line
                        name = "bob
                    end sub
                `);
                expect(file.commentFlags[0]).to.exist;
                expect(file.commentFlags[0]).to.deep.include({
                    codes: null,
                    range: Range.create(2, 24, 2, 45),
                    affectedRange: util.createRange(3, 0, 3, Number.MAX_SAFE_INTEGER)
                } as CommentFlag);
                program.validate();
                //the "unterminated string" error should be filtered out
                expectZeroDiagnostics(program);
            });

            it('works for specific codes', () => {
                let file = program.setFile<BrsFile>({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                    sub Main()
                        'bs:disable-next-line: 1083, 1001
                        name = "bob
                    end sub
                `);
                expect(file.commentFlags[0]).to.exist;
                expect(file.commentFlags[0]).to.deep.include({
                    codes: [1083, 1001],
                    range: Range.create(2, 24, 2, 57),
                    affectedRange: util.createRange(3, 0, 3, Number.MAX_SAFE_INTEGER)
                } as CommentFlag);
                //the "unterminated string" error should be filtered out
                expectZeroDiagnostics(program);
            });

            it('recognizes non-numeric codes', () => {
                let file = program.setFile<BrsFile>('source/main.brs', `
                    sub Main()
                        'bs:disable-next-line: LINT9999
                        name = "bob
                    end sub
                    `);
                expect(file.commentFlags[0]).to.exist;
                expectHasDiagnostics(program);
            });

            it('supports disabling non-numeric error codes', () => {
                const program = new Program({});
                const file = program.setFile('source/main.brs', `
                    sub main()
                        something = true 'bs:disable-line: LINT1005
                    end sub
                    `);
                file.addDiagnostics([{
                    code: 'LINT1005',
                    file: file,
                    message: 'Something is not right',
                    range: util.createRange(2, 16, 2, 26)
                }]);
                const scope = program.getScopesForFile(file)[0];
                expectZeroDiagnostics(scope);
            });

            it('adds diagnostics for unknown numeric diagnostic codes', () => {
                program.setFile({ src: `${rootDir} / source / main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        print "hi" 'bs:disable-line: 123456 999999   aaaab
                    end sub
                    `);

                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.unknownDiagnosticCode(123456),
                    range: Range.create(2, 53, 2, 59)
                }, {
                    ...DiagnosticMessages.unknownDiagnosticCode(999999),
                    range: Range.create(2, 60, 2, 66)
                }]);
            });

        });

        describe('bs:disable-line', () => {
            it('works for all', () => {
                let file = program.setFile<BrsFile>({ src: `${rootDir} / source / main.brs`, dest: 'source/main.brs' }, `
                    sub Main()
                        z::;;%%%%%% 'bs:disable-line
                    end sub
                `);
                expect(file.commentFlags[0]).to.exist;
                expect(file.commentFlags[0]).to.deep.include({
                    codes: null,
                    range: Range.create(2, 36, 2, 52),
                    affectedRange: Range.create(2, 0, 2, 36)
                } as CommentFlag);
                program.validate();
                //the "unterminated string" error should be filtered out
                expectZeroDiagnostics(program);
            });

            it('works for specific codes', () => {
                program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        'should not have any errors
                        DoSomething(1) 'bs:disable-line:1002
                        'should have an error because the param-count error is not being suppressed
                        DoSomething(1) 'bs:disable-line:1000
                    end sub
                    sub DoSomething()
                    end sub
                `);

                program.validate();

                expectDiagnostics(program, [{
                    range: Range.create(5, 24, 5, 35)
                }]);
            });

            it('handles the erraneous `stop` keyword', () => {
                //the current version of BRS causes parse errors after the `parse` keyword, showing error in comments
                //the program should ignore all diagnostics found in brs:* comment lines EXCEPT
                //for the diagnostics about using unknown error codes
                program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        stop 'bs:disable-line
                        print "need a valid line to fix stop error"
                    end sub
                    `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });
    });

    describe('parse', () => {
        it('allows class as parameter type', () => {
            program.setFile(`source/main.bs`, `
                class Person
                    name as string
                end class

                sub PrintPerson(p as Person)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows interface as parameter type', () => {
            program.setFile(`source/main.bs`, `
                interface Person
                    name as string
                end interface

                sub PrintPerson(p as Person)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows enum as parameter type', () => {
            program.setFile(`source/main.bs`, `
                enum Direction
                    up
                    down
                end enum

                sub PrintDirection(d as Direction)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('supports iife in assignment', () => {
            program.setFile('source/main.brs', `
                sub main()
                result = sub()
                    end sub()
                result = (sub()
                    end sub)()
                end sub
            `);
            expectZeroDiagnostics(program);
        });

        it('uses the proper parse mode based on file extension', () => {
            function testParseMode(destPath: string, expectedParseMode: ParseMode) {
                const file = program.setFile<BrsFile>(destPath, '');
                expect(file.parseMode).to.equal(expectedParseMode);
            }

            testParseMode('source/main.brs', ParseMode.BrightScript);
            testParseMode('source/main.spec.brs', ParseMode.BrightScript);
            testParseMode('source/main.d.brs', ParseMode.BrightScript);

            testParseMode('source/main.bs', ParseMode.BrighterScript);
            testParseMode('source/main.d.bs', ParseMode.BrighterScript);
            testParseMode('source/main.spec.bs', ParseMode.BrighterScript);
        });

        it('supports labels and goto statements', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    'multiple goto statements on one line
                    goto myLabel: goto myLabel
                    myLabel:
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports empty print statements', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    print
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        describe('conditional compile', () => {
            it('supports case-insensitive bs_const variables', () => {
                fsExtra.outputFileSync(`${rootDir}/manifest`, undent`
                    bs_const=SomeKey=true
                `);
                program.setFile('source/main.brs', `
                    sub something()
                        #if somekey
                            print "lower"
                        #end if
                        #if SOMEKEY
                            print "UPPER"
                        #end if
                        #if SomeKey
                            print "MiXeD"
                        #end if
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('works for upper case keywords', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #CONST someFlag = true
                        #IF someFlag
                            'code to execute when someFlag is true
                        #ELSEIF someFlag
                            'code to execute when anotherFlag is true
                        #ELSE
                            'code
                        #ENDIF
                    end sub
                `);
                expectZeroDiagnostics(file);
            });

            it('supports single-word #elseif and #endif', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #const someFlag = true
                        #if someFlag
                            'code to execute when someFlag is true
                        #elseif someFlag
                            'code to execute when anotherFlag is true
                        #endif
                    end sub
                `);
                expectZeroDiagnostics(file);
            });

            it('supports multi-word #else if and #end if', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #const someFlag = true
                        #if someFlag
                            'code to execute when someFlag is true
                        #else if someFlag
                            'code to execute when anotherFlag is true
                        #end if
                    end sub
                `);
                expectZeroDiagnostics(file);
            });

            it('does not choke on invalid code inside a false conditional compile', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #if false
                            non - commented code here should not cause parse errors
                        #end if
                    end sub
                `);
                expectZeroDiagnostics(file);
            });

            it('detects syntax error in #if', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #if true1
                            print "true"
                        #end if
                    end sub
                `);
                expectDiagnostics(file, [
                    DiagnosticMessages.referencedConstDoesNotExist()
                ]);
            });

            it('detects syntax error in #const', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #if %
                            print "true"
                        #end if
                    end sub
                `);
                expectDiagnostics(file, [
                    DiagnosticMessages.unexpectedCharacter('%'),
                    DiagnosticMessages.invalidHashIfValue()
                ]);
            });

            it('detects #const name using reserved word', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #const function = true
                    end sub
                `);
                expectDiagnostics(file, [
                    DiagnosticMessages.constNameCannotBeReservedWord(),
                    DiagnosticMessages.unexpectedToken('#const')
                ]);
            });

            it('detects syntax error in #const', () => {
                let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                    sub main()
                        #const someConst = 123
                    end sub
                `);
                expectDiagnostics(file, [
                    DiagnosticMessages.invalidHashConstValue()
                ]);
            });
        });

        it('supports stop statement', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    stop
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports single-line if statements', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                sub main()
                    if 1 < 2: return true: end if
                    if 1 < 2: return true
                    end if
                    if false : print "true" : end if
                    if true: print "8 worked": else if true: print "not run": else: print "not run": end if
                    if true then: test = sub() : print "yes" : end sub: end if
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports line_num as global variable', () => {
            file.parse(`
                sub Main()
                    print LINE_NUM
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports many keywords as object property names', () => {
            file.parse(`
                sub Main()
                    person = {}
                    person.and = true
                    person.box = true
                    person.createobject = true
                    person.dim = true
                    person.double = true
                    person.each = true
                    person.else = true
                    person.elseif = true
                    person.end = true
                    person.endfor = true
                    person.endfunction = true
                    person.endif = true
                    person.endsub = true
                    person.endwhile = true
                    person.eval = true
                    person.exit = true
                    person.exitfor = true
                    person.exitwhile = true
                    person.false = true
                    person.float = true
                    person.for = true
                    person.foreach = true
                    person.function = true
                    person.getglobalaa = true
                    person.getlastruncompileerror = true
                    person.getlastrunruntimeerror = true
                    person.goto = true
                    person.if = true
                    person.integer = true
                    person.invalid = true
                    person.let = true
                    person.line_num = true
                    person.longinteger = true
                    person.next = true
                    person.not = true
                    person.objfun = true
                    person.or = true
                    person.pos = true
                    person.print = true
                    person.rem = true
                    person.return = true
                    person.run = true
                    person.step = true
                    person.stop = true
                    person.string = true
                    person.sub = true
                    person.tab = true
                    person.then = true
                    person.to = true
                    person.true = true
                    person.type = true
                    person.while = true
                    person.public = true
                    person.protected = true
                    person.private = true
                    person.class = true
                    person.override = true
                    person.new = true
                end sub
            `);
            expectZeroDiagnostics(file);
        });
        it('does not error on numeric literal type designators', () => {
            file.parse(`
                sub main()
                    print &he2
                    print 1.2E+2
                    print 2!
                    print 12D - 12
                    print 2.3#
                    print &hFEDCBA9876543210&
                    print 9876543210&
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('does not error when encountering sub with return type', () => {
            file.parse(`
                sub main() as integer
                    return
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('does not lose function statements when mismatched end sub', () => {
            file.parse(`
                sub main()
                    sayHi()
                end function

                sub sayHi()
                    print "hello world"
                end sub
            `);
            expect(file.parser.references.functionStatements).to.be.lengthOf(2);
        });

        it('does not lose sub scope when mismatched end function', () => {
            file.parse(`
                function main()
                    sayHi()
                end sub

                sub sayHi()
                    print "hello world"
                end sub
            `);
            expect(file.parser.references.functionStatements).to.be.lengthOf(2);
        });

        it('does not error with boolean in RHS of set statement', () => {
            file.parse(`
                sub main()
                    foo = {
                        bar: false
                    }
                    foo.bar = true and false or 3 > 4
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('does not error with boolean in RHS of set statement', () => {
            file.parse(`
                sub main()
                    m = {
                        isTrue: false
                    }
                    m.isTrue = true = true
                    m.isTrue = m.isTrue = true
                    m.isTrue = m.isTrue = m.isTrue
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports variable names ending with type designators', () => {
            file.parse(`
                sub main()
                    name$ = "bob"
                    age% = 1
                    height! = 5.5
                        salary# = 9.87654321
                    someHex& = 13
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports multiple spaces between two-word keywords', () => {
            file.parse(`
                sub main()
                    if true then
                        print "true"
                    else if true then
                        print "also true"
                    end if
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('does not error with `stop` as object key', () => {
            file.parse(`
                function GetObject()
                    obj = {
                    stop: function () as void

                            end function
                    }
                    return obj
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('does not error with `run` as object key', () => {
            file.parse(`
                function GetObject()
                    obj = {
                        run: function () as void

                        end function
                        }
                    return obj
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports assignment operators', () => {
            file.parse(`
                function Main()
                    x = 1
                    x += 1
                    x += 2
                    x -= 1
                    x /= 2
                    x = 9
                    x \\= 2
                    x *= 3.0
                    x -= 1
                    print x
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports `then` as object property', () => {
            file.parse(`
                function Main()
                    promise = {
                        then: sub()
                                end sub
                    }
                    promise.then()
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports function as parameter type', () => {
            file.parse(`
                sub Main()
                    doWork = function (callback as function)
                    end function
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports increment operator', () => {
            file.parse(`
                function Main()
                    x = 3
                    x++
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports decrement operator', () => {
            file.parse(`
                function Main()
                    x = 3
                    x--
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports writing numbers with decimal but no trailing digit', () => {
            file.parse(`
                function Main()
                    x = 3.
                    print x
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports assignment operators against object properties', () => {
            file.parse(`
                function Main()
                    m.age = 1

                    m.age += 1
                    m.age -= 1
                    m.age *= 1
                    m.age /= 1
                    m.age \\= 1

                    m["age"] += 1
                    m["age"] -= 1
                    m["age"] *= 1
                    m["age"] /= 1
                    m["age"] \\= 1

                    print m.age
                end function
            `);
            expectZeroDiagnostics(file);
        });

        //skipped until `brs` supports this
        it('supports bitshift assignment operators', () => {
            file.parse(`
                function Main()
                    x = 1
                    x <<= 8
                    x >>= 4
                    print x
                end function
            `);
            expectZeroDiagnostics(file);
        });

        //skipped until `brs` supports this
        it('supports bitshift assignment operators on objects', () => {
            file.parse(`
                    function Main()
                        m.x = 1
                        m.x <<= 1
                        m.x >>= 1
                        print m.x
                    end function
                `);
            expectZeroDiagnostics(file);
        });

        it('supports leading and trailing periods for numeric literals', () => {
            file.parse(`
                function Main()
                    one = 1.
                    print one
                    pointOne = .1
                    print pointOne
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('supports bitshift assignment operators on object properties accessed by array syntax', () => {
            file.parse(`
                    function Main()
                        m.x = 1
                        'm['x'] << 1
                        'm['x'] >> 1
                        print m.x
                    end function
                `);
            expectZeroDiagnostics(file);
        });

        it('supports weird period AA accessor', () => {
            file.parse(`
                function Main()
                    m._uuid = "123"
                    print m.["_uuid"]
                end function
            `);
            expectZeroDiagnostics(file);
        });

        it('adds error for library statements NOT at top of file', () => {
            program.setFile('source/file.brs', ``);
            program.setFile('source/main.bs', `
                sub main()
                end sub
                import "file.brs"
        `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.importStatementMustBeDeclaredAtTopOfFile()
            ]);
        });

        it('supports library imports', () => {
            program.setFile('source/main.brs', `
                Library "v30/bslCore.brs"
            `);
            expectZeroDiagnostics(program);
        });

        it('adds error for library statements NOT at top of file', () => {
            program.setFile('source/main.brs', `
                sub main()
                end sub
                Library "v30/bslCore.brs"
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.libraryStatementMustBeDeclaredAtTopOfFile()
            ]);
        });

        it('adds error for library statements inside of function body', () => {
            program.setFile('source/main.brs', `
                sub main()
                    Library "v30/bslCore.brs"
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.libraryStatementMustBeDeclaredAtTopOfFile()
            ]);
        });

        it('supports colons as separators in associative array properties', () => {
            file.parse(`
                sub Main()
                    obj = { x: 0 : y: 1 }
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('succeeds when finding variables with "sub" in them', () => {
            let file = program.setFile('source/main.brs', `
                function DoSomething()
                    return value.subType()
                end function
            `);
            expect(file.callables[0]).to.deep.include({
                file: file,
                nameRange: Range.create(1, 25, 1, 36)
            });
        });

        it('succeeds when finding variables with the word "function" in them', () => {
            file.parse(`
        function Test()
        typeCheckFunction = RBS_CMN_GetFunction(invalid, methodName)
                end function
            `);
        });

        it('finds line and column numbers for functions', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function DoA()
                    print "A"
                end function

                function DoB()
                    print "B"
                end function
            `);
            expect(file.callables[0].name).to.equal('DoA');
            expect(file.callables[0].nameRange).to.eql(Range.create(1, 25, 1, 28));

            expect(file.callables[1].name).to.equal('DoB');
            expect(file.callables[1].nameRange).to.eql(Range.create(5, 25, 5, 28));
        });

        it('throws an error if the file has already been parsed', () => {
            let file = new BrsFile('abspath', 'relpath', program);
            file.parse(`'a comment`);
            try {
                file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('finds and registers duplicate callables', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            expect(file.callables.length).to.equal(2);
            expect(file.callables[0].name).to.equal('DoA');
            expect(file.callables[0].nameRange.start.line).to.equal(1);

            expect(file.callables[1].name).to.equal('DoA');
            expect(file.callables[1].nameRange.start.line).to.equal(5);
        });

        it('finds function call line and column numbers', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function DoA()
                    DoB("a")
                end function
                function DoB(a as string)
                    DoC()
                end function
            `);
            expect(file.functionCalls.length).to.equal(2);

            expect(file.functionCalls[0].range).to.eql(Range.create(2, 20, 2, 28));
            expect(file.functionCalls[0].nameRange).to.eql(Range.create(2, 20, 2, 23));

            expect(file.functionCalls[1].range).to.eql(Range.create(5, 20, 5, 25));
            expect(file.functionCalls[1].nameRange).to.eql(Range.create(5, 20, 5, 23));
        });

        it('sanitizes brs errors', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function DoSomething
                end function
            `);
            expectHasDiagnostics(file);
            expect(file.getDiagnostics()[0].file).to.equal(file);
            expect(file.getDiagnostics()[0].range.start.line).to.equal(1);
        });

        it('supports using the `next` keyword in a for loop', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                sub countit()
                    for each num in [1,2,3]
                        print num
                    next
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        //test is not working yet, but will be enabled when brs supports this syntax
        it('supports assigning functions to objects', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function main()
                    o = CreateObject("roAssociativeArray")
                    o.sayHello = sub()
                        print "hello"
                    end sub
                end function
            `);
            expectZeroDiagnostics(file);
        });
    });

    describe('findCallables', () => {
        it('finds range', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                sub Sum()
                    print "hello world"
                end sub
            `);
            let callable = file.callables[0];
            expect(callable.range).to.eql(Range.create(1, 16, 3, 23));
        });

        it('finds correct body range even with inner function', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                sub Sum()
                    sayHi = sub()
                        print "Hi"
                    end sub
                    sayHi()
                end sub
            `);
            let callable = file.callables[0];
            expect(callable.range).to.eql(Range.create(1, 16, 6, 23));
        });

        it('finds callable parameters', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function Sum(a, b, c)

                end function
            `);
            let callable = file.callables[0];
            expect(callable.params[0]).to.deep.include({
                name: 'a',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[0].type).instanceof(DynamicType);

            expect(callable.params[1]).to.deep.include({
                name: 'b',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[1].type).instanceof(DynamicType);

            expect(callable.params[2]).to.deep.include({
                name: 'c',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[2].type).instanceof(DynamicType);
        });

        it('finds optional parameters', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function Sum(a=2)

                end function
            `);
            let callable = file.callables[0];
            expect(callable.params[0]).to.deep.include({
                name: 'a',
                isOptional: true,
                isRestArgument: false
            });
            expect(callable.params[0].type).instanceof(IntegerType);
        });

        it('finds parameter types', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function Sum(a, b as integer, c as string)

                end function
            `);
            let callable = file.callables[0];
            expect(callable.params[0]).to.deep.include({
                name: 'a',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[0].type).instanceof(DynamicType);

            expect(callable.params[1]).to.deep.include({
                name: 'b',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[1].type).instanceof(IntegerType);

            expect(callable.params[2]).to.deep.include({
                name: 'c',
                isOptional: false,
                isRestArgument: false
            });
            expect(callable.params[2].type).instanceof(StringType);
        });
    });

    describe('findCallableInvocations', () => {
        it('finds arguments with literal values', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function Sum()
                    DoSomething("name", 12, true)
                end function
            `);
            expect(file.functionCalls.length).to.equal(1);

            const argsMap = file.functionCalls[0].args.map(arg => {
                // disregard arg.expression, etc.
                return { type: arg.type, range: arg.range, text: arg.text };
            });
            expect(argsMap).to.eql([{
                type: new StringType(),
                range: util.createRange(2, 32, 2, 38),
                text: '"name"'
            }, {
                type: new IntegerType(),
                range: util.createRange(2, 40, 2, 42),
                text: '12'
            }, {
                type: new BooleanType(),
                range: util.createRange(2, 44, 2, 48),
                text: 'true'
            }]);
        });

        it('finds function calls nested inside statements', () => {
            program.setFile(`source/main.brs`, `
                sub main()
                    if true then
                        DoesNotExist(1, 2)
                    end if
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('DoesNotExist')
            ]);
        });

        it('finds arguments with variable values', () => {
            let file = new BrsFile('absolute_path/file.brs', 'relative_path/file.brs', program);
            file.parse(`
                function Sum()
                    count = 1
                    name = "John"
                    isAlive = true
                    DoSomething(count, name, isAlive)
                end function
            `);
            expect(file.functionCalls.length).to.equal(1);
            expect(file.functionCalls[0].args[0]).deep.include({
                type: new IntegerType(),
                text: 'count'
            });
            expect(file.functionCalls[0].args[1]).deep.include({
                type: new StringType(),
                text: 'name'
            });
            expect(file.functionCalls[0].args[2]).deep.include({
                type: new BooleanType(),
                text: 'isAlive'
            });
        });
    });

    describe('findCallables', () => {
        //this test is to help with code coverage
        it('skips top-level statements', () => {
            let file = new BrsFile('absolute', 'relative', program);
            file.parse('name = "Bob"');
            expect(file.callables.length).to.equal(0);
        });

        it('finds return type', () => {
            let file = program.setFile('source/main.brs', `
                function DoSomething() as string
                end function
            `);
            expect(file.callables[0]).to.deep.include(<Partial<Callable>>{
                file: file,
                nameRange: Range.create(1, 25, 1, 36),
                name: 'DoSomething',
                params: []
            });
            expect(file.callables[0].type.returnType).instanceof(StringType);
        });
    });

    describe('function local variable handling', () => {
        it('creates range properly', () => {
            file.parse(`
                sub Main()
                    name = 'bob"
                end sub
            `);
            expect(file.parser.references.functionStatements[0].range).to.eql(Range.create(1, 16, 3, 23));
        });

        it('creates scopes for parent and child functions', () => {
            file.parse(`
                sub Main()
                    sayHi = sub()
                        print "hi"
                    end sub

                    scheduleJob(sub()
                        print "job completed"
                    end sub)
                end sub
            `);
            expect(file.parser.references.functionExpressions).to.be.length(3);
        });

        it('finds variables declared in function expressions', () => {
            file.parse(`
                sub Main()
                    sayHi = sub()
                        age = 12
                    end sub

                    scheduleJob(sub()
                        name = "bob"
                    end sub)
                end sub
            `);

            expectSymbolTableEquals(file.parser.references.functionExpressions[0].symbolTable, [
                ['sayHi', new TypedFunctionType(new VoidType(), true), util.createRange(2, 20, 2, 25)]
            ]);

            expectSymbolTableEquals(file.parser.references.functionExpressions[1].symbolTable, [
                ['age', new IntegerType(), util.createRange(3, 24, 3, 27)]
            ]);

            expectSymbolTableEquals(file.parser.references.functionExpressions[2].symbolTable, [
                ['name', new StringType(), util.createRange(7, 24, 7, 28)]
            ]);
        });

        it('finds variable declarations inside of if statements', () => {
            file.parse(`
                sub Main()
                    if true then
                        theLength = 1
                    end if
                end sub
            `);
            expectSymbolTableEquals(file.parser.references.functionExpressions[0].symbolTable, [
                ['theLength', new IntegerType(), util.createRange(3, 24, 3, 33)]
            ]);
        });

        it('finds value from global return', () => {
            let file = program.setFile<BrsFile>('source/main.brs', `
                sub Main()
                   myName = GetName()
                end sub

                function GetName() as string
                    return "bob"
                end function
            `);

            expectSymbolTableEquals(file.parser.references.functionExpressions[0].symbolTable, [
                ['myName', new StringType(), util.createRange(2, 19, 2, 25)]
            ]);
        });

        it('finds variable type from other variable', () => {
            file.parse(`
                sub Main()
                    name = "bob"
                    nameCopy = name
                end sub
            `);

            expectSymbolTableEquals(file.parser.references.functionExpressions[0].symbolTable, [
                ['name', new StringType(), util.createRange(2, 20, 2, 24)],
                ['nameCopy', new StringType(), util.createRange(3, 20, 3, 28)]
            ]);
        });

        it('sets proper range for functions', () => {
            file.parse(`
                sub Main()
                    getName = function()
                        return "bob"
                    end function
                end sub
            `);

            expect(file.parser.references.functionExpressions.map(x => x.range)).to.eql([
                util.createRange(1, 16, 5, 23),
                util.createRange(2, 30, 4, 32)
            ]);
        });
    });

    it('handles mixed case `then` partions of conditionals', () => {
        let mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            sub Main()
                if true then
                    print "works"
                end if
            end sub
        `);

        expect(mainFile.getDiagnostics()).to.be.lengthOf(0);
        mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            sub Main()
                if true Then
                    print "works"
                end if
            end sub
        `);
        expect(mainFile.getDiagnostics()).to.be.lengthOf(0);

        mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            sub Main()
                if true THEN
                    print "works"
                end if
            end sub
        `);
        expect(mainFile.getDiagnostics()).to.be.lengthOf(0);
    });

    describe('getHover', () => {
        it('works for param types', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                sub DoSomething(name as string)
                    name = 1
                    sayMyName = function (name as string)
                    end function
                end sub
            `);

            //hover over the `name = 1` line
            let hover = program.getHover(file.srcPath, Position.create(2, 24))[0];
            expect(hover).to.exist;
            expect(hover.range).to.eql(Range.create(2, 20, 2, 24));

            //hover over the `name` parameter declaration
            hover = program.getHover(file.srcPath, Position.create(1, 34))[0];
            expect(hover).to.exist;
            expect(hover.range).to.eql(Range.create(1, 32, 1, 36));
        });

        //ignore this for now...it's not a huge deal
        it('does not match on keywords or data types', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                sub Main(name as string)
                end sub
                sub as ()
                end sub
            `);
            //hover over the `as`
            expect(program.getHover(file.srcPath, Position.create(1, 31))).to.be.empty;
            //hover over the `string`
            expect(program.getHover(file.srcPath, Position.create(1, 36))).to.be.empty;
        });

        it('finds declared function', () => {
            let file = program.setFile({ src: `${rootDir} /source/main.brs`, dest: 'source/main.brs' }, `
                function Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end function
            `);

            let hover = program.getHover(file.srcPath, Position.create(1, 28))[0];
            expect(hover).to.exist;

            expect(hover.range).to.eql(Range.create(1, 25, 1, 29));
            expect(hover.contents).to.equal([
                '```brightscript',
                'function Main(count? as integer) as dynamic',
                '```'
            ].join('\n'));
        });

        it('finds declared namespace function', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            namespace mySpace
                function Main(count = 1)
                    firstName = "bob"
                    age = 21
                    shoeSize = 10
                end function
            end namespace
            `);

            let hover = program.getHover(file.srcPath, Position.create(2, 28))[0];
            expect(hover).to.exist;

            expect(hover.range).to.eql(Range.create(2, 25, 2, 29));
            expect(hover.contents).to.equal([
                '```brightscript',
                'function Main(count? as integer) as dynamic',
                '```'
            ].join('\n'));
        });

        it('finds variable function hover in same scope', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName = sub(name as string)
                    end sub

                    sayMyName()
                end sub
            `);

            let hover = program.getHover(file.srcPath, Position.create(5, 24))[0];

            expect(hover.range).to.eql(Range.create(5, 20, 5, 29));
            expect(hover.contents).to.equal([
                '```brightscript',
                'sub (name as string) as void',
                '```'
            ].join('\n'));
        });

        it('does not crash when hovering on built-in functions', () => {
            let file = program.setFile('source/main.brs', `
                function doUcase(text)
                    return ucase(text)
                end function
            `);

            expect(
                program.getHover(file.srcPath, Position.create(2, 30))[0].contents
            ).to.equal([
                '```brightscript',
                'function UCase(s as string) as string',
                '```'
            ].join('\n'));
        });

        it('does not crash when hovering on object method call', () => {
            let file = program.setFile('source/main.brs', `
                function getInstr(url, text)
                    return url.instr(text)
                end function
            `);

            expect(
                program.getHover(file.srcPath, Position.create(2, 35))[0].contents
            ).to.equal([
                '```brightscript',
                'instr as dynamic',
                '```'
            ].join('\n'));
        });

        it('finds function hover in file scope', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
            `);

            let hover = program.getHover(file.srcPath, Position.create(2, 25))[0];

            expect(hover.range).to.eql(Range.create(2, 20, 2, 29));
            expect(hover.contents).to.equal([
                '```brightscript',
                'sub sayMyName() as void',
                '```'
            ].join('\n'));
        });

        it('finds namespace function hover in file scope', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                namespace mySpace
                sub Main()
                    sayMyName()
                end sub

                sub sayMyName()

                end sub
                end namespace
            `);

            let hover = program.getHover(file.srcPath, Position.create(3, 25))[0];

            expect(hover.range).to.eql(Range.create(3, 20, 3, 29));
            expect(hover.contents).to.equal([
                '```brightscript',
                'sub sayMyName() as void',
                '```'
            ].join('\n'));
        });

        it('finds function hover in scope', () => {
            let rootDir = process.cwd();
            program = new Program({
                rootDir: rootDir
            });

            let mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    sayMyName()
                end sub
            `);

            program.setFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                sub sayMyName(name as string)

                end sub
            `);

            let hover = program.getHover(mainFile.srcPath, Position.create(2, 25))[0];
            expect(hover).to.exist;

            expect(hover.range).to.eql(Range.create(2, 20, 2, 29));
            expect(hover.contents).to.equal([
                '```brightscript',
                'sub sayMyName(name as string) as void',
                '```'
            ].join('\n'));
        });

        it('finds namespace function hover in scope', () => {
            let rootDir = process.cwd();
            program = new Program({
                rootDir: rootDir
            });

            let mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    mySpace.sayMyName()
                end sub
            `);

            program.setFile({ src: `${rootDir}/source/lib.brs`, dest: 'source/lib.brs' }, `
                namespace mySpace
                    sub sayMyName(name as string)
                    end sub
                end namespace
            `);

            let hover = program.getHover(mainFile.srcPath, Position.create(2, 34))[0];
            expect(hover).to.exist;

            expect(hover.range).to.eql(Range.create(2, 28, 2, 37));
            expect(hover.contents).to.equal([
                '```brightscript',
                'sub sayMyName(name as string) as void',
                '```'
            ].join('\n'));
        });

        it('includes markdown comments in hover.', () => {
            let rootDir = process.cwd();
            program = new Program({
                rootDir: rootDir
            });

            const file = program.setFile('source/lib.brs', `
                '
                ' The main function
                '
                sub main()
                    log("hello")
                end sub

                '
                ' Prints a message to the log.
                ' Works with *markdown* **content**
                '
                sub log(message as string)
                    print message
                end sub
            `);

            //hover over log("hello")
            expect(
                program.getHover(file.srcPath, Position.create(5, 22))[0].contents
            ).to.equal([
                '```brightscript',
                'sub log(message as string) as void',
                '```',
                '***',
                '',
                ' Prints a message to the log.',
                ' Works with *markdown* **content**',
                ''
            ].join('\n'));

            //hover over sub ma|in()
            expect(
                trim(
                    program.getHover(file.srcPath, Position.create(4, 22))[0].contents.toString()
                )
            ).to.equal(trim`
                \`\`\`brightscript
                sub main() as void
                \`\`\`
                ***

                 The main function
                `
            );
        });

        it('handles mixed case `then` partions of conditionals', () => {
            let mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true then
                        print "works"
                    end if
                end sub
            `);

            expectZeroDiagnostics(mainFile);
            mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true Then
                        print "works"
                    end if
                end sub
            `);
            expectZeroDiagnostics(mainFile);

            mainFile = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true THEN
                        print "works"
                    end if
                end sub
            `);
            expectZeroDiagnostics(mainFile);
        });

        it('displays the context from multiple scopes', () => {

            let commonFile = program.setFile('source/common.brs', `
                sub displayPi()
                    pi = getPi()
                    print pi
                end sub
            `);

            let scope1File = program.setFile('components/comp1/scope1.brs', `
                function getPi() as string
                    return "apple"
                end function
            `);
            expect(scope1File.getDiagnostics()).to.be.lengthOf(0);
            program.setFile('components/comp1/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Group">
                    <script type="text/brightscript" uri="scope1.brs" />
                    <script type="text/brightscript" uri="pkg:/source/common.brs" />
                </component>
            `);

            let scope2File = program.setFile('components/comp2/scope2.brs', `
                function getPi() as float
                    return 3.14
                end function
            `);
            expect(scope2File.getDiagnostics()).to.be.lengthOf(0);
            program.setFile('components/comp2/comp2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component2" extends="Group">
                    <script type="text/brightscript" uri="scope2.brs" />
                    <script type="text/brightscript" uri="pkg:/source/common.brs" />
                </component>
            `);

            program.validate();
            let funcCallHover = program.getHover(commonFile.srcPath, Position.create(2, 27));
            expect(funcCallHover[0]?.contents).to.equal([
                '```brightscript',
                'function getPi() as string | function getPi() as float | getPi as uninitialized',
                '```'
            ].join('\n'));

            let variableHover = program.getHover(commonFile.srcPath, Position.create(3, 27));
            expect(variableHover[0]?.contents).to.equal([
                '```brightscript',
                'pi as string | pi as float | pi as uninitialized',
                '```'
            ].join('\n'));
        });

        it('finds function with custom types as parameters and return types', () => {
            let file = program.setFile('source/main.bs', `
                sub main()
                    k = new MyKlass()
                    processMyKlass(k)
                end sub

                function processMyKlass(data as MyKlass) as MyKlass
                    return data
                end function

                class MyKlass
                end class
            `);

            let hover = program.getHover(file.srcPath, Position.create(3, 29));
            expect(hover).to.exist;
            expect(hover[0].contents).to.equal([
                '```brightscript',
                'function processMyKlass(data as MyKlass) as MyKlass',
                '```'
            ].join('\n'));
        });

        it('finds function with arrays as parameters and return types', () => {
            let file = program.setFile('source/main.bs', `
                sub main()
                    k = new MyKlass()
                    processData([k])
                end sub

                function processData(data as MyKlass[]) as MyKlass[]
                    return data
                end function

                class MyKlass
                end class
            `);

            let hover = program.getHover(file.srcPath, Position.create(3, 29));
            expect(hover).to.exist;
            expect(hover[0].contents).to.equal([
                '```brightscript',
                'function processData(data as MyKlass[]) as MyKlass[]',
                '```'
            ].join('\n'));
        });

        it('display literal enum members', () => {
            let file = program.setFile('source/main.bs', `
                enum MyEnum
                    foo
                    bar
                end enum

                sub main()
                    value = MyEnum.foo
                    print value
                end sub
            `);

            let hover = program.getHover(file.srcPath, Position.create(7, 38)); // 'myEnum.foo' in value assignnmnt
            expect(hover).to.exist;
            expect(hover[0].contents).to.equal([
                '```brightscript',
                'MyEnum.foo as MyEnum',
                '```'
            ].join('\n'));
        });


        it('finds enum values from assignments', () => {
            let file = program.setFile('source/main.bs', `
                enum MyEnum
                    foo
                    bar
                end enum

                sub main()
                    value = MyEnum.foo
                    print value
                end sub
            `);

            let hover = program.getHover(file.srcPath, Position.create(8, 30)); // 'value' in print statement
            expect(hover).to.exist;
            expect(hover[0].contents).to.equal([
                '```brightscript',
                'value as MyEnum',
                '```'
            ].join('\n'));
        });


        it('finds enum values as parameters', () => {
            let file = program.setFile('source/main.bs', `
                enum MyEnum
                    foo
                    bar
                end enum

                sub printEnum(enumParamVal as MyEnum)
                    print enumParamVal
                end sub

                sub main()
                    printEnum(MyEnum.foo)
                end sub
            `);

            let hover = program.getHover(file.srcPath, Position.create(7, 30)); // 'enumParamVal' in print statement
            expect(hover).to.exist;
            expect(hover[0].contents).to.equal([
                '```brightscript',
                'enumParamVal as MyEnum',
                '```'
            ].join('\n'));
        });
    });

    it('does not throw when encountering incomplete import statement', () => {
        program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            import
            sub main()
            end sub
        `);
        program.validate();
        //this test will throw an exception if something went wrong
    });

    describe('transpile', () => {
        it('excludes trailing commas in array literals', () => {
            testTranspile(`
                sub main()
                    arr = [
                        1,
                        2,
                        3
                    ]
                    obj = {
                        one: 1,
                        two: 2,
                        three: 3
                    }
                end sub
            `, `
                sub main()
                    arr = [
                        1
                        2
                        3
                    ]
                    obj = {
                        one: 1
                        two: 2
                        three: 3
                    }
                end sub
            `);
        });

        it('transpiles if statement keywords as provided', () => {
            const code = `
                sub main()
                    If True Then
                        Print True
                    Else If True Then
                        print True
                    Else If False Then
                        Print False
                    Else
                        Print False
                    End If
                end sub
            `;
            testTranspile(code);
            testTranspile(code.toLowerCase());
            testTranspile(code.toUpperCase());
        });

        it('does not transpile `then` tokens', () => {
            testTranspile(`
                sub main()
                    if true
                        print true
                    else if true
                        print false
                    end if
                end sub
            `);
        });

        it('honors spacing between multi-word tokens', () => {
            testTranspile(`
                sub main()
                    if true
                        print true
                    elseif true
                        print false
                    endif
                end sub
            `);
        });

        it('handles when only some of the statements have `then`', () => {
            testTranspile(`
                sub main()
                    if true
                    else if true then
                    else if true
                    else if true then
                        if true then
                            return true
                        end if
                    end if
                end sub
            `);
        });

        it('retains casing of parameter types', () => {
            function test(type: string) {
                testTranspile(`
                    sub one(a as ${type}, b as ${type.toUpperCase()}, c as ${type.toLowerCase()})
                    end sub
                `);
            }
            test('Boolean');
            test('Double');
            test('Dynamic');
            test('Float');
            test('Integer');
            test('LongInteger');
            test('Object');
            test('String');
        });

        it('retains casing of return types', () => {
            function test(type: string) {
                testTranspile(`
                    sub one() as ${type}
                    end sub

                    sub two() as ${type.toLowerCase()}
                    end sub

                    sub three() as ${type.toUpperCase()}
                    end sub
                `);
            }
            test('Boolean');
            test('Double');
            test('Dynamic');
            test('Float');
            test('Integer');
            test('LongInteger');
            test('Object');
            test('String');
            test('Void');
        });

        it('retains casing of literal types', () => {
            function test(type: string) {
                testTranspile(`
                    sub main()
                        thing = ${type}
                        thing = ${type.toLowerCase()}
                        thing = ${type.toUpperCase()}
                    end sub
                `);
            }
            test('Invalid');
            test('True');
            test('False');
        });
        describe('throwStatement', () => {
            it('transpiles properly', () => {
                testTranspile(`
                    sub main()
                        try
                            throw "some message"
                        catch e
                        end try
                    end sub
                `);
            });
        });

        describe('try/catch', () => {
            it('transpiles properly', () => {
                testTranspile(`
                    sub main()
                        try
                            print m.b.c
                        catch e
                            print e
                        end try
                    end sub
                `);
            });
        });

        describe('namespaces', () => {
            it('properly transpiles namespace functions for assignments', () => {
                testTranspile(`
                    namespace NameA.NameB
                        sub Speak()
                        end sub
                    end namespace
                    sub main()
                        sayHello = NameA.NameB.Speak
                        sayHello()
                        someOtherObject = m.other.object
                    end sub
                `, `
                    sub NameA_NameB_Speak()
                    end sub

                    sub main()
                        sayHello = NameA_NameB_Speak
                        sayHello()
                        someOtherObject = m.other.object
                    end sub
                `);
            });

            it('properly transpiles inferred namespace function for assignment', () => {
                testTranspile(`
                    namespace NameA.NameB
                        sub Speak()
                        end sub
                        sub main()
                            sayHello = Speak
                            sayHello()
                        end sub
                    end namespace
                `, `
                    sub NameA_NameB_Speak()
                    end sub

                    sub NameA_NameB_main()
                        sayHello = NameA_NameB_Speak
                        sayHello()
                    end sub
                `);
            });
        });
        it('includes all text to end of line for a non-terminated string', () => {
            testTranspile(
                'sub main()\n    name = "john \nend sub',
                'sub main()\n    name = "john "\nend sub',
                null,
                'source/main.bs',
                false
            );
        });
        it('escapes quotes in string literals', () => {
            testTranspile(`
                sub main()
                    expected += chr(10) + " version=""2.0"""
                end sub
            `);
        });
        it('keeps function parameter types in proper order', () => {
            testTranspile(`
                function CreateTestStatistic(name as string, result = "Success" as string, time = 0 as integer, errorCode = 0 as integer, errorMessage = "" as string) as object
                end function
            `);
        });

        it('transpiles local var assignment operators', () => {
            testTranspile(`
                sub main()
                    count = 0
                    count += 1
                    count -= 1
                    count *= 1
                    count /= 1
                    count \\= 1
                    count <<= 1
                    count >>= 1
                end sub
            `);
        });

        it('transpiles AA property assignment operators', () => {
            testTranspile(`
                sub main()
                    person = {
                        count: 0
                    }
                    person.count += 1
                end sub
            `);
        });

        it('transpiles AA indexed assignment operators', () => {
            testTranspile(`
                sub main()
                    person = {
                        count: 0
                    }
                    person["count"] += 1
                end sub
            `);
        });

        it('relative-referenced namespaced functions get prefixed', () => {
            testTranspile(`
                namespace Vertibrates.Birds
                    function GetAllBirds()
                        return [
                            GetDuck(),
                            GetGoose()
                        ]
                    end function

                    function GetDuck()
                    end function

                    function GetGoose()
                    end function
                end namespace
            `, `
                function Vertibrates_Birds_GetAllBirds()
                    return [
                        Vertibrates_Birds_GetDuck()
                        Vertibrates_Birds_GetGoose()
                    ]
                end function

                function Vertibrates_Birds_GetDuck()
                end function

                function Vertibrates_Birds_GetGoose()
                end function
            `, 'trim', 'source/main.bs');
        });

        it('transpiles namespaced functions', () => {
            testTranspile(`
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub alert()
                    end sub
                end namespace
            `, `
                sub NameA_alert()
                end sub
                sub NameA_NameB_alert()
                end sub
            `, 'trim', 'source/main.bs');
        });

        it('transpiles dim', () => {
            function doTest(code: string) {
                testTranspile(`
                    sub main()
                        requestList = []
                        ${code}
                    end sub
                `, `
                    sub main()
                        requestList = []
                        ${code}
                    end sub
                `);
            }
            doTest(`Dim c[5]`);
            doTest(`Dim c[5, 4]`);
            doTest(`Dim c[5, 4, 6]`);
            doTest(`Dim requestData[requestList.count()]`);
            doTest(`Dim requestData[1, requestList.count()]`);
            doTest(`Dim requestData[1, requestList.count(), 2]`);
            doTest(`Dim requestData[requestList[2]]`);
            doTest(`Dim requestData[1, requestList[2]]`);
            doTest(`Dim requestData[1, requestList[2], 2]`);
            doTest(`Dim requestData[requestList["2"]]`);
            doTest(`Dim requestData[1, requestList["2"]]`);
            doTest(`Dim requestData[1, requestList["2"], 2]`);
            doTest(`Dim requestData[1, StrToI("1"), 2]`);
            testTranspile(`
                function getValue(param1)
                end function

                sub main()
                    requestList = []
                    Dim requestData[1, getValue({
                        key: "value"
                    }), 2]
                end sub
            `);
        });

        it('transpiles calls to fully-qualified namespaced functions', () => {
            testTranspile(`
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub alert()
                    end sub
                end namespace
                sub main()
                    NameA.alert()
                    NameA.NameB.alert()
                end sub
            `, `
                sub NameA_alert()
                end sub
                sub NameA_NameB_alert()
                end sub

                sub main()
                    NameA_alert()
                    NameA_NameB_alert()
                end sub
            `, 'trim', 'source/main.bs');
        });

        it('keeps end-of-line comments with their line', () => {
            testTranspile(`
                function DoSomething() 'comment 1
                    name = "bob" 'comment 2
                end function 'comment 3
            `);
        });

        it('works for functions', () => {
            testTranspile(`
                function DoSomething()
                    'lots of empty white space
                    'that will be removed during transpile



                end function
            `, `
                function DoSomething()
                    'lots of empty white space
                    'that will be removed during transpile
                end function
            `);
        });

        it('keeps empty AAs and arrays on same line', () => {
            testTranspile(`
                sub a()
                    person = {}
                    stuff = []
                end sub
        `, null, 'trim');
        });

        it('does not add leading or trailing newlines', () => {
            testTranspile(`function abc()\nend function`, undefined, 'none');
        });

        it('handles sourcemap edge case', async () => {
            let source =
                'sub main()\n' +
                '\n' +
                '    print 1\n' +
                '\n' +
                'end sub';
            program.options.sourceMap = true;
            let result = testTranspile(source, `sub main()\n    print 1\nend sub`, 'none', 'source/main.bs');
            //load the source map
            let location = await SourceMapConsumer.with(result.map.toJSON(), null, (consumer) => {
                return consumer.generatedPositionFor({
                    line: 3,
                    column: 0,
                    source: s`${rootDir}/source/main.bs`,
                    bias: SourceMapConsumer.LEAST_UPPER_BOUND
                });
            });
            expect(location.line).to.eql(2);
            expect(location.column).eql(4);
        });

        it('computes correct locations for sourcemap', async () => {
            let source = `function abc(name)\n    firstName = name\nend function`;
            let tokens = Lexer.scan(source).tokens
                //remove newlines and EOF
                .filter(x => x.kind !== TokenKind.Eof && x.kind !== TokenKind.Newline);

            program.options.sourceMap = true;
            let result = testTranspile(source, source, 'none');
            //load the source map
            await SourceMapConsumer.with(result.map.toString(), null, (consumer) => {
                let tokenResult = tokens.map(token => ({
                    kind: token.kind,
                    start: token.range.start
                }));
                let sourcemapResult = tokens.map(token => {
                    let originalPosition = consumer.originalPositionFor({
                        //convert token 0-based line to source-map 1-based line for the lookup
                        line: token.range.start.line + 1,
                        column: token.range.start.character
                    });
                    return {
                        kind: token.kind,
                        start: Position.create(
                            //convert source-map 1-based line to token 0-based line
                            originalPosition.line - 1,
                            originalPosition.column
                        )
                    };
                });
                expect(sourcemapResult).to.eql(tokenResult);
            });
        });

        it('handles empty if block', () => {
            testTranspile(`
                sub main()
                    if true then
                    end if
                    if true then
                    else
                        print "else"
                    end if
                    if true then
                    else if true then
                        print "else"
                    end if
                    if true then
                    else if true then
                        print "elseif"
                    else
                        print "else"
                    end if
                end sub
            `);
        });

        it('handles empty elseif block', () => {
            testTranspile(`
                sub main()
                    if true then
                        print "if"
                    else if true then
                    end if
                    if true then
                        print "if"
                    else if true then
                    else if true then
                    end if
                end sub
            `);
        });

        it('handles empty else block', () => {
            testTranspile(`
                sub main()
                    if true then
                        print "if"
                    else
                    end if
                    if true then
                        print "if"
                    else if true then
                        print "elseif"
                    else
                    end if
                end sub
            `);
        });

        it('works for function parameters', () => {
            testTranspile(`
                function DoSomething(name, age as integer, text as string)
                end function
            `, `
                function DoSomething(name, age as integer, text as string)
                end function
            `);
        });

        it('adds newlines between top-level statements', () => {
            testTranspile(`
                function a()
                end function

                function b()
                end function
            `);
        });

        it('properly indents nested AA literals', () => {
            testTranspile(`
                sub doSomething()
                    grandparent = {
                        parent: {
                            child: {
                                grandchild: {
                                    name: "baby"
                                }
                            }
                        }
                    }
                end sub
            `);
        });

        it('does not add comma after final object property even when comments are present', () => {
            testTranspile(`
                sub doSomething()
                    person = {
                        age: 12 'comment
                        name: "child"
                    }
                    person = {
                        age: 12 'comment
                        name: "child" 'comment
                    }
                    person = {
                        age: 12 'comment
                        name: "child"
                        'comment
                    }
                    person = {
                        age: 12 'comment
                        name: "child" 'comment
                        'comment
                    }
                end sub
            `);
        });

        it('works for a complex function with comments all over the place', () => {
            testTranspile(`
                'import some library
                library "v30/bslCore.brs" 'comment

                'a function that does something
                function doSomething(age as integer, name = "bob") 'comment
                    person = { 'comment
                        name: "parent" 'comment
                        "age": 12
                        'comment as whole line
                        child: { 'comment
                            name: "child" 'comment
                        }
                    }
                    person.name = "john" 'comment
                    person.child.name = "baby" 'comment
                    person["name"] = person.child["name"] 'comment
                    age = 12 + 2 'comment
                    name = "tim" 'comment
                    age = 12 'comment
                    while true 'comment
                        age = age + 1 'comment
                        exit while 'comment
                    end while 'comment
                    while age < 12 or age < 15 'comment
                        age++ 'comment
                        exit while 'comment
                    end while 'comment
                    if true or 1 = 1 or name = "tim" then 'comment
                        print false 'comment
                    else if false or "cat" = "dog" or true then 'comment
                        print "true" 'comment
                    else 'comment
                        print "else" 'comment
                    end if 'comment
                    someBool = (true or false) or ((true) or (false)) 'comment
                    mylabel: 'comment
                    goto mylabel 'comment
                    age++ 'comment
                    age-- 'comment
                    end 'comment
                    stop 'comment
                    indexes = [ 'comment
                        'comment on its own line
                        1 'comment
                        2 'comment
                        3 'comment
                    ] 'comment
                    firstIndex = indexes[0] 'comment
                    for each idx in indexes 'comment
                        indexes[idx] = idx + 1 'comment
                    end for 'comment
                    if not true then 'comment
                        print "false" 'comment
                    end if 'comment 'comment
                    for i = 0 to 10 step 1 'comment
                        name = "bob" 'comment
                        age = 12 'comment
                        exit for 'comment
                    end for 'comment
                    callback = function(name, age as integer, cb as Function) as integer 'comment
                        returnValue = 12 'comment
                        return returnValue 'comment
                    end function 'comment
                    print "a"; "b"; 3 'comment
                    a(1, 2, 3) 'comment
                    person.functionCall(1, 2, 3) 'comment
                    if true then 'comment
                        level = 1 'comment
                        if false then 'comment
                            level = 2 'comment
                            if true or false then 'comment
                                level = 3 'comment
                                if false and true then 'comment
                                    level = 4 'comment
                                end if 'comment
                            end if 'comment
                        end if 'comment
                    end if 'comment
                end function

                function a(p1, p2, p3) 'comment
                end function 'comment
            `);
        });

        it('simple mapped files include a reference to the source map', () => {
            let file = program.setFile('source/logger.brs', trim`
                sub logInfo()
                end sub
            `);
            file.needsTranspiled = false;
            const { code } = file.transpile();
            expect(code.endsWith(`'//# sourceMappingURL=./logger.brs.map`)).to.be.true;
        });

        it('AST generated files include a reference to the source map', () => {
            let file = program.setFile('source/logger.brs', trim`
                sub logInfo()
                end sub
            `);
            file.needsTranspiled = true;
            const { code } = file.transpile();
            expect(code.endsWith(`'//# sourceMappingURL=./logger.brs.map`)).to.be.true;
        });

        it('replaces custom types in parameter types and return types', () => {
            program.setFile('source/SomeKlass.bs', `
                class SomeKlass
                end class
            `);
            testTranspile(`
                function foo() as SomeKlass
                    return new SomeKlass()
                end function

                sub bar(obj as SomeKlass)
                end sub
            `, `
                function foo() as object
                    return SomeKlass()
                end function

                sub bar(obj as object)
                end sub
            `);
        });

    });

    describe('callfunc operator', () => {
        describe('transpile', () => {
            it('does not produce diagnostics', () => {
                program.setFile('source/main.bs', `
                    sub test()
                        someNode = createObject("roSGNode", "Rectangle")
                        someNode@.someFunction(test.value)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('sets invalid on empty callfunc', () => {
                testTranspile(`
                    sub main()
                        node@.doSomething()
                        m.top.node@.doSomething()
                        m.top.node@.doSomething(1)
                    end sub
                `, `
                    sub main()
                        node.callfunc("doSomething", invalid)
                        m.top.node.callfunc("doSomething", invalid)
                        m.top.node.callfunc("doSomething", 1)
                    end sub
                `);
            });

            it('includes original arguments', () => {
                testTranspile(`
                    sub main()
                        node@.doSomething(1, true, m.top.someVal)
                    end sub
                `, `
                    sub main()
                        node.callfunc("doSomething", 1, true, m.top.someVal)
                    end sub
                `);
            });
        });
    });

    describe('transform callback', () => {
        function parseFileWithCallback(ext: string, onParsed: () => void) {
            const rootDir = process.cwd();
            const program = new Program({
                rootDir: rootDir
            });
            program.plugins.add({
                name: 'transform callback',
                afterFileParse: onParsed
            });
            file = program.setFile({ src: `absolute_path/file${ext}`, dest: `relative_path/file${ext}` }, `
                sub Sum()
                print "hello world"
                end sub
            `);
            expect(file.extension).to.equal(ext);
            return file;
        }

        it('called for BRS file', () => {
            const onParsed = sinon.spy();
            parseFileWithCallback('.brs', onParsed);
            expect(onParsed.callCount).to.equal(1);
        });

        it('called for BS file', () => {
            const onParsed = sinon.spy();
            parseFileWithCallback('.bs', onParsed);
            expect(onParsed.callCount).to.equal(1);
        });
    });

    describe('typedefKey', () => {
        it('works for .brs files', () => {
            expect(
                s((program.setFile<BrsFile>('source/main.brs', '')).typedefSrcPath)
            ).to.equal(
                s`${rootDir.toLowerCase()}/source/main.d.bs`
            );
        });
        it('returns undefined for files that should not have a typedef', () => {
            expect((program.setFile<BrsFile>('source/main.bs', '')).typedefSrcPath).to.be.undefined;

            expect((program.setFile<BrsFile>('source/main.d.bs', '')).typedefSrcPath).to.be.undefined;

            const xmlFile = program.setFile<BrsFile>('components/comp.xml', '');
            expect(xmlFile.typedefSrcPath).to.be.undefined;
        });
    });


    describe('type definitions', () => {
        it('only exposes defined functions even if source has more', () => {
            //parse the .brs file first so it doesn't know about the typedef
            program.setFile<BrsFile>('source/main.brs', `
                sub main()
                end sub
                sub speak()
                end sub
            `);

            program.setFile('source/main.d.bs', `
                sub main()
                end sub
            `);

            const sourceScope = program.getScopeByName('source');
            const functionNames = sourceScope.getAllCallables().map(x => x.callable.name);
            expect(functionNames).to.include('main');
            expect(functionNames).not.to.include('speak');
        });

        it('reacts to typedef file changes', () => {
            let file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                end sub
                sub speak()
                end sub
            `);
            expect(file.hasTypedef).to.be.false;
            expect(file.typedefFile).not.to.exist;

            program.setFile('source/main.d.bs', `
                sub main()
                end sub
            `);
            expect(file.hasTypedef).to.be.true;
            expect(file.typedefFile).to.exist;

            //add replace file, does it still find the typedef
            file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                end sub
                sub speak()
                end sub
            `);
            expect(file.hasTypedef).to.be.true;
            expect(file.typedefFile).to.exist;

            program.removeFile(s`${rootDir}/source/main.d.bs`);

            expect(file.hasTypedef).to.be.false;
            expect(file.typedefFile).not.to.exist;
        });
    });

    describe('typedef', () => {
        it('sets typedef path properly', () => {
            expect((program.setFile<BrsFile>('source/main1.brs', '')).typedefSrcPath).to.equal(s`${rootDir}/source/main1.d.bs`.toLowerCase());
            expect((program.setFile<BrsFile>('source/main2.d.bs', '')).typedefSrcPath).to.equal(undefined);
            expect((program.setFile<BrsFile>('source/main3.bs', '')).typedefSrcPath).to.equal(undefined);
            //works for dest with `.brs` extension
            expect((program.setFile<BrsFile>({ src: 'source/main4.bs', dest: 'source/main4.brs' }, '')).typedefSrcPath).to.equal(undefined);
        });

        it('does not link when missing from program', () => {
            const file = program.setFile<BrsFile>('source/main.brs', ``);
            expect(file.typedefFile).not.to.exist;
        });

        it('links typedef when added BEFORE .brs file', () => {
            const typedef = program.setFile<BrsFile>('source/main.d.bs', ``);
            const file = program.setFile<BrsFile>('source/main.brs', ``);
            expect(file.typedefFile).to.equal(typedef);
        });

        it('links typedef when added AFTER .brs file', () => {
            const file = program.setFile<BrsFile>('source/main.brs', ``);
            const typedef = program.setFile<BrsFile>('source/main.d.bs', ``);
            expect(file.typedefFile).to.eql(typedef);
        });

        it('removes typedef link when typedef is removed', () => {
            const typedef = program.setFile<BrsFile>('source/main.d.bs', ``);
            const file = program.setFile<BrsFile>('source/main.brs', ``);
            program.removeFile(typedef.srcPath);
            expect(file.typedefFile).to.be.undefined;
        });
    });

    describe('getTypedef', () => {
        function testTypedef(original: string, expected: string) {
            let file = program.setFile<BrsFile>('source/main.brs', original);
            expect(file.getTypedef().trimEnd()).to.eql(expected);
        }

        it('includes namespace on extend class names', () => {
            testTypedef(`
                namespace AnimalKingdom
                    class Bird
                    end class
                    class Duck extends Bird
                    end class
                end namespace
            `, trim`
                namespace AnimalKingdom
                    class Bird
                        sub new()
                        end sub
                    end class
                    class Duck extends AnimalKingdom.Bird
                        sub new()
                        end sub
                    end class
                end namespace
            `);
        });

        it('strips function body', () => {
            testTypedef(`
                sub main(param1 as string)
                    print "main"
                end sub
            `, trim`
                sub main(param1 as string)
                end sub
            `);
        });

        it('includes annotations', () => {
            testTypedef(`
                namespace test
                    @an
                    @anFunc("value")
                    function getDuck()
                    end function
                    class Duck
                        @anMember
                        @anMember("field")
                        private thing

                        @anMember
                        @anMember("func")
                        private function foo()
                        end function
                    end class
                end namespace
            `, trim`
                namespace test
                    @an
                    @anFunc("value")
                    function getDuck()
                    end function
                    class Duck
                        sub new()
                        end sub
                        @anMember
                        @anMember("field")
                        private thing as dynamic
                        @anMember
                        @anMember("func")
                        private function foo()
                        end function
                    end class
                end namespace
            `);
        });

        it('includes import statements', () => {
            testTypedef(`
               import "pkg:/source/lib.brs"
            `, trim`
                import "pkg:/source/lib.brs"
            `);
        });

        it('includes namespace statements', () => {
            testTypedef(`
                namespace Name
                    sub logInfo()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub logInfo()
                    end sub
                end namespace
            `, trim`
                namespace Name
                    sub logInfo()
                    end sub
                end namespace
                namespace NameA.NameB
                    sub logInfo()
                    end sub
                end namespace
            `);
        });

        it('includes classes', () => {
            testTypedef(`
                class Person
                    public name as string
                    public age = 12
                    public sub getAge() as integer
                        return m.age
                    end sub
                end class
                namespace NameA.NameB
                    class Person
                        public name as string
                        public age = 12
                        public sub getAge() as integer
                            return m.age
                        end sub
                    end class
                end namespace
            `, trim`
                class Person
                    sub new()
                    end sub
                    public name as string
                    public age as integer
                    public sub getAge() as integer
                    end sub
                end class
                namespace NameA.NameB
                    class Person
                        sub new()
                        end sub
                        public name as string
                        public age as integer
                        public sub getAge() as integer
                        end sub
                    end class
                end namespace
            `);
        });

        it('creates constructor properly', () => {
            testTypedef(`
                class Parent
                end class
            `, trim`
                class Parent
                    sub new()
                    end sub
                end class
            `);
        });

        it('sets properties to dynamic when initialized to invalid', () => {
            testTypedef(`
                class Human
                    public firstName = invalid
                    public lastName as string = invalid
                end class
            `, trim`
                class Human
                    sub new()
                    end sub
                    public firstName as dynamic
                    public lastName as string
                end class
            `);
        });

        it('includes class inheritance', () => {
            testTypedef(`
                class Human
                    sub new(name as string)
                        m.name = name
                    end sub
                end class
                class Person extends Human
                    sub new(name as string)
                        super(name)
                    end sub
                end class
            `, trim`
                class Human
                    sub new(name as string)
                    end sub
                end class
                class Person extends Human
                    sub new(name as string)
                    end sub
                end class
            `);
        });

        it('includes access modifier keyword', () => {
            testTypedef(`
                class Human
                    public firstName as string
                    protected middleName as string
                    private lastName as string
                    public function getFirstName()
                        return m.firstName
                    end function
                    protected function getMiddleName()
                        return m.middleName
                    end function
                    private function getLastName()
                        return m.lastName
                    end function
                end class
            `, trim`
                class Human
                    sub new()
                    end sub
                    public firstName as string
                    protected middleName as string
                    private lastName as string
                    public function getFirstName()
                    end function
                    protected function getMiddleName()
                    end function
                    private function getLastName()
                    end function
                end class
            `);
        });

        it('includes overrides keyword if present in source', () => {
            testTypedef(`
                class Animal
                    public sub speak()
                        print "Hello Animal"
                    end sub
                end class
                class Dog extends Animal
                    public override sub speak()
                        print "Hello Dog"
                    end sub
                end class
            `, trim`
                class Animal
                    sub new()
                    end sub
                    public sub speak()
                    end sub
                end class
                class Dog extends Animal
                    sub new()
                    end sub
                    public override sub speak()
                    end sub
                end class
            `);
        });

        it('includes class inheritance cross-namespace', () => {
            testTypedef(`
                namespace NameA
                    class Human
                        sub new(name as string)
                            m.name = name
                        end sub
                    end class
                end namespace
                namespace NameB
                    class Person extends NameA.Human
                        sub new(name as string)
                            super(name)
                        end sub
                    end class
                end namespace
            `, trim`
                namespace NameA
                    class Human
                        sub new(name as string)
                        end sub
                    end class
                end namespace
                namespace NameB
                    class Person extends NameA.Human
                        sub new(name as string)
                        end sub
                    end class
                end namespace
            `);
        });
    });

    describe('parser getter', () => {
        it('recreates the parser when missing', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                end sub
            `);
            const parser = file['_parser'];
            //clear the private _parser instance
            file['_parser'] = undefined;

            //force the file to get a new instance of parser
            const newParser = file.parser;

            expect(newParser).to.exist.and.to.not.equal(parser);

            //reference shouldn't change in subsequent accesses
            expect(file.parser).to.equal(newParser);
        });

        it('call parse when previously skipped', () => {
            program.setFile<BrsFile>('source/main.d.bs', `'typedef
                sub main()
                end sub
            `);
            const file = program.setFile<BrsFile>('source/main.brs', `'source
                sub main()
                end sub
            `);
            //no functions should be found since the parser was skipped
            expect(file['_parser']).to.not.exist;

            const stub = sinon.stub(file, 'parse').callThrough();

            //`file.parser` is a getter, so that should force the parse to occur
            expect(file.parser.references.functionStatements).to.be.lengthOf(1);
            expect(stub.called).to.be.true;
            //parse should have been called
        });
    });

    describe('Plugins', () => {
        let pluginFileName: string;
        let idx = 1;
        beforeEach(() => {
            pluginFileName = `plugin-${idx++}.js`;
            fsExtra.outputFileSync(s`${tempDir}/plugins/${pluginFileName}`, `
                function plugin() {
                    return {
                        name: 'lower-file-name',
                        afterFileParse: (evt) => {
                            evt.file._customProp = true;
                        }
                    };
                }
                exports.default = plugin;
            `);
        });

        it('can load an absolute plugin which receives callbacks', () => {
            program.plugins = new PluginInterface(
                util.loadPlugins(tempDir, [
                    s`${tempDir}/plugins/${pluginFileName}`
                ]),
                new Logger()
            );
            const file = program.setFile<any>('source/MAIN.brs', '');
            expect(file._customProp).to.exist;
        });

        it('can load a relative plugin which receives callbacks', () => {
            program.plugins = new PluginInterface(
                util.loadPlugins(tempDir, [
                    `./plugins/${pluginFileName}`
                ]),
                new Logger()
            );
            const file = program.setFile<any>('source/MAIN.brs', '');
            expect(file._customProp).to.exist;
        });
    });

    describe('getSymbolTypeFromToken', () => {

        interface SymbolLookup {
            line: number;
            col: number;
            name: string;
            type: BscType;
        }

        function checkSymbolLookups(file: BrsFile, funcExpr: FunctionExpression, lookups: SymbolLookup[]) {
            const mainScope = program.getScopesForFile(file)[0];
            mainScope.linkSymbolTable();
            for (const lookup of lookups) {
                const position = Position.create(lookup.line, lookup.col);
                const token = file.parser.getTokenAt(position);
                const symbol = file.getSymbolTypeFromToken(token, funcExpr, mainScope);
                const context = {
                    file: file,
                    scope: mainScope,
                    position: position
                };
                expect(symbol.expandedTokenText).to.equal(lookup.name);
                expect(symbol.type.equals(lookup.type, context)).be.true;
            }
        }

        it('gets simple types based on the containing function expression', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub doSomething(aInt as integer, aFloat as float, aStr as string, aBool as boolean, aObj as object)
                    print aInt
                    print aFloat
                    print aStr
                    print aBool
                    print aObj
                end sub
            `);
            const funcExpr = file.parser.references.functionExpressions[0];
            const lookups = [
                { line: 2, col: 28, name: 'aInt', type: new IntegerType() },
                { line: 3, col: 28, name: 'aFloat', type: new FloatType() },
                { line: 4, col: 28, name: 'aStr', type: new StringType() },
                { line: 5, col: 28, name: 'aBool', type: new BooleanType() },
                { line: 6, col: 28, name: 'aObj', type: new ObjectType() }
            ];
            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });

        it('gets custom types based on the containing function expression', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub doSomething(klass as MyKlass)
                    print klass
                end sub

                class MyKlass
                end class
            `);
            const mainScope = program.getScopesForFile(file)[0];
            mainScope.linkSymbolTable();
            const funcExpr = file.parser.references.functionExpressions[0];
            const token = file.parser.getTokenAt(Position.create(2, 28));
            const symbol = file.getSymbolTypeFromToken(token, funcExpr, mainScope);
            expect(symbol.expandedTokenText).to.equal('klass');
            const classStmt = file.parser.references.classStatements[0];
            expect(classStmt.name.text).to.equal('MyKlass');
            expect(symbol.type.isAssignableTo(classStmt.getThisBscType())).be.true;
            expectZeroDiagnostics(program);
        });

        it('gets types of properties of a klass', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub doSomething()
                    klass = new MyKlass()
                    print klass.name
                    print klass.age
                    ' verify case insensitivity
                    print KLASS.NAME
                    print klass.AGE
                end sub

                class MyKlass
                    name as string
                    age as integer
                end class
            `);
            const funcExpr = file.parser.references.functionExpressions[0];
            const lookups = [
                { line: 3, col: 35, name: 'MyKlass.name', type: new StringType() },
                { line: 4, col: 35, name: 'MyKlass.age', type: new IntegerType() }
            ];
            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });

        it('gets types of properties of an object', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub doSomething()
                    obj = { name: "Joe", age: 37}
                    print obj.name
                    print obj.age
                end sub
            `);
            const funcExpr = file.parser.references.functionExpressions[0];
            const lookups = [
                { line: 3, col: 32, name: 'obj.name', type: new StringType() },
                { line: 4, col: 32, name: 'obj.age', type: new IntegerType() }
            ];
            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });

        it('gets return types of functions', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub doSomething()
                    pi = makeKlass().getSelf().getPi()
                    print pi
                end sub

                function makeKlass() as MyKlass
                    return new MyKlass()
                end function

                class MyKlass
                    function getPi() as float
                        return 3.14
                    end function

                    function getSelf() as MyKlass
                        return m
                    end function
                end class
            `);
            const mainScope = program.getScopesForFile(file)[0];
            mainScope.linkSymbolTable();
            const funcExpr = file.parser.references.functionExpressions[0];
            const klassMemberTable = file.parser.references.classStatements[0].memberTable;
            const lookups = [
                { line: 2, col: 31, name: 'makeKlass', type: file.parser.references.functionExpressions[1].getFunctionType() },
                // The expanded text for this should probably be MyKlass.getSelf()
                { line: 2, col: 41, name: 'MyKlass.MyKlass', type: klassMemberTable.getSymbol('getSelf')[0].type },
                { line: 2, col: 51, name: 'MyKlass.getPi', type: klassMemberTable.getSymbol('getPi')[0].type },
                { line: 3, col: 28, name: 'pi', type: new FloatType() }
            ];

            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });


        it('gets types of elements of arrays', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub doSomething(words as string[], klasses as MyKlass[])
                    myWord = words[0]
                    pi = klasses[0].getPi()
                    print myWord
                    print pi
                end sub

                class MyKlass
                    function getPi() as float
                        return 3.14
                    end function
                end class
            `);
            const mainScope = program.getScopesForFile(file)[0];
            mainScope.linkSymbolTable();
            const funcExpr = file.parser.references.functionExpressions[0];
            const klassMemberTable = file.parser.references.classStatements[0].memberTable;
            const lookups = [
                { line: 2, col: 34, name: 'words', type: new ArrayType(new StringType()) },
                { line: 3, col: 41, name: 'MyKlass.getPi', type: klassMemberTable.getSymbol('getPi')[0].type },
                { line: 4, col: 28, name: 'myWord', type: new StringType() },
                { line: 5, col: 28, name: 'pi', type: new FloatType() }
            ];

            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });

        it('gets types of elements of arrays via square bracket reference', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                function printFirst(numbers as float[]) as float
                    firstFloat = numbers[0]
                    print firstFloat
                    return firstFloat
                end function
            `);
            const mainScope = program.getScopesForFile(file)[0];
            mainScope.linkSymbolTable();
            const funcExpr = file.parser.references.functionExpressions[0];
            const lookups = [
                { line: 2, col: 26, name: 'firstFloat', type: new FloatType() },
                { line: 3, col: 32, name: 'firstFloat', type: new FloatType() }
            ];

            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });

        it('gets types of elements of arrays after for each', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                function printAllReturnFirst(numbers as float[]) as float
                    for each num in numbers
                        print num
                    end for

                    firstFloat = numbers[0]
                    print firstFloat
                    return firstFloat
                end function
            `);
            const mainScope = program.getScopesForFile(file)[0];
            mainScope.linkSymbolTable();
            const funcExpr = file.parser.references.functionExpressions[0];
            const lookups = [
                { line: 6, col: 26, name: 'firstFloat', type: new FloatType() },
                { line: 7, col: 32, name: 'firstFloat', type: new FloatType() }
            ];

            checkSymbolLookups(file, funcExpr, lookups);
            expectZeroDiagnostics(program);
        });
    });

    it('defaults to `dynamic` type for a complex expression', () => {
        const file = program.setFile<BrsFile>('source/main.brs', `
            sub main()
                name = "cat"
                thing = m["key"](true)
            end sub
        `);
        program.validate();
        const symbolTable = file.parser.references.functionExpressions[0].symbolTable;
        //sanity check
        expect(symbolTable.getSymbolType('name')).be.instanceof(StringType);

        //this complex expression should resolve to dynamic type when not known
        expect(symbolTable.getSymbolType('thing')).be.instanceof(DynamicType);
    });

    describe('getDefinition', () => {
        it('returns const locations', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    print alpha.beta.charlie
                end sub
                namespace alpha.beta
                    const CHARLIE = true
                end namespace
            `);
            //print alpha.beta.char|lie
            expect(program.getDefinition(file.srcPath, Position.create(2, 41))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(5, 26, 5, 33)
            }]);
        });
    });
});
