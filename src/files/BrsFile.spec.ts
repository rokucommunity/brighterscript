import { assert, expect } from '../chai-config.spec';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import type { BsDiagnostic, Callable, CommentFlag, VariableDeclaration } from '../interfaces';
import { Program } from '../Program';
import { DynamicType } from '../types/DynamicType';
import { TypedFunctionType } from '../types/TypedFunctionType';
import { IntegerType } from '../types/IntegerType';
import { StringType } from '../types/StringType';
import { BrsFile } from './BrsFile';
import { SourceMapConsumer } from 'source-map';
import { Lexer } from '../lexer/Lexer';
import { TokenKind } from '../lexer/TokenKind';
import { DiagnosticMessages } from '../DiagnosticMessages';
import util, { standardizePath as s } from '../util';
import { expectDiagnostics, expectHasDiagnostics, expectTypeToBe, expectZeroDiagnostics, getTestGetTypedef, getTestTranspile, trim, trimMap } from '../testHelpers.spec';
import { ParseMode, Parser } from '../parser/Parser';
import { ImportStatement } from '../parser/Statement';
import { createToken } from '../astUtils/creators';
import * as fsExtra from 'fs-extra';
import { URI } from 'vscode-uri';
import undent from 'undent';
import { tempDir, rootDir } from '../testHelpers.spec';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { ClassType, EnumType, FloatType, InterfaceType } from '../types';
import type { StandardizedFileEntry } from 'roku-deploy';
import * as fileUrl from 'file-url';
import { isAALiteralExpression } from '../astUtils/reflection';
import type { AALiteralExpression } from '../parser/Expression';

let sinon = sinonImport.createSandbox();

describe('BrsFile', () => {
    let program: Program;
    let srcPath = s`${rootDir}/source/main.brs`;
    let destPath = 'source/main.brs';
    let file: BrsFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);
    let testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    function validateFile(...files: BrsFile[]) {
        for (const file of files) {
            program.plugins.emit('onFileValidate', { program: program, file: file });
        }
        for (const file of files) {
            program.plugins.emit('afterFileValidate', { program: program, file: file });
        }

    }


    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, sourceMap: true });
        file = new BrsFile({
            srcPath: srcPath,
            destPath: destPath,
            program: program
        });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('constructor', () => {
        it('calculates correct paths when no pkgPath specified', () => {
            expect(
                new BrsFile({
                    srcPath: s`${rootDir}/source/main.bs`,
                    destPath: s`source/main.bs`,
                    program: program
                })
            ).to.include({
                srcPath: s`${rootDir}/source/main.bs`,
                destPath: s`source/main.bs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('uses supplied pkgPath', () => {
            expect(
                new BrsFile({
                    srcPath: s`${rootDir}/source/main.bs`,
                    destPath: s`source/main.bs`,
                    pkgPath: s`source/main.transpiled.brs`,
                    program: program
                })
            ).to.include({
                srcPath: s`${rootDir}/source/main.bs`,
                destPath: s`source/main.bs`,
                pkgPath: s`source/main.transpiled.brs`
            });
        });
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

    it('flags namespaces used as variables', () => {
        program.setFile('source/main.bs', `
            sub main()
                alpha.beta.charlie.test()
                print alpha
                print alpha.beta
                print alpha.beta.charlie
            end sub

            namespace alpha
                namespace beta
                    namespace charlie
                        sub test()
                        end sub
                    end namespace
                end namespace
            end namespace
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
            range: util.createRange(3, 22, 3, 27)
        }, {
            ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
            range: util.createRange(4, 22, 4, 32)
        }, {
            ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
            range: util.createRange(5, 22, 5, 40)
        }]);
    });

    it('allows namespaces with the name `optional`', () => {
        program.setFile('source/main.bs', `
            namespace optional
                namespace optional
                end namespace
            end namespace
            namespace alpha
                namespace optional
                end namespace
            end namespace
            namespace alpha.beta.optional
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags enums used as variables', () => {
        program.setFile('source/main.bs', `
            enum Foo
                bar
                baz
            end enum

            sub main()
                print getFooValue()
                print getFoo()
            end sub

            function getFoo() as Foo
                return Foo ' Error - cannot return an enum, just an enum value
            end function

            function getFooValue() as Foo
                return Foo.bar
            end function
        `);
        program.validate();
        expectDiagnostics(program, [DiagnosticMessages.itemCannotBeUsedAsVariable('enum').message]);
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
        expect(new BrsFile({
            srcPath: `${rootDir}/source/main.brs`,
            destPath: 'source/main.brs',
            program: program
        })['needsTranspiled']).to.be.false;
        //BrighterScript
        expect(new BrsFile({
            srcPath: `${rootDir}/source/main.bs`,
            destPath: 'source/main.bs',
            program: program
        })['needsTranspiled']).to.be.true;
    });

    it('computes new import statements after clearing parser references', () => {
        const file = program.setFile<BrsFile>('source/main.bs', ``);
        expect(file.ownScriptImports).to.be.empty;
        file.parser.ast.statements.push(
            new ImportStatement({
                import: createToken(TokenKind.Import),
                path: createToken(TokenKind.StringLiteral, 'pkg:/source/lib.brs')
            })
        );
        expect(file.ownScriptImports).to.be.empty;
        file['_cachedLookups'].invalidate();
        expect(file.ownScriptImports.map(x => x.text)).to.eql(['pkg:/source/lib.brs']);
    });

    it('allows adding diagnostics', () => {
        const expected: BsDiagnostic[] = [{
            message: 'message',
            file: undefined as any,
            range: undefined as any
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

    describe('canBePruned', () => {
        it('returns false is target file has contains a function statement', () => {
            program.setFile('source/main.brs', `
                sub main()
                    print \`pkg:\`
                end sub
            `);
            const file = program.getFile('source/main.brs');
            expect(file.canBePruned).to.be.false;
        });

        it('returns false if target file contains a class statement', () => {
            program.setFile('source/main.brs', `
                class Animal
                    public name as string
                end class
            `);
            const file = program.getFile('source/main.brs');
            expect(file.canBePruned).to.be.false;
        });

        it('returns false if target file contains a class statement', () => {
            program.setFile('source/main.brs', `
                namespace Vertibrates.Birds
                    function GetDucks()
                    end function
                end namespace
            `);
            const file = program.getFile('source/main.brs');
            expect(file.canBePruned).to.be.false;
        });

        it('returns true if target file contains only enum', () => {
            program.setFile('source/main.brs', `
                enum Direction
                    up
                    down
                    left
                    right
                end enum
            `);
            const file = program.getFile('source/main.brs');
            expect(file.canBePruned).to.be.true;
        });

        it('returns true if target file is empty', () => {
            program.setFile('source/main.brs', '');
            const file = program.getFile('source/main.brs');
            expect(file.canBePruned).to.be.true;
        });

        it('returns true if target file only has comments', () => {
            program.setFile('source/main.brs', `
                ' this is an interesting comment
            `);
            const file = program.getFile('source/main.brs');
            expect(file.canBePruned).to.be.true;
        });
    });

    describe('getScopesForFile', () => {
        it('finds the scope for the file', () => {
            let file = program.setFile('source/main.brs', ``);
            expect(program.getScopesForFile(file)[0]?.name).to.equal('source');
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
                let file = program.setFile<BrsFile>({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
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
                file.diagnostics.push({
                    code: 'LINT1005',
                    file: file,
                    message: 'Something is not right',
                    range: util.createRange(2, 16, 2, 26)
                });
                const scope = program.getScopesForFile(file)[0];
                expectZeroDiagnostics(scope);
            });

            it('adds diagnostics for unknown numeric diagnostic codes', () => {
                program.setFile('source/main.brs', `
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
                let file = program.setFile<BrsFile>({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
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
                program.setFile('source/main.brs', `
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
                program.setFile('source/main.brs', `
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
            let file = program.setFile('source/main.brs', `
                sub Main()
                    'multiple goto statements on one line
                    goto myLabel : goto myLabel
                    myLabel:
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports empty print statements', () => {
            let file = program.setFile('source/main.brs', `
                sub main()
                   print
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        describe('conditional compile', () => {
            it('supports whitespace-separated directives', async () => {
                const file = program.setFile<BrsFile>('source/main.bs', `
                    sub main()
                        #\t const thing=true
                        #\t if thing
                            print "if"
                        #\t elseif false
                            print "elseif"
                            #\t error crash
                        #\t else
                            print "else"
                        #\t endif
                    end sub
                `);
                expectZeroDiagnostics(program);
                await testTranspile(file.fileContents, `
                    sub main()
                        print "if"
                    end sub
                `);
            });

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
                let file = program.setFile('source/main.brs', `
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
                let file = program.setFile('source/main.brs', `
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
                let file = program.setFile('source/main.brs', `
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
                let file = program.setFile('source/main.brs', `
                    sub main()
                        #if false
                            non-commented code here should not cause parse errors
                        #end if
                    end sub
                `);
                expectZeroDiagnostics(file);
            });

            it('detects syntax error in #if', () => {
                let file = program.setFile('source/main.brs', `
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
                let file = program.setFile('source/main.brs', `
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
                let file = program.setFile('source/main.brs', `
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
                let file = program.setFile('source/main.brs', `
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
            let file = program.setFile('source/main.brs', `
                sub main()
                   stop
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('supports single-line if statements', () => {
            let file = program.setFile('source/main.brs', `
                sub main()
                    if 1 < 2: return true: end if
                    if 1 < 2: return true
                    end if
                    if false : print "true" : end if
                    if true: print "8 worked": else if true: print "not run": else: print "not run": end if
                    if true then : test = sub() : print "yes" : end sub : end if
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
                    print 12D-12
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

        it('does not lose function scopes when mismatched end sub', () => {
            file.parse(`
                sub main()
                    sayHi()
                end function

                sub sayHi()
                    print "hello world"
                end sub
            `);
            expect(file.functionScopes).to.be.lengthOf(2);
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
            expect(file.functionScopes).to.be.lengthOf(2);
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
                    else    if true then
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
                        stop: function() as void

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
                        run: function() as void

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
                    doWork = function(callback as function)
                        callback()
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
                    obj = {x:0 : y: 1}
                end sub
            `);
            expectZeroDiagnostics(file);
        });

        it('succeeds when finding variables with "sub" in them', () => {
            let file = program.setFile<BrsFile>('source/main.brs', `
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
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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
            expect(file.callables[1].nameRange).to.eql(Range.create(5, 26, 5, 29));
        });

        it('throws an error if the file has already been parsed', () => {
            let file = new BrsFile({
                srcPath: 'abspath',
                destPath: 'relpath',
                program: program
            });
            file.parse(`'a comment`);
            try {
                file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('finds and registers duplicate callables', () => {
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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
            expect(file.callables[0].nameRange!.start.line).to.equal(1);

            expect(file.callables[1].name).to.equal('DoA');
            expect(file.callables[1].nameRange!.start.line).to.equal(5);
        });

        it('finds function calls that are unfinished', () => {
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
            file.parse(`
                function DoA()
                    DoB("a"
                end function
                function DoB(a as string)
                    DoC(
                end function
            `);
            expectDiagnostics(file.parser.diagnostics, [
                DiagnosticMessages.expectedRightParenAfterFunctionCallArguments(),
                DiagnosticMessages.expectedNewlineOrColon(),
                DiagnosticMessages.unexpectedToken('end function'),
                DiagnosticMessages.expectedRightParenAfterFunctionCallArguments(),
                DiagnosticMessages.expectedNewlineOrColon()
            ]);
        });

        it('sanitizes brs errors', () => {
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
            file.parse(`
                function DoSomething
                end function
            `);
            expectHasDiagnostics(file);
            expect(file.getDiagnostics()[0].file).to.equal(file);
            expect(file.getDiagnostics()[0].range.start.line).to.equal(1);
        });

        it('supports using the `next` keyword in a for loop', () => {
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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

        it('supports parameter types in functions in AA literals', () => {
            program.setFile('source/main.brs', `
                sub main()
                    aa = {
                        name: "test"
                        addInts: function(a as integer, b as integer) as integer
                            return a + b
                        end function
                    }
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('findCallables', () => {
        it('finds range', () => {
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
            file.parse(`
                sub Sum()
                    print "hello world"
                end sub
            `);
            let callable = file.callables[0];
            expect(callable.range).to.eql(Range.create(1, 16, 3, 23));
        });

        it('finds correct body range even with inner function', () => {
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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
            let file = new BrsFile({
                srcPath: 'absolute_path/file.brs',
                destPath: 'relative_path/file.brs',
                program: program
            });
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

    describe('findCallables', () => {
        //this test is to help with code coverage
        it('skips top-level statements', () => {
            let file = new BrsFile({
                srcPath: 'absolute',
                destPath: 'relative',
                program: program
            });
            file.parse('name = "Bob"');
            expect(file.callables.length).to.equal(0);
        });

        it('finds return type', () => {
            let file = program.setFile<BrsFile>('source/main.brs', `
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

    describe('createFunctionScopes', () => {
        it('creates range properly', () => {
            file.parse(`
                sub Main()
                    name = 'bob"
                end sub
            `);
            expect(file.functionScopes[0].range).to.eql(Range.create(1, 16, 3, 23));
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
            expect(file.functionScopes).to.length(3);
        });

        it('outer function does not capture inner statements', () => {
            file.parse(`
                sub Main()
                    name = "john"
                    sayHi = sub()
                        age = 12
                    end sub
                end sub
            `);
            let outerScope = file.getFunctionScopeAtPosition(Position.create(2, 25));
            expect(outerScope.variableDeclarations).to.be.lengthOf(2);

            let innerScope = file.getFunctionScopeAtPosition(Position.create(4, 10));
            expect(innerScope.variableDeclarations).to.be.lengthOf(1);
        });

        it('finds variables declared in function scopes', () => {
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
            expect(file.functionScopes[0].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[0].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 2,
                name: 'sayHi'
            });
            expect(file.functionScopes[0].variableDeclarations[0].getType()).instanceof(TypedFunctionType);

            expect(file.functionScopes[1].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[1].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 3,
                name: 'age'
            });
            expect(file.functionScopes[1].variableDeclarations[0].getType()).instanceof(IntegerType);

            expect(file.functionScopes[2].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[2].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 7,
                name: 'name'
            });
            expect(file.functionScopes[2].variableDeclarations[0].getType()).instanceof(StringType);
        });

        it('finds variable declarations inside of if statements', () => {
            file.parse(`
                sub Main()
                    if true then
                        theLength = 1
                    end if
                end sub
            `);
            let scope = file.getFunctionScopeAtPosition(Position.create(3, 0));
            expect(scope.variableDeclarations[0]).to.exist;
            expect(scope.variableDeclarations[0].name).to.equal('theLength');
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
            // Types are only guaranteed after validation
            program.validate();
            expectZeroDiagnostics(program);

            expect(file.functionScopes[0].variableDeclarations).to.be.length(1);
            expect(file.functionScopes[0].variableDeclarations[0]).to.deep.include(<VariableDeclaration>{
                lineIndex: 2,
                name: 'myName'
            });
            expectTypeToBe(file.functionScopes[0].variableDeclarations[0].getType(), StringType);
        });

        it('finds variable type from other variable', () => {
            let file = program.setFile<BrsFile>('source/main.brs', `
                sub Main()
                   name = "bob"
                   nameCopy = name
                end sub
            `);
            // Types are only guaranteed after validation
            program.validate();

            expect(file.functionScopes[0].variableDeclarations).to.be.length(2);
            expect(file.functionScopes[0].variableDeclarations[1]).to.deep.include(<VariableDeclaration>{
                lineIndex: 3,
                name: 'nameCopy'
            });
            expectTypeToBe(file.functionScopes[0].variableDeclarations[1].getType(), StringType);
        });

        it('sets proper range for functions', () => {
            file.parse(`
                sub Main()
                    getName = function()
                        return "bob"
                    end function
                end sub
            `);

            expect(file.functionScopes).to.be.length(2);
            expect(file.functionScopes[0].range).to.eql(Range.create(1, 16, 5, 23));
            expect(file.functionScopes[1].range).to.eql(Range.create(2, 30, 4, 32));
        });
    });

    it('handles mixed case `then` partions of conditionals', () => {
        let mainFile = program.setFile('source/main.brs', `
            sub Main()
                if true then
                    print "works"
                end if
            end sub
        `);

        expectZeroDiagnostics(mainFile);
        mainFile = program.setFile('source/main.brs', `
            sub Main()
                if true Then
                    print "works"
                end if
            end sub
        `);
        expectZeroDiagnostics(mainFile);

        mainFile = program.setFile('source/main.brs', `
            sub Main()
                if true THEN
                    print "works"
                end if
            end sub
        `);
        expectZeroDiagnostics(mainFile);
    });

    it('does not throw when encountering incomplete import statement', () => {
        program.setFile('source/main.brs', `
            import
            sub main()
            end sub
        `);
        program.validate();
        //this test will throw an exception if something went wrong
    });

    describe('transpile', () => {
        it('does not crash when AA is missing closing curly token', async () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    aa = {}
                end sub
            `);
            //delete the ending token `}`
            const aa = file.ast.findChild<AALiteralExpression>(isAALiteralExpression);
            delete (aa.tokens as any).close;

            await testTranspile(file, `
                sub main()
                    aa = {}
                end sub
            `, undefined, undefined, false);
        });

        describe('null tokens', () => {
            it('succeeds when token locations are omitted', () => {
                doTest(`
                    library "something" 'comment before func
                    sub main(arg0, arg1 as string, arg2 = invalid)
                        'comment
                        aa = {
                            'comment
                            one: 1
                            "two": 2
                        }
                        arr = [
                            'comment
                            1
                            'comment
                            2
                        ]
                        val = + m.val
                        print "hello"
                        'comment after print
                        num = 1
                        num++
                        num += 2
                        num = +num
                        test(num)
                        for i = 0 to 10 step 1
                            exit for
                        end for
                        while true
                            exit while
                        end while
                        if true then
                            print 1
                        else if true
                            print 1
                        else
                            print 1
                        end if
                        dim thing[1, 2]
                        label1:
                        goto label1
                        end
                        stop
                        stuff = [
                            1
                            2
                            3
                        ]
                        for each item in stuff
                            print item
                        end for
                        m.thing = 1
                        m.thing += 1
                        m[1] = 1
                        m[1] += 1
                        m[1, 2] = 2
                        try
                            print m.b.c
                        catch e
                            print e
                        end try
                        throw "crash"
                        for i = 0 to 10
                            continue
                        end for
                        print m@name
                        print (1 + 2)
                    end sub

                    sub test(p1)
                        return p1
                    end sub
                `);
            });

            it('works for bs content', () => {
                program.setFile('source/lib.bs', ``);
                doTest(`
                    import "pkg:/source/lib.bs"
                    @annotation()
                    sub test()
                        two = 2
                        print \`1\${two}\${3}\n\`
                        print (1 as integer)
                        print SOURCE_LINE_NUM
                        print FUNCTION_NAME
                        print SOURCE_FUNCTION_NAME
                        print PKG_LOCATION
                        print PKG_PATH
                        print LINE_NUM
                        print new Person()
                        m@.someCallfunc()
                        m@.someCallfunc(1, 2)
                        print tag\`stuff\${LINE_NUM}\${LINE_NUM}\`
                        print 1 = 1 ? 1 : 2
                        print 1 = 1 ? m.one : m.two
                        print 1 ?? 2
                        print m.one ?? m.two
                        print /123/gi
                    end sub
                    function tag(param1, param2)
                    end function
                    const a = 1
                    namespace alpha
                        function beta()
                            throw "An error has occurred"
                        end function
                        function charlie()
                        end function
                    end namespace
                    sub test2()
                        ' alpha.charlie()
                    end sub

                    enum Direction
                        up = "up"
                    end enum

                    class Person
                        name as string
                        sub new()
                            print m.name
                        end sub

                        sub test()
                        end sub
                    end class

                    interface Beta
                        name as string
                    end interface
                `, `
                    'import "pkg:/source/lib.bs"

                    sub test()
                        two = 2
                        print ("1" + bslib_toString(two) + bslib_toString(3) + chr(10))
                        print 1
                        print -1
                        print "test"
                        print "test"
                        print "pkg:/source/main.brs:" + str(LINE_NUM)
                        print "pkg:/source/main.brs"
                        print LINE_NUM
                        print Person()
                        m.callfunc("someCallfunc")
                        m.callfunc("someCallfunc", 1, 2)
                        print tag(["stuff", "", ""], [LINE_NUM, LINE_NUM])
                        print bslib_ternary(1 = 1, 1, 2)
                        print (function(__bsCondition, m)
                                if __bsCondition then
                                    return m.one
                                else
                                    return m.two
                                end if
                            end function)(1 = 1, m)
                        print bslib_coalesce(1, 2)
                        print (function(m)
                                __bsConsequent = m.one
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return m.two
                                end if
                            end function)(m)
                        print CreateObject("roRegex", "123", "gi")
                    end sub

                    function tag(param1, param2)
                    end function

                    function alpha_beta()
                        throw "An error has occurred"
                    end function

                    function alpha_charlie()
                    end function

                    sub test2()
                        ' alpha.charlie()
                    end sub

                    function __Person_builder()
                        instance = {}
                        instance.new = sub()
                            m.name = invalid
                            print m.name
                        end sub
                        instance.test = sub()
                        end sub
                        return instance
                    end function
                    function Person()
                        instance = __Person_builder()
                        instance.new()
                        return instance
                    end function
                `);
            });

            it('handles source literals properly', () => {
                const pathUrl = fileUrl(rootDir);
                let text = `"${pathUrl.substring(0, 4)}" + "${pathUrl.substring(4)}`;
                doTest(`
                    sub test()
                        print SOURCE_FILE_PATH
                        print SOURCE_LOCATION
                    end sub
                `, `
                    sub test()
                        print ${text}/source/main.bs"
                        print ${text}/source/main.bs:-1"
                    end sub
                `);
            });
            function doTest(source: string, expected = source) {
                const file = program.setFile<BrsFile>('source/main.bs', '');
                //override the parser with our locationless parser
                file['_parser'] = Parser.parse(source, { mode: ParseMode.BrighterScript, trackLocations: false });
                program.getScopesForFile(file).forEach(x => x['cache'].clear());
                program.validate();
                expectZeroDiagnostics(program);
                const result = file.transpile();
                expect(
                    trimMap(undent(result.code))
                ).to.eql(
                    undent(expected)
                );
            }
        });

        it('transpilies libpkg:/ paths when encountered', async () => {
            program.setFile('source/lib.bs', `
                import "libpkg:/source/numbers.bs"
            `);
            program.setFile('source/numbers.bs', `
                sub test()
                end sub
            `);
            await testTranspile(`
                <component name="TestButton" extends="Group">
                    <script type="text/brightscript" uri="libpkg:/source/lib.bs"/>
                </component>
            `, `
                <component name="TestButton" extends="Group">
                    <script type="text/brightscript" uri="libpkg:/source/lib.brs" />
                    <script type="text/brightscript" uri="pkg:/source/numbers.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, undefined, 'components/TestButton.xml');
        });

        it('excludes trailing commas in array literals', async () => {
            await testTranspile(`
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

        it('transpiles if statement keywords as provided', async () => {
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
            await testTranspile(code);
            await testTranspile(code.toLowerCase());
            await testTranspile(code.toUpperCase());
        });

        it('does not transpile `then` tokens', async () => {
            await testTranspile(`
                sub main()
                    if true
                        print true
                    else if true
                        print false
                    end if
                end sub
            `);
        });

        it('honors spacing between multi-word tokens', async () => {
            await testTranspile(`
                sub main()
                    if true
                        print true
                    elseif true
                        print false
                    endif
                end sub
            `);
        });

        it('handles when only some of the statements have `then`', async () => {
            await testTranspile(`
                sub main()
                    if true
                    else if true then
                    else if true
                    else if true then
                        if true then
                            return
                        end if
                    end if
                end sub
            `);
        });

        it('retains casing of parameter types', async () => {
            async function test(type: string) {
                await testTranspile(`
                    sub one(a as ${type}, b as ${type.toUpperCase()}, c as ${type.toLowerCase()})
                    end sub
                `);
            }
            await test('Boolean');
            await test('Double');
            await test('Dynamic');
            await test('Float');
            await test('Integer');
            await test('LongInteger');
            await test('Object');
            await test('String');
        });

        it('retains casing of return types', async () => {
            async function test(type: string) {
                await testTranspile(`
                    sub one() as ${type}
                    end sub

                    sub two() as ${type.toLowerCase()}
                    end sub

                    sub three() as ${type.toUpperCase()}
                    end sub
                `);
            }
            await test('Boolean');
            await test('Double');
            await test('Dynamic');
            await test('Float');
            await test('Integer');
            await test('LongInteger');
            await test('Object');
            await test('String');
            await test('Void');
        });

        it('retains casing of literal types', async () => {
            async function test(type: string) {
                await testTranspile(`
                    sub main()
                        thing = ${type}
                        thing = ${type.toLowerCase()}
                        thing = ${type.toUpperCase()}
                    end sub
                `);
            }
            await test('Invalid');
            await test('True');
            await test('False');
        });
        describe('throwStatement', () => {
            it('transpiles properly', async () => {
                await testTranspile(`
                    sub main()
                        try
                            throw "some message"
                        catch e
                        end try
                    end sub
                `);
            });

            it('transpiles empty throw with "User-specified exception"', async () => {
                await testTranspile(`
                    sub main()
                        try
                            throw 'bs:disable-line
                        catch e
                        end try
                    end sub
                `, `
                    sub main()
                        try
                            throw "User-specified exception"
                        'bs:disable-line
                        catch e
                        end try
                    end sub
                `);
            });
        });

        describe('try/catch', () => {
            it('transpiles properly', async () => {
                await testTranspile(`
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
            it('properly transpiles namespace functions for assignments', async () => {
                await testTranspile(`
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

            it('properly transpiles inferred namespace function for assignment', async () => {
                await testTranspile(`
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
        it('includes all text to end of line for a non-terminated string', async () => {
            await testTranspile(
                'sub main()\n    name = "john \nend sub',
                'sub main()\n    name = "john "\nend sub',
                null as any,
                'source/main.bs',
                false
            );
        });
        it('escapes quotes in string literals', async () => {
            await testTranspile(`
                sub main()
                    expected = "Hello"
                    expected += chr(10) + " version=""2.0"""
                end sub
            `);
        });
        it('keeps function parameter types in proper order', async () => {
            await testTranspile(`
                function CreateTestStatistic(name as string, result = "Success" as string, time = 0 as integer, errorCode = 0 as integer, errorMessage = "" as string) as object
                end function
            `);
        });

        it('discard parameter types when removeParameterTypes is true', async () => {
            program.options.removeParameterTypes = true;
            await testTranspile(`
                sub one(a as integer, b = "" as string, c = invalid as dynamic)
                end sub
            `, `
                sub one(a, b = "", c = invalid)
                end sub
            `);
        });

        it('discard return type when removeParameterTypes is true', async () => {
            program.options.removeParameterTypes = true;
            await testTranspile(`
                function one() as string
                    return ""
                end function
            `, `
                function one()
                    return ""
                end function
            `);
        });

        it('transpiles local var assignment operators', async () => {
            await testTranspile(`
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

        it('transpiles AA property assignment operators', async () => {
            await testTranspile(`
                sub main()
                    person = {
                        count: 0
                    }
                    person.count += 1
                end sub
            `);
        });

        it('transpiles AA indexed assignment operators', async () => {
            await testTranspile(`
                sub main()
                    person = {
                        count: 0
                    }
                    person["count"] += 1
                end sub
            `);
        });

        it('relative-referenced namespaced functions get prefixed', async () => {
            await testTranspile(`
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

        it('transpiles namespaced functions', async () => {
            await testTranspile(`
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

        it('transpiles dim', async () => {
            async function doTest(code: string) {
                await testTranspile(`
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
            await doTest(`Dim c[5]`);
            await doTest(`Dim c[5, 4]`);
            await doTest(`Dim c[5, 4, 6]`);
            await doTest(`Dim requestData[requestList.count()]`);
            await doTest(`Dim requestData[1, requestList.count()]`);
            await doTest(`Dim requestData[1, requestList.count(), 2]`);
            await doTest(`Dim requestData[requestList[2]]`);
            await doTest(`Dim requestData[1, requestList[2]]`);
            await doTest(`Dim requestData[1, requestList[2], 2]`);
            await doTest(`Dim requestData[requestList["2"]]`);
            await doTest(`Dim requestData[1, requestList["2"]]`);
            await doTest(`Dim requestData[1, requestList["2"], 2]`);
            await doTest(`Dim requestData[1, StrToI("1"), 2]`);
            await testTranspile(`
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

        it('handles multi-index multi-dimensional arrays', async () => {
            await testTranspile(`
                sub main()
                    myMultiArray = [[[[[[[[["hello"]]]]]]]]]
                    myMultiArray[0][0][0][0][0][0][0][0][0] = "goodbye"
                    print myMultiArray[0, 0, 0, 0, 0, 0, 0, 0, 0]
                end sub
            `, `
                sub main()
                    myMultiArray = [
                        [
                            [
                                [
                                    [
                                        [
                                            [
                                                [
                                                    [
                                                        "hello"
                                                    ]
                                                ]
                                            ]
                                        ]
                                    ]
                                ]
                            ]
                        ]
                    ]
                    myMultiArray[0][0][0][0][0][0][0][0][0] = "goodbye"
                    print myMultiArray[0, 0, 0, 0, 0, 0, 0, 0, 0]
                end sub
            `);
        });

        it('transpiles calls to fully-qualified namespaced functions', async () => {
            await testTranspile(`
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

        it('keeps end-of-line comments with their line', async () => {
            await testTranspile(`
                function DoSomething() 'comment 1
                    name = "bob" 'comment 2
                end function 'comment 3
            `);
        });

        it('works for functions', async () => {
            await testTranspile(`
                function DoSomething()
                    'lots of empty white space
                    'that will be removed during transpile
                    'since there are newlines below this comment one newline will be preserved



                end function
            `, `
                function DoSomething()
                    'lots of empty white space
                    'that will be removed during transpile
                    'since there are newlines below this comment one newline will be preserved

                end function
            `);
        });

        it('keeps empty AAs and arrays on same line', async () => {
            await testTranspile(`
                sub a()
                    person = {}
                    stuff = []
                end sub
        `, null as any, 'trim');
        });

        it('does not add leading or trailing newlines', async () => {
            await testTranspile(`function abc()\nend function`, undefined, 'none');
        });

        it('generates proper sourcemap comment', () => {
            program.options.sourceMap = true;
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                end sub
            `);
            expect(file.transpile().code).to.eql(undent`
                sub main()
                end sub
                '//# sourceMappingURL=./main.brs.map
            `);
        });

        it('includes sourcemap.name property', () => {
            program.options.sourceMap = true;
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                end sub
            `);
            expect(file.transpile().map.toJSON().file).to.eql('main.brs');
        });

        it('handles sourcemap edge case', async () => {
            let source =
                'sub main()\n' +
                '\n' +
                '    print 1\n' +
                '\n' +
                'end sub';
            program.options.sourceMap = true;
            let result = await testTranspile(source, `sub main()\n    print 1\nend sub`, 'none', 'source/main.bs');
            //load the source map
            let location = await SourceMapConsumer.with(result.map, null, (consumer) => {
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
            let result = await testTranspile(source, source, 'none');
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
                            originalPosition.line! - 1,
                            originalPosition.column!
                        )
                    };
                });
                expect(sourcemapResult).to.eql(tokenResult);
            });
        });

        it('handles empty if block', async () => {
            await testTranspile(`
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

        it('handles empty elseif block', async () => {
            await testTranspile(`
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

        it('handles empty else block', async () => {
            await testTranspile(`
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

        it('handles else block with a leading comment', async () => {
            await testTranspile(`
                sub main()
                    if true then
                        print "if"
                    else
                        ' leading comment
                        print "else"
                    end if
                end sub
            `);
        });

        it('works for function parameters', async () => {
            await testTranspile(`
                function DoSomething(name, age as integer, text as string)
                end function
            `, `
                function DoSomething(name, age as integer, text as string)
                end function
            `);
        });

        it('adds newlines between top-level statements', async () => {
            await testTranspile(`
                function a()
                end function

                function b()
                end function
            `);
        });

        it('properly indents nested AA literals', async () => {
            await testTranspile(`
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

        it('does not add comma after final object property even when comments are present', async () => {
            await testTranspile(`
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

        it('keeps spaces in between comments when a statement ends in a comment ', async () => {
            await testTranspile(`
                sub foo()
                end sub 'comment

                'a function that does something
                sub foo2()
                end sub
            `);
        });


        it('keeps comment in correct place in empty function', async () => {
            await testTranspile(`
                sub noop1()
                end sub

                sub noop2() 'comment in empty function
                end sub
            `);
        });

        it('works for a complex function with comments all over the place', async () => {
            await testTranspile(`
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
            let file = program.setFile<BrsFile>('source/logger.brs', trim`
                sub logInfo()
                end sub
            `);
            file['needsTranspiled'] = false;
            const { code } = file.transpile();
            expect(code.endsWith(`'//# sourceMappingURL=./logger.brs.map`)).to.be.true;
        });

        it('AST generated files include a reference to the source map', () => {
            let file = program.setFile<BrsFile>('source/logger.brs', trim`
                sub logInfo()
                end sub
            `);
            file['needsTranspiled'] = true;
            const { code } = file.transpile();
            expect(code.endsWith(`'//# sourceMappingURL=./logger.brs.map`)).to.be.true;
        });

        it('replaces custom types in parameter types and return types', async () => {
            program.setFile('source/SomeKlass.bs', `
                class SomeKlass
                end class
            `);
            await testTranspile(`
                function foo() as SomeKlass
                    return new SomeKlass()
                end function

                sub bar(obj as SomeKlass)
                end sub
            `, `
                function foo() as dynamic
                    return SomeKlass()
                end function

                sub bar(obj as dynamic)
                end sub
            `);
        });

        it('allows typecasts wrapped in parens', async () => {
            program.setFile('source/SomeKlass.bs', `
                class SomeKlass
                end class
            `);
            await testTranspile(`
                sub foo(obj as SomeKlass)
                    (obj as roAssociativeArray).append({key:"value"})
                    print 3 + (obj as roAssociativeArray).count()
                end sub
            `, `
                sub foo(obj as dynamic)
                    obj.append({
                        key: "value"
                    })
                    print 3 + obj.count()
                end sub
            `);
        });

        it('allows multiple typecasts wrapped in parens', async () => {
            program.setFile('source/SomeKlass.bs', `
                class SomeKlass
                    function value()
                        return 0.123
                    end function
                end class
            `);
            await testTranspile(`
                sub foo(obj)
                    print val( sin( (0.707 + (obj as SomeKlass).value()) as float ).toStr() as string)
                end sub
            `, `
                sub foo(obj)
                    print val(sin((0.707 + obj.value())).toStr())
                end sub
            `);
        });

        it('allows a string of typecasts wrapped in parens', async () => {
            program.setFile('source/SomeKlass.bs', `
                class SomeKlass
                    function data()
                        return {key: "value"}
                    end function
                end class

                interface SomeIFace
                    key
                end interface
            `);
            await testTranspile(`
                sub foo(obj)
                    print (((obj as SomeKlass).data() as SomeIFace).key as string).len() as integer
                end sub
            `, `
                sub foo(obj)
                    print obj.data().key.len()
                end sub
            `);
        });

        describe('alias', () => {
            it('comments out the alias statement', async () => {
                await testTranspile(`
                    alias l = lcase
                `, `
                    'alias l = lcase
                `);
            });

            it('replaces aliased consts', async () => {
                program.setFile('source/types.bs', `
                    const MyConst = 3.14
                `);
                await testTranspile(`
                    import "pkg:/source/types.bs"
                    alias myc = MyConst

                    namespace alpha
                        const MyConst = 100
                        sub someFunc()
                            print myc
                        end sub
                    end namespace
                `, `
                    'import "pkg:/source/types.bs"
                    'alias myc = MyConst


                    sub alpha_someFunc()
                        print 3.14
                    end sub
                `);
            });

            it('replaces aliased function names', async () => {
                program.setFile('source/types.bs', `
                    sub someFunc()
                    end sub
                `);
                await testTranspile(`
                    import "pkg:/source/types.bs"
                    alias sf = someFunc

                    namespace alpha
                        sub someFunc()
                            sf()
                        end sub
                    end namespace
                `, `
                    'import "pkg:/source/types.bs"
                    'alias sf = someFunc
                    sub alpha_someFunc()
                        someFunc()
                    end sub
                `);
            });

            it('replaces aliased consts', async () => {
                program.setFile('source/types.bs', `
                    const PI = 3.14
                `);
                await testTranspile(`
                    import "pkg:/source/types.bs"
                    alias p = PI

                    namespace alpha
                        function pi() as string
                            return "apple"
                        end function

                        sub printPi()
                            print p
                        end sub
                    end namespace
                `, `
                    'import "pkg:/source/types.bs"
                    'alias p = PI
                    function alpha_pi() as string
                        return "apple"
                    end function

                    sub alpha_printPi()
                        print 3.14
                    end sub
                `);
            });

            it('replaces aliased enums', async () => {
                program.setFile('source/types.bs', `
                    enum Direction
                        north = "North"
                        south = "South"
                    end enum
                `);
                await testTranspile(`
                    import "pkg:/source/types.bs"
                    alias dir = Direction
                    alias dirN = Direction.north

                    namespace alpha
                        function Direction() as string
                            return "apple"
                        end function

                        sub printDir()
                            print dir.north
                            print dirN
                        end sub
                    end namespace
                `, `
                    'import "pkg:/source/types.bs"
                    'alias dir = Direction
                    'alias dirN = Direction.north
                    function alpha_Direction() as string
                        return "apple"
                    end function

                    sub alpha_printDir()
                        print "North"
                        print "North"
                    end sub
                `);
            });

            it('can deep alias a namespaced thing', async () => {
                program.setFile('source/types.bs', `
                    namespace alpha.beta.charlie
                        sub foo(text as string)
                            print text
                        end sub

                        const pi = 3.14
                    end namespace
                `);
                await testTranspile(`
                    import "pkg:/source/types.bs"
                    alias abcfoo = alpha.beta.charlie.foo
                    alias abcpi = alpha.beta.charlie.pi

                    namespace SomeNamespace
                        sub foo()
                            abcfoo(abcpi.toStr())
                        end sub
                    end namespace
                `, `
                    'import "pkg:/source/types.bs"
                    'alias abcfoo = alpha_beta_charlie_foo
                    'alias abcpi = alpha_beta_charlie_pi
                    sub SomeNamespace_foo()
                        alpha_beta_charlie_foo(3.14.toStr())
                    end sub
                `);
            });

            it('can alias a namespace', async () => {
                await testTranspile(`
                    alias get2 = get

                    namespace http
                        'Do an HTTP request
                        sub get()
                            print get2.aa()
                            print get2.aa().name
                            print get2.ABC
                            print get2.beta.DEF
                            print get2.beta.AnimalSounds.dog
                            print get2.MY_AA.id
                        end sub
                    end namespace

                    namespace get
                        function aa()
                            return {name: "John doe"}
                        end function

                        const ABC = "ABC"

                        const MY_AA = {id: 0}

                        namespace beta
                            const DEF = "DEF"
                            enum AnimalSounds
                                dog = "bark"
                                cat = "meow"
                            end enum
                        end namespace
                    end namespace
                `, `
                    'alias get2 = get
                    'Do an HTTP request
                    sub http_get()
                        print get_aa()
                        print get_aa().name
                        print "ABC"
                        print "DEF"
                        print "bark"
                        print ({
                            id: 0
                        }).id
                    end sub
                    function get_aa()
                        return {
                            name: "John doe"
                        }
                    end function
                `);
            });
        });
    });

    describe('callfunc operator', () => {
        describe('transpile', () => {
            it('does not produce diagnostics', () => {
                program.setFile('source/main.bs', `
                    sub test()
                        someNode = createObject("roSGNode", "Rectangle")
                        someNode@.someFunction({test: "value"})
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('sets invalid on empty callfunc with legacyCallfuncHandling=true', async () => {
                program.options.legacyCallfuncHandling = true;
                await testTranspile(`
                    sub main()
                        node = invalid
                        node@.doSomething()
                        m.top.node@.doSomething()
                        m.top.node@.doSomething(1)
                    end sub
                `, `
                    sub main()
                        node = invalid
                        node.callfunc("doSomething", invalid)
                        m.top.node.callfunc("doSomething", invalid)
                        m.top.node.callfunc("doSomething", 1)
                    end sub
                `);
            });

            it('empty callfunc allowed by default', async () => {
                await testTranspile(`
                    sub main()
                        node = invalid
                        node@.doSomething()
                        m.top.node@.doSomething()
                        m.top.node@.doSomething(1)
                    end sub
                `, `
                    sub main()
                        node = invalid
                        node.callfunc("doSomething")
                        m.top.node.callfunc("doSomething")
                        m.top.node.callfunc("doSomething", 1)
                    end sub
                `);
            });

            it('includes original arguments', async () => {
                await testTranspile(`
                    sub main()
                        node = invalid
                        node@.doSomething(1, true, m.top.someVal)
                    end sub
                `, `
                    sub main()
                        node = invalid
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
            file = program.setFile(`source/file${ext}`, `
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

        it('called for BR file', () => {
            const onParsed = sinon.spy();
            parseFileWithCallback('.bs', onParsed);
            expect(onParsed.callCount).to.equal(1);
        });
    });

    describe('typedefKey', () => {
        it('works for .brs files', () => {
            expect(
                s((program.setFile<BrsFile>('source/main.brs', '')).typedefKey)
            ).to.equal(
                s`${rootDir.toLowerCase()}/source/main.d.bs`
            );
        });
        it('returns undefined for files that should not have a typedef', () => {
            expect((program.setFile<BrsFile>('source/main.bs', '')).typedefKey).to.be.undefined;

            expect((program.setFile<BrsFile>('source/main.d.bs', '')).typedefKey).to.be.undefined;

            const xmlFile = program.setFile<BrsFile>('components/comp.xml', '');
            expect(xmlFile.typedefKey).to.be.undefined;
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
        it('includes enum and interface types', async () => {
            await testGetTypedef(`
                interface Foo
                    field as string
                end interface

                enum Bar
                    value
                end enum

                function baz(parameter as Foo) as Bar
                    return Bar.value
                end function
            `, `
                interface Foo
                    field as string
                end interface

                enum Bar
                    value
                end enum
                function baz(parameter as Foo) as Bar
                end function
            `);
        });

        it('sets typedef path properly', () => {
            expect((program.setFile<BrsFile>('source/main1.brs', '')).typedefKey).to.equal(s`${rootDir}/source/main1.d.bs`.toLowerCase());
            expect((program.setFile<BrsFile>('source/main2.d.bs', '')).typedefKey).to.equal(undefined);
            expect((program.setFile<BrsFile>('source/main3.bs', '')).typedefKey).to.equal(undefined);
            //works for dest with `.brs` extension
            expect((program.setFile<BrsFile>({ src: 'source/main4.bs', dest: 'source/main4.brs' }, '')).typedefKey).to.equal(undefined);
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
            program.validate();
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
            file['_parser'] = undefined as any;

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
            expect(file.parser.ast).to.exist;
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
                        afterProvideFile: (evt) => {
                            evt.files[0]._customProp = true;
                        }
                    };
                }
                exports.default = plugin;
            `);
        });

        it('can load an absolute plugin which receives callbacks', () => {
            for (const plugin of util.loadPlugins(tempDir, [s`${tempDir}/plugins/${pluginFileName}`])) {
                program.plugins.add(plugin);
            }
            const file = program.setFile<any>('source/MAIN.brs', '');
            expect(file._customProp).to.exist;
        });

        it('can load a relative plugin which receives callbacks', () => {
            for (const plugin of util.loadPlugins(tempDir, [`./plugins/${pluginFileName}`])) {
                program.plugins.add(plugin);
            }
            const file = program.setFile<any>('source/MAIN.brs', '');
            expect(file._customProp).to.exist;
        });
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
            program.validate();
            //print alpha.beta.char|lie
            expect(program.getDefinition(file.srcPath, Position.create(2, 41))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(5, 26, 5, 33)
            }]);
        });

        it('returns enum locations', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    print alpha.beta.people.charlie
                end sub
                namespace alpha.beta
                    enum people
                        charlie = "charles"
                    end enum
                end namespace
            `);
            program.validate();
            //print alpha.beta.char|lie
            expect(program.getDefinition(file.srcPath, Position.create(2, 40))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(5, 25, 5, 31)
            }]);
        });

        it('returns interface location', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test(selectedMovie as Movie)
                    print selectedMovie
                end sub
                interface Movie
                    url as string
                end interface
            `);
            program.validate();
            // sub test(selectedMovie as Mo|vie)
            expect(program.getDefinition(file.srcPath, Position.create(1, 44))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(4, 26, 4, 31)
            }]);
        });

        it('returns namespaced interface location', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test(selectedMovie as interfaces.Movie)
                    print selectedMovie
                end sub
                namespace interfaces
                    interface Movie
                        url as string
                    end interface
                end namespace
            `);
            program.validate();
            //sub test(selectedMovie as interfaces.Mo|vie)
            expect(program.getDefinition(file.srcPath, Position.create(1, 55))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(5, 30, 5, 35)
            }]);
        });

        it('returns class location', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test(selectedMovie as Movie)
                    print selectedMovie
                end sub
                class Movie
                    url as string
                end class
            `);
            program.validate();
            //sub test(selectedMovie as Mo|vie)
            expect(program.getDefinition(file.srcPath, Position.create(1, 44))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(4, 22, 4, 27)
            }]);
        });

        it('returns namespaced class location', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test(selectedMovie as classes.Movie)
                    print selectedMovie
                end sub
                namespace classes
                    class Movie
                        url as string
                    end class
                end namespace
            `);
            program.validate();
            //sub test(selectedMovie as classes.Mo|vie)
            expect(program.getDefinition(file.srcPath, Position.create(1, 52))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(5, 26, 5, 31)
            }]);
        });

        it('does not crash on nulls', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    print alpha.beta
                end sub
            `);
            program.validate();
            sinon.stub(util, 'getAllDottedGetParts').returns(null as any);
            // print alpha.be|ta
            expect(program.getDefinition(file.srcPath, Position.create(2, 34))).to.eql([]);
        });

        it('returns enum member locations', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    print alpha.beta.people.charlie
                end sub
                namespace alpha.beta
                    enum people
                        charlie = "charles"
                    end enum
                end namespace
            `);
            program.validate();
            //print alpha.beta.char|lie
            expect(program.getDefinition(file.srcPath, Position.create(2, 48))).to.eql([{
                uri: URI.file(file.srcPath).toString(),
                range: util.createRange(6, 24, 6, 31)
            }]);
        });
    });

    it('catches mismatched `end` keywords for functions', () => {
        program.setFile('source/main.brs', `
            function speak()
            end sub
            sub walk()
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.mismatchedEndCallableKeyword('function', 'sub'),
            range: util.createRange(2, 12, 2, 19)
        }, {
            ...DiagnosticMessages.mismatchedEndCallableKeyword('sub', 'function'),
            range: util.createRange(4, 12, 4, 24)
        }]);
    });

    describe('requiredSymbols', () => {
        it('should be empty for a simple file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function someFunc() as integer
                    return 1
                end function
            `);
            const validateFileEvent = {
                program: program,
                file: mainFile
            };
            program.plugins.emit('onFileValidate', validateFileEvent);

            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should be empty if the file needs no external symbols', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function someFunc() as integer
                    return 1
                end function

                sub useKlass()
                    k = new Klass()
                    k.addTwo()
                end sub

                class Klass
                    sub addTwo()
                        print someFunc() + someFunc()
                    end sub
                end class
            `);
            const validateFileEvent = {
                program: program,
                file: mainFile
            };
            program.plugins.emit('onFileValidate', validateFileEvent);

            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should not include global callables or types', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function printLower(s as string) as integer
                    print lcase(s.trim())
                end function

                sub setLabelText( label as roSGNodeLabel, text as string)
                    label.text = text
                end sub
            `);
            const validateFileEvent = {
                program: program,
                file: mainFile
            };
            program.plugins.emit('onFileValidate', validateFileEvent);

            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should include unknown param and return types', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function someFunc(arg as OneType) as TwoType
                    return arg.getTwo()
                end function
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(2);
            expect(mainFile.requiredSymbols.map(x => x.typeChain[0].name)).to.have.same.members([
                'TwoType', 'OneType']);
        });

        it('allows built-in types for interface members', () => {
            program.setFile<BrsFile>('source/main.bs', `
                interface MyBase
                    regex as roRegex
                    node as roSGNodeLabel
                    sub outputMatches(textInput as string)
                    function getLabelParent() as roSGNode
                end interface
                `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows extends on interfaces', async () => {
            await testTranspile(`
                interface MyBase
                    url as string
                end interface

                interface MyExtends extends MyBase
                    method as string
                end interface
            `, `
            `);
        });

        it('should include unknown param and return types on class methods', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                class Klass
                    function someFunc(arg as OneType) as TwoType
                        return arg.getTwo()
                    end function
                end class
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(2);
            expect(mainFile.requiredSymbols.map(x => x.typeChain[0].name)).to.have.same.members([
                'TwoType', 'OneType']);
        });

        it('should not include assigned symbols', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                sub someFunc(arg as SomeOtherType)
                    x = arg.member
                    print x+1
                end sub
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(1);
            // x and arg are assigned.. they are not included in the required symbols
            expect(mainFile.requiredSymbols[0].typeChain[0].name).to.equal('SomeOtherType');
        });

        it('should include functions called that are not in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                sub someFunc()
                    x = otherFileFunc1()
                    print x+1
                end sub

                function deepFunctionCall(i as integer)
                    x = 2*i and otherFileFunc2()
                    y = sin(x+fix(78.2)*log(otherFileFunc3()))
                    ' this is a comment otherFileFunc5()
                    return y-otherFileFunc4()
                end function
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(4);
            expect(mainFile.requiredSymbols.map(x => x.typeChain[0].name)).to.have.same.members([
                'otherFileFunc1', 'otherFileFunc2', 'otherFileFunc3', 'otherFileFunc4'
            ]);
        });

        it('should include classes called that are not in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function someFunc(other as OtherKlass) as NS1.Thing
                    x = new AnotherClass()
                    return other.getThing(x)
                end function
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(3);
            const requiredTypeChains = mainFile.requiredSymbols.map(x => x.typeChain.map(tc => tc.name).join('.'));
            expect(requiredTypeChains).to.have.same.members([
                'OtherKlass', 'NS1.Thing', 'AnotherClass'
            ]);
            const requiredSymbolsFlags = mainFile.requiredSymbols.map(x => x.flags);
            expect(requiredSymbolsFlags).to.have.same.members([
                SymbolTypeFlag.typetime, SymbolTypeFlag.typetime, SymbolTypeFlag.runtime
            ]);
        });

        it('should include enums and consts that are not in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                sub someFunc(myEnum as SomeEnum)
                    if myEnum = SomeEnum.value1
                        print 1
                    else if myEnum = SomeEnum.value2
                        print 2
                    else if myEnum = SomeConstValue
                        print 3
                    end if
                end sub
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(4);
            const requiredTypeChains = mainFile.requiredSymbols.map(x => x.typeChain.map(tc => tc.name).join('.'));
            expect(requiredTypeChains).to.have.same.members([
                'SomeEnum', 'SomeEnum.value1', 'SomeEnum.value2', 'SomeConstValue'
            ]);
            const requiredSymbolsFlags = mainFile.requiredSymbols.map(x => x.flags);
            expect(requiredSymbolsFlags).to.have.same.members([
                SymbolTypeFlag.typetime, SymbolTypeFlag.runtime, SymbolTypeFlag.runtime, SymbolTypeFlag.runtime
            ]);
        });

        it('should include types not defined in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                interface Data
                    kind as DataKind
                    getObj as DataObject
                    subData as SubData
                end interface

                class DataObject extends BaseData
                    kind as DataKind
                    function process(dataProcess as DataProcessor) as ProcessedData
                        return dataProcess.work(m)
                    end function
                end class
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(5);
            const requiredTypeChains = mainFile.requiredSymbols.map(x => x.typeChain.map(tc => tc.name).join('.'));
            expect(requiredTypeChains).to.have.same.members([
                'DataKind', 'SubData', 'BaseData', 'DataProcessor', 'ProcessedData'
            ]);
            const requiredSymbolsFlags = mainFile.requiredSymbols.map(x => x.flags);
            expect(requiredSymbolsFlags).to.have.same.members([
                SymbolTypeFlag.typetime, SymbolTypeFlag.typetime, SymbolTypeFlag.typetime, SymbolTypeFlag.typetime, SymbolTypeFlag.typetime
            ]);
        });

        it('includes namespace details', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                namespace Alpha.Beta
                    sub printConstVal()
                        print CONST_VALUE
                    end sub
                end namespace

                namespace Delta
                    namespace Gamma
                        namespace Eta
                            sub doStuff(x as OtherType)
                                x.something()
                            end sub
                        end namespace
                    end namespace
                end namespace
            `);
            validateFile(mainFile);

            expect(mainFile.requiredSymbols.length).to.eq(2);
            const requiredTypeChains = mainFile.requiredSymbols.map(x => x.typeChain.map(tc => tc.name).join('.'));
            expect(requiredTypeChains).to.have.same.members([
                'CONST_VALUE', 'OtherType'
            ]);
            expect(mainFile.requiredSymbols[0].containingNamespaces).to.have.same.members(['Alpha', 'Beta']);
            expect(mainFile.requiredSymbols[1].containingNamespaces).to.have.same.members(['Delta', 'Gamma', 'Eta']);
        });
        it('does not include namespaces that are defined in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                namespace name1
                    const PI = 3.14

                    namespace name2
                        function getPi() as float
                            return name1.PI
                        end function
                    end namespace
                end namespace
            `);
            validateFile(mainFile);
            expect(mainFile.requiredSymbols.length).to.eq(0);
        });


        it('should put types from typecasts as typetime required', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function takesIface(z) as string
                    return (z as MyInterface).name
                end function
            `);
            validateFile(mainFile);
            expect(mainFile.requiredSymbols.length).to.eq(1);
            expect(mainFile.requiredSymbols[0].flags).to.eq(SymbolTypeFlag.typetime);
        });

        it('should not include symbols in same namespace', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                namespace alpha
                    const PI = 3.14
                    function area(r as float) as float
                        return alpha.PI * r * r
                    end function
                end namespace
            `);
            validateFile(mainFile);
            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should not include symbols in same namespace, but different statements', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                namespace alpha
                    function area(r as float) as float
                        return alpha.PI * r * r
                    end function
                end namespace

                namespace alpha
                    const PI = 3.14
                end namespace
            `);
            validateFile(mainFile);
            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should not include symbols in imported file', () => {
            const otherFile: BrsFile = program.setFile('source/other.bs', `
                namespace alpha
                    const PI = 3.14
                end namespace
            `);
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                import "pkg:/source/other.bs"
                namespace alpha
                    function area(r as float) as float
                        return alpha.PI * r * r
                    end function
                end namespace
            `);
            validateFile(otherFile, mainFile);
            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should not include symbols in imported file of imported file', () => {
            const deepFile: BrsFile = program.setFile('source/deep.bs', `
                namespace alpha
                    const SOME_VALUE = 2
                end namespace
            `);
            const otherFile: BrsFile = program.setFile('source/other.bs', `
                import "pkg:/source/deep.bs"
                namespace alpha
                    const PI = 3.14
                end namespace
            `);
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                import "pkg:/source/other.bs"
                namespace alpha
                    function area(r as float) as float
                        return alpha.PI * r * r * alpha.SOME_VALUE
                    end function
                end namespace
            `);
            validateFile(otherFile, mainFile, deepFile);
            expect(mainFile.requiredSymbols.length).to.eq(0);
        });

        it('should not have problems with circular references of imports', () => {
            const deepFile: BrsFile = program.setFile('source/deep.bs', `
                import "pkg:/source/main.bs"
                namespace alpha
                    function getMyValue()
                        return alpha.MY_VALUE
                    end function
                end namespace
            `);
            const otherFile: BrsFile = program.setFile('source/other.bs', `
                import "pkg:/source/deep.bs"
                namespace alpha
                    const PI = 3.14
                end namespace
            `);
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                import "pkg:/source/other.bs"
                namespace alpha
                    function area(r as float) as float
                        return alpha.PI * r * r * alpha.getMyValue()
                    end function
                    const MY_VALUE = 2
                end namespace
            `);
            validateFile(otherFile, mainFile, deepFile);
            expect(mainFile.requiredSymbols.length).to.eq(0);
        });
    });

    describe('providedSymbols', () => {

        it('includes functions defined in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function someFunc() as integer
                    return 1
                end function

                function someFunc2() as float
                    return 2.3
                end function
            `);
            validateFile(mainFile);
            const runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
            expect(runtimeSymbols.size).to.eq(2);
            const someFuncType = runtimeSymbols.get('somefunc').type;
            expectTypeToBe(someFuncType, TypedFunctionType);
            const someFunc2Type = runtimeSymbols.get('somefunc2').type;
            expectTypeToBe(someFunc2Type, TypedFunctionType);
        });

        it('includes functions with unresolved params/return types', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                function someFunc() as OtherFileType
                    return new OtherFileType()
                end function
            `);
            validateFile(mainFile);

            const runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
            expect(runtimeSymbols.size).to.eq(1);
            const someFuncType = runtimeSymbols.get('somefunc').type;
            expectTypeToBe(someFuncType, TypedFunctionType);
            const requiredSymbols = mainFile.requiredSymbols.map(x => x.typeChain[0].name);
            expect(requiredSymbols).to.have.same.members(['OtherFileType', 'OtherFileType']);
            const requiredSymbolTypes = mainFile.requiredSymbols.map(x => x.flags);
            expect(requiredSymbolTypes).to.have.same.members([SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]);
        });

        it('includes classes defined in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                class Klass
                    name as string
                end class

                class Klass2 extends Klass
                    age as integer

                    function getId() as string
                        return m.name + " " + m.age.toStr()
                    end function
                end class

                class Klass3
                    propClass = new Klass2()
                end class
            `);
            validateFile(mainFile);

            const runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
            expect(runtimeSymbols.size).to.eq(3);
            expectTypeToBe(runtimeSymbols.get('klass').type, ClassType);
            expectTypeToBe(runtimeSymbols.get('klass2').type, ClassType);
            expectTypeToBe(runtimeSymbols.get('klass3').type, ClassType);
            const typetimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime);
            expect(typetimeSymbols.size).to.eq(3);
            expectTypeToBe(runtimeSymbols.get('klass').type, ClassType);
            expectTypeToBe(runtimeSymbols.get('klass2').type, ClassType);
            expectTypeToBe(runtimeSymbols.get('klass3').type, ClassType);
        });

        it('includes other types defined in the file', () => {
            const mainFile: BrsFile = program.setFile('source/main.bs', `
                interface MyInterface
                    name as string
                end interface

                enum MyEnum
                    val1
                    val2
                end enum

                namespace MyNamespace
                    const MyConst = 3.14
                end namespace
            `);
            validateFile(mainFile);
            const runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
            expect(runtimeSymbols.size).to.eq(2);
            expectTypeToBe(runtimeSymbols.get('myenum').type, EnumType);
            expectTypeToBe(runtimeSymbols.get('mynamespace.myconst').type, FloatType);
            const typetimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime);
            expect(typetimeSymbols.size).to.eq(2);
            expectTypeToBe(typetimeSymbols.get('myinterface').type, InterfaceType);
            expectTypeToBe(runtimeSymbols.get('myenum').type, EnumType);
        });

        describe('changes', () => {

            it('new symbols are added to the changes set', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    sub someFunc()
                        print 1
                    end sub
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);

                mainFile = program.setFile('source/main.bs', `
                    sub someFunc()
                        print 1
                    end sub

                    sub someFunc2()
                        print 2
                    end sub
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(2);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('somefunc2')).to.be.true;
            });

            it('removed symbols are added to the changes set', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    sub someFunc()
                        print 1
                    end sub

                    sub someFunc2()
                        print 2
                    end sub
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(2);

                mainFile = program.setFile('source/main.bs', `
                    sub someFunc()
                        print 1
                    end sub
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('somefunc2')).to.be.true;
            });

            it('new symbols in a namespace are added to the changes set', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    namespace Alpha
                    end namespace
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(0);

                mainFile = program.setFile('source/main.bs', `
                    namespace Alpha
                        const ABC = "abc"
                    end namespace
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('alpha.abc')).to.be.true;
            });

            it('should be empty if no changes in actual provided symbols', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    sub printSomething()
                        print "Something"
                    end sub

                    namespace alpha.beta
                        const PI = 3.14
                    end namespace
                `);

                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(2);

                mainFile = program.setFile('source/main.bs', `
                    sub printSomething()
                        print "Something Else"
                    end sub

                    namespace alpha.beta
                        const PI = 3.14159
                    end namespace
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(2);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });

            it('should include changes in function signatures', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    function someFunc(x)
                        return x
                    end function
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);

                mainFile = program.setFile('source/main.bs', `
                    function someFunc(x, y)
                        return x+y
                    end function
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('somefunc'));
            });

            it('should include changes in classes', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    class MyKlass
                        name as string
                        function getValue() as float
                            return 3.14
                        end function
                    end class
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);

                mainFile = program.setFile('source/main.bs', `
                    class MyKlass
                        name as string
                        function getValue() as string
                            return "hello"
                        end function
                    end class
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('myklass'));
                let typeTimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.typetime);
                expect(typeTimeChanges.size).to.eq(1);
                expect(typeTimeChanges.has('myklass'));
            });


            it('should include changes in interfaces', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    interface Iface1
                        name as string
                        function doStuff() as float
                    end interface
                `);
                validateFile(mainFile);
                let typetimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime);
                expect(typetimeSymbols.size).to.eq(1);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(0);

                mainFile = program.setFile('source/main.bs', `
                    interface Iface1
                        name as string
                        age as integer
                        function doStuff() as float
                    end interface
                `);
                validateFile(mainFile);
                typetimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime);
                expect(typetimeSymbols.size).to.eq(1);
                let typeTimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.typetime);
                expect(typeTimeChanges.size).to.eq(1);
                expect(typeTimeChanges.has('iface1'));
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });

            it('should not include changes in enum values, if inner type is the same', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    enum MyEnum
                        north = 4
                        east = 3
                        south = 2
                        west = 1
                    end enum
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);

                mainFile = program.setFile('source/main.bs', `
                    enum MyEnum
                        north = 1
                        east = 2
                        south = 3
                        west = 4
                    end enum
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);

                let typetimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.typetime);
                expect(typetimeSymbols.size).to.eq(1);
                let typetimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.typetime);
                expect(typetimeChanges.size).to.eq(0);
            });

            it('should include changes in enum, if different number of members', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    enum Direction
                        north = 1
                        east = 2
                        south = 3
                        west = 4
                    end enum

                    enum Weather
                        rainy
                        sunny
                    end enum

                    enum Colors
                        blue
                        red
                        green
                        purple
                    end enum
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(3);

                mainFile = program.setFile('source/main.bs', `
                    enum Direction ' same
                        north = 1
                        east = 2
                        south = 3
                        west = 4
                    end enum

                    enum Weather 'added member
                        rainy
                        sunny
                        snowy
                    end enum

                    enum Colors 'removed member
                        blue
                        red
                        green
                    end enum
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(3);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(2);
                expect(runtimeChanges.has('weather'));
                expect(runtimeChanges.has('colors'));

            });

            it('should include changes in enum, if different underlying type', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    enum Direction
                        north = 1
                        east = 2
                        south = 3
                        west = 4
                    end enum
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);

                mainFile = program.setFile('source/main.bs', `
                    enum Direction ' now is a string
                        north = "N"
                        east = "E"
                        south = "S"
                        west = "W"
                    end enum
                `);
                program.plugins.emit('onFileValidate', { program: program, file: mainFile });
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('direction'));
            });

            it('should include changes in const, if different underlying type', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    namespace alpha.beta
                        const PI = 3.14
                    end namespace
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);

                mainFile = program.setFile('source/main.bs', `
                    namespace alpha.beta
                        const PI = "lemon chiffon"
                    end namespace
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(1);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(1);
                expect(runtimeChanges.has('alpha.beta.pi'));
            });

            it('should not include changes inside a function if the param types are known', () => {
                let mainFile: BrsFile = program.setFile('source/main.bs', `
                    function func1(p as string) as integer
                        return len(p)
                    end function

                    sub displayModelTypeInLabel(myLabel as roSgNodeLabel)
                        print myLabel.text
                        di = createObject("roDeviceInfo")' as roDeviceInfo
                        myLabel.text = di.GetFriendlyName()
                        print myLabel.getChildren(0, -1)
                    end sub
                `);
                validateFile(mainFile);
                let runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(2);

                mainFile = program.setFile('source/main.bs', `
                    function func1(p as string) as integer
                        return len(p) + 1
                    end function

                    sub displayModelTypeInLabel(myLabel as roSgNodeLabel)
                        print myLabel.text
                        di = createObject("roDeviceInfo") as roDeviceInfo
                        myLabel.text = di.GetFriendlyName()
                        print myLabel.getChildren(0, -1)
                    end sub
                `);
                validateFile(mainFile);
                runtimeSymbols = mainFile.providedSymbols.symbolMap.get(SymbolTypeFlag.runtime);
                expect(runtimeSymbols.size).to.eq(2);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });

            it('classes that override AA built-in methods show change properly', () => {
                const classFileContent = `
                    class AAOverRide
                        sub count(num as integer) as void
                            print num
                        end sub
                    end class
                `;

                let mainFile: BrsFile = program.setFile<BrsFile>('source/class.bs', classFileContent);
                validateFile(mainFile);
                // No changes!
                mainFile = program.setFile<BrsFile>('source/class.bs', classFileContent);
                validateFile(mainFile);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });


            it('functions in a namespace that return classes show change properly', () => {
                const fileContent = `
                    namespace Alpha.Beta

                        class SomeKlass
                            name as string
                            function combineName(klass as SomeKlass)
                                m.name = m.name+klass.name
                            end function
                        end class

                        function getSomeKlass(name as string) as SomeKlass
                            k = new SomeKlass()
                            k.name = name
                            return k
                        end function
                    end namespace
                `;

                let mainFile: BrsFile = program.setFile<BrsFile>('source/class.bs', fileContent);
                validateFile(mainFile);
                // No changes!
                mainFile = program.setFile<BrsFile>('source/class.bs', fileContent);
                validateFile(mainFile);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });

            it('functions in a namespace that have class params show change properly', () => {
                const fileContent = `
                    namespace Alpha.Beta
                        class SomeKlass
                            name as string
                            function combineName(klass as SomeKlass)
                                m.name = m.name + klass.name
                            end function
                        end class

                        function combineKlass(klass1 as SomeKlass, klass2 as SomeKlass) as SomeKlass
                            klass1.combineName(klass2)
                            return klass1
                        end function
                    end namespace
                `;
                let mainFile: BrsFile = program.setFile<BrsFile>('source/class.bs', fileContent);
                validateFile(mainFile);
                // No changes!
                mainFile = program.setFile<BrsFile>('source/class.bs', fileContent);
                validateFile(mainFile);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });

            it('should not include namespaces in changes if no symbols in namespace changed', () => {
                const fileContent = `
                    namespace Alpha.Beta
                        const PI = 3.14
                    end namespace
                `;
                const fileContentWithComment = `
                    namespace Alpha.Beta
                        const PI = 3.14 ' comment
                    end namespace
                `;
                let mainFile: BrsFile = program.setFile<BrsFile>('source/namespace.bs', fileContent);
                validateFile(mainFile);
                // Just added a comment!
                mainFile = program.setFile<BrsFile>('source/namespace.bs', fileContentWithComment);
                validateFile(mainFile);
                let runtimeChanges = mainFile.providedSymbols.changes.get(SymbolTypeFlag.runtime);
                expect(runtimeChanges.size).to.eq(0);
            });
        });
    });

    describe('propertyHints', () => {

        it('extracts property names for completion', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                function main(arg as string)
                    aa1 = {
                        "sprop1": 0,
                        prop1: 1
                                prop2: {
                            prop3: 2
                        }
                    }
                    aa2 = {
                        prop4: {
                            prop5: 5,
                            "sprop2": 0,
                            prop6: 6
                        },
                        prop7: 7
                    }
                    calling({
                        prop8: 8,
                        prop9: 9
                    })
                    aa1.field1 = 1
                    aa1.field2.field3 = 2
                    calling(aa2.field4, 3 + aa2.field5.field6)
                end function
            `);

            const expected = [
                'field1', 'field2', 'field3', 'field4', 'field5', 'field6',
                'prop1', 'prop2', 'prop3', 'prop4', 'prop5', 'prop6', 'prop7', 'prop8', 'prop9'
            ];

            const { propertyHints } = file['_cachedLookups'];
            expect(Object.keys(propertyHints).sort()).to.deep.equal(expected, 'Initial hints');
        });

        it('extracts property names matching JavaScript reserved names', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                function main(arg as string)
                    aa1 = {
                        "constructor": 0,
                        constructor: 1
                                valueOf: {
                            toString: 2
                        }
                    }
                    aa1.constructor = 1
                    aa1.valueOf.toString = 2
                end function
            `);

            const expected = [
                'constructor', 'tostring', 'valueof'
            ];

            const { propertyHints } = file['_cachedLookups'];
            expect(Object.keys(propertyHints).sort()).to.deep.equal(expected, 'Initial hints');
        });

        it('allows built-in types for class members', () => {
            program.setFile<BrsFile>('source/main.bs', `
                class MyBase
                    regex as roRegex
                    node as roSGNodeLabel

                    sub outputMatches(textInput as string)
                        matches = m.regex.match(textInput)
                        if matches.count() > 1
                            m.node.text = matches[1]
                        else
                            m.node.text = "no match"
                        end if
                    end sub

                    function getLabelParent() as roSGNode
                        return m.node.getParent()
                    end function
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows types on lhs of assignments', async () => {
            await testTranspile(`
                sub foo(node as roSGNode)
                    nodeParent as roSGNode = node.getParent()
                    text as string = nodeParent.id
                    print text
                end sub
            `, `
                sub foo(node as dynamic)
                    nodeParent = node.getParent()
                    text = nodeParent.id
                    print text
                end sub
            `);
        });


        //fails at the specific length of statement including leading tabs and spaces
        it('allows long statements', () => {
            program.setFile('source/main.bs', `function request()\r\nhzzzzandleInterceptedScreenDataaaaaaaaaaainterceptedScreenData() 'bs:disable-line \r\nend function`);
            program.validate();
            expectZeroDiagnostics(program);

            program.setFile('source/main.bs', `function request()\r\n\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\thandleInterceptedScreenDataaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(m._aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaainterceptedScreenData) 'bs:disable-line \r\nend function`);
            program.validate();
            expectZeroDiagnostics(program);

            program.setFile('source/main.bs', `function request()\r\n\t\t\t\thandleInterceptedScreenData(m._aaaaaaainterceptedScreenData) 'bs:disable-line 1001\r\nend function`);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    it('allows up to 63 function params', () => {
        program.setFile('source/main.bs', `
            function test(p1 = 1, p2 = 2, p3 = 3, p4 = 4, p5 = 5, p6 = 6, p7 = 7, p8 = 8, p9 = 9, p10 = 10, p11 = 11, p12 = 12, p13 = 13, p14 = 14, p15 = 15, p16 = 16, p17 = 17, p18 = 18, p19 = 19, p20 = 20, p21 = 21, p22 = 22, p23 = 23, p24 = 24, p25 = 25, p26 = 26, p27 = 27, p28 = 28, p29 = 29, p30 = 30, p31 = 31, p32 = 32, p33 = 33, p34 = 34, p35 = 35, p36 = 36, p37 = 37, p38 = 38, p39 = 39, p40 = 40, p41 = 41, p42 = 42, p43 = 43, p44 = 44, p45 = 45, p46 = 46, p47 = 47, p48 = 48, p49 = 49, p50 = 50, p51 = 51, p52 = 52, p53 = 53, p54 = 54, p55 = 55, p56 = 56, p57 = 57, p58 = 58, p59 = 59, p60 = 60, p61 = 61, p62 = 62, p63 = 63)
            end function
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags functions having 64 parameters', () => {
        program.setFile('source/main.bs', `
            function test(p1 = 1, p2 = 2, p3 = 3, p4 = 4, p5 = 5, p6 = 6, p7 = 7, p8 = 8, p9 = 9, p10 = 10, p11 = 11, p12 = 12, p13 = 13, p14 = 14, p15 = 15, p16 = 16, p17 = 17, p18 = 18, p19 = 19, p20 = 20, p21 = 21, p22 = 22, p23 = 23, p24 = 24, p25 = 25, p26 = 26, p27 = 27, p28 = 28, p29 = 29, p30 = 30, p31 = 31, p32 = 32, p33 = 33, p34 = 34, p35 = 35, p36 = 36, p37 = 37, p38 = 38, p39 = 39, p40 = 40, p41 = 41, p42 = 42, p43 = 43, p44 = 44, p45 = 45, p46 = 46, p47 = 47, p48 = 48, p49 = 49, p50 = 50, p51 = 51, p52 = 52, p53 = 53, p54 = 54, p55 = 55, p56 = 56, p57 = 57, p58 = 58, p59 = 59, p60 = 60, p61 = 61, p62 = 62, p63 = 63, p64 = 64)
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.tooManyCallableParameters(64, 63),
            range: util.createRange(1, 638, 1, 641)
        }]);
    });

    it('flags functions having 65 parameters', () => {
        program.setFile('source/main.bs', `
            function test(p1 = 1, p2 = 2, p3 = 3, p4 = 4, p5 = 5, p6 = 6, p7 = 7, p8 = 8, p9 = 9, p10 = 10, p11 = 11, p12 = 12, p13 = 13, p14 = 14, p15 = 15, p16 = 16, p17 = 17, p18 = 18, p19 = 19, p20 = 20, p21 = 21, p22 = 22, p23 = 23, p24 = 24, p25 = 25, p26 = 26, p27 = 27, p28 = 28, p29 = 29, p30 = 30, p31 = 31, p32 = 32, p33 = 33, p34 = 34, p35 = 35, p36 = 36, p37 = 37, p38 = 38, p39 = 39, p40 = 40, p41 = 41, p42 = 42, p43 = 43, p44 = 44, p45 = 45, p46 = 46, p47 = 47, p48 = 48, p49 = 49, p50 = 50, p51 = 51, p52 = 52, p53 = 53, p54 = 54, p55 = 55, p56 = 56, p57 = 57, p58 = 58, p59 = 59, p60 = 60, p61 = 61, p62 = 62, p63 = 63, p64 = 64, p65 = 65)
            end function
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.tooManyCallableParameters(65, 63),
            range: util.createRange(1, 638, 1, 641)
        }, {
            ...DiagnosticMessages.tooManyCallableParameters(65, 63),
            range: util.createRange(1, 648, 1, 651)
        }]);
    });

});
