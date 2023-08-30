import { assert, expect } from './chai-config.spec';
import * as pick from 'object.pick';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import * as fsExtra from 'fs-extra';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { BrsFile } from './files/BrsFile';
import type { XmlFile } from './files/XmlFile';
import { Program } from './Program';
import { standardizePath as s, util } from './util';
import { URI } from 'vscode-uri';
import PluginInterface from './PluginInterface';
import type { FunctionStatement, PrintStatement } from './parser/Statement';
import { EmptyStatement } from './parser/Statement';
import { expectDiagnostics, expectHasDiagnostics, expectZeroDiagnostics, trim, trimMap } from './testHelpers.spec';
import { doesNotThrow } from 'assert';
import { Logger } from './Logger';
import { createVisitor, WalkMode } from './astUtils/visitors';
import { isBrsFile } from './astUtils/reflection';
import type { LiteralExpression } from './parser/Expression';
import { tempDir, rootDir, stagingDir } from './testHelpers.spec';

let sinon = sinonImport.createSandbox();

describe('Program', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            stagingDir: stagingDir
        });
        program.createSourceScope(); //ensure source scope is created
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program.dispose();
    });

    it('Does not crazy for file not referenced by any other scope', async () => {
        program.setFile('tests/testFile.spec.bs', `
            function main(args as object) as object
                return roca(args).describe("test suite", sub()
                    m.pass()
                end sub)
            end function
        `);
        program.validate();
        //test passes if this line does not throw
        await program.getTranspiledFileContents('tests/testFile.spec.bs');
    });

    describe('global scope', () => {
        it('returns all callables when asked', () => {
            expect(program.globalScope.getAllCallables().length).to.be.greaterThan(0);
        });
        it('validate gets called and does nothing', () => {
            expect(program.globalScope.validate()).to.eql(undefined);
        });
    });

    describe('addFile', () => {
        it('adds various files to `pkgMap`', () => {
            program.setFile('source/main.brs', '');
            expect(program['pkgMap']).to.have.property(s`source/main.brs`);

            program.setFile('source/main.bs', '');
            expect(program['pkgMap']).to.have.property(s`source/main.bs`);

            program.setFile('components/comp1.xml', '');
            expect(program['pkgMap']).to.have.property(s`components/comp1.xml`);
        });

        it('does not crash when given a totally bogus file', () => {
            program.setFile('source/main.brs', `class Animalpublic name as stringpublic function walk()end functionend class`);
            //if the program didn't get stuck in an infinite loop, this test passes
        });

        it('flags unsupported statements at root of file', () => {
            program.setFile('source/main.brs', `
                result = true
                print true
                createObject("roSGNode", "Rectangle")
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.unexpectedStatementOutsideFunction()
            }, {
                ...DiagnosticMessages.unexpectedStatementOutsideFunction()
            }, {
                ...DiagnosticMessages.unexpectedStatementOutsideFunction()
            }]);
        });

        it('only parses xml files as components when file is found within the "components" folder', () => {
            expect(Object.keys(program.files).length).to.equal(0);

            program.setFile('components/comp1.xml', '');
            expect(Object.keys(program.files).length).to.equal(1);

            program.setFile('notComponents/comp1.xml', '');
            expect(Object.keys(program.files).length).to.equal(1);

            program.setFile('componentsExtra/comp1.xml', '');
            expect(Object.keys(program.files).length).to.equal(1);
        });

        it('supports empty statements for transpile', async () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    m.logError()
                    'some comment
                end sub
            `);
            (file.parser.ast.statements[0] as FunctionStatement).func.body.statements[0] = new EmptyStatement();
            await program.transpile([{ src: file.srcPath, dest: file.pkgPath }], tempDir);
        });

        it('works with different cwd', () => {
            let projectDir = s`${tempDir}/project2`;
            fsExtra.ensureDirSync(projectDir);
            program = new Program({ cwd: projectDir });
            program.setFile('source/lib.brs', 'function main()\n    print "hello world"\nend function');
            // await program.reloadFile('source/lib.brs', `'this is a comment`);
            //if we made it to here, nothing exploded, so the test passes
        });

        it(`adds files in the source folder to the 'source' scope`, () => {
            expect(program.getScopeByName('source')).to.exist;
            //no files in source scope
            expect(program.getScopeByName('source').getOwnFiles().length).to.equal(0);

            //add a new source file
            program.setFile('source/main.brs', '');
            //file should be in source scope now
            expect(program.getScopeByName('source').getFile('source/main.brs')).to.exist;

            //add an unreferenced file from the components folder
            program.setFile('components/component1/component1.brs', '');

            //source scope should have the same number of files
            expect(program.getScopeByName('source').getFile('source/main.brs')).to.exist;
            expect(program.getScopeByName('source').getFile(`${rootDir}/components/component1/component1.brs`)).not.to.exist;
        });

        it('normalizes file paths', () => {
            program.setFile('source/main.brs', '');

            expect(program.getScopeByName('source').getFile('source/main.brs')).to.exist;

            //shouldn't throw an exception because it will find the correct path after normalizing the above path and remove it
            try {
                program.removeFile('source/main.brs');
                //no error
            } catch (e) {
                assert.fail(null, null, 'Should not have thrown exception');
            }
        });

        it('creates a scope for every component xml file', () => {
            // let componentPath = path.resolve(`${rootDir}/components/component1.xml`);
            // await program.loadOrReloadFile('components', '')
        });

        it(`emits events for scope and file creation`, () => {
            const beforeProgramValidate = sinon.spy();
            const afterProgramValidate = sinon.spy();
            const afterScopeCreate = sinon.spy();
            const beforeScopeValidate = sinon.spy();
            const afterScopeValidate = sinon.spy();
            const beforeFileParse = sinon.spy();
            const afterFileParse = sinon.spy();
            const afterFileValidate = sinon.spy();
            program.plugins = new PluginInterface([{
                name: 'emits events for scope and file creation',
                beforeProgramValidate: beforeProgramValidate,
                afterProgramValidate: afterProgramValidate,
                afterScopeCreate: afterScopeCreate,
                beforeScopeValidate: beforeScopeValidate,
                afterScopeValidate: afterScopeValidate,
                beforeFileParse: beforeFileParse,
                afterFileParse: afterFileParse,
                afterFileValidate: afterFileValidate
            }], { logger: new Logger() });

            //add a new source file
            program.setFile('source/main.brs', '');
            //add a component file
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/lib.brs" />
                </component>`);
            program.validate();

            //program events
            expect(beforeProgramValidate.callCount).to.equal(1);
            expect(afterProgramValidate.callCount).to.equal(1);
            //scope events
            //(we get component scope event only because source is created in beforeEach)
            expect(afterScopeCreate.callCount).to.equal(1);
            expect(beforeScopeValidate.callCount).to.equal(2);
            expect(afterScopeValidate.callCount).to.equal(2);
            //file events
            expect(beforeFileParse.callCount).to.equal(2);
            expect(afterFileParse.callCount).to.equal(2);
            expect(afterFileValidate.callCount).to.equal(2);
        });
    });

    describe('validate', () => {
        it('retains expressions after validate', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub test()
                    print a.b.c
                end sub
            `);
            //disable the plugins
            expect(file.parser.references.expressions).to.be.lengthOf(1);
            program.validate();
            expect(file.parser.references.expressions).to.be.lengthOf(1);
        });
        it('catches duplicate XML component names', () => {
            //add 2 components which both reference the same errored file
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                </component>
            `);
            program.setFile('components/component2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.duplicateComponentName('Component1'),
                range: Range.create(1, 17, 1, 27),
                relatedInformation: [{
                    location: util.createLocation(
                        URI.file(s`${rootDir}/components/component1.xml`).toString(),
                        Range.create(1, 17, 1, 27)
                    ),
                    message: 'Also defined here'
                }]
            }, {
                ...DiagnosticMessages.duplicateComponentName('Component1'),
                range: Range.create(1, 17, 1, 27),
                relatedInformation: [{
                    location: util.createLocation(
                        URI.file(s`${rootDir}/components/component2.xml`).toString(),
                        Range.create(1, 17, 1, 27)
                    ),
                    message: 'Also defined here'
                }]
            }]);
        });

        it('allows adding diagnostics', () => {
            const expected = [{
                message: 'message',
                file: undefined,
                range: undefined
            }];
            program.addDiagnostics(expected);
            const actual = (program as any).diagnostics;
            expect(actual).to.deep.equal(expected);
        });

        it('does not produce duplicate parse errors for different component scopes', () => {
            //add a file with a parse error
            program.setFile('components/lib.brs', `
                sub DoSomething()
                    'random out-of-place open paren, definitely causes parse error
                    (
                end sub
            `);

            //add 2 components which both reference the same errored file
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/lib.brs" />
                </component>
            `);
            program.setFile('components/component2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component2" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/lib.brs" />
                </component>
            `);

            program.validate();
            expectHasDiagnostics(program, 1);
        });

        it('detects scripts not loaded by any file', () => {
            //add a main file for sanity check
            program.setFile('source/main.brs', '');
            program.validate();
            expectZeroDiagnostics(program);

            //add the orphaned file
            program.setFile('components/lib.brs', '');
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.fileNotReferencedByAnyOtherFile()
            ]);
        });

        it('does not throw errors on shadowed init functions in components', () => {
            program.setFile('lib.brs', `
                function DoSomething()
                    return true
                end function
            `);

            program.setFile('components/Parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Parent" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/lib.brs" />
                </component>
            `);

            program.setFile('components/Child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child" extends="Parent">
                </component>
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('recognizes global function calls', () => {
            expectZeroDiagnostics(program);
            program.setFile('source/file.brs', `
                function DoB()
                    sleep(100)
                end function
            `);
            //validate the scope
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('shows warning when a child component imports the same script as its parent', () => {
            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/lib.brs" />
                </component>
            `);

            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="pkg:/lib.brs" />
                </component>
            `);

            program.setFile('lib.brs', `'comment`);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unnecessaryScriptImportInChildFromParent('ParentScene')
            ]);
        });

        it('adds info diag when child component method shadows parent component method', () => {
            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/parent.brs" />
                </component>
            `);

            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="pkg:/child.brs" />
                </component>
            `);

            program.setFile('parent.brs', `sub DoSomething()\nend sub`);
            program.setFile('child.brs', `sub DoSomething()\nend sub`);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.overridesAncestorFunction('', '', '', '').code
            ]);
        });

        it('does not add info diagnostic on shadowed "init" functions', () => {
            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="parent.brs" />
                </component>
                `);
            program.setFile(`components/parent.brs`, `sub Init()\nend sub`);
            program.setFile(`components/child.brs`, `sub Init()\nend sub`);

            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="child.brs" />
                </component>
            `);
            //run this validate separately so we can have an easier time debugging just the child component
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('catches duplicate methods in single file', () => {
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.duplicateFunctionImplementation('DoSomething', 'source'),
                DiagnosticMessages.duplicateFunctionImplementation('DoSomething', 'source')
            ]);
        });

        it('catches duplicate methods across multiple files', () => {
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
            `);
            program.setFile('source/lib.brs', `
                sub DoSomething()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.duplicateFunctionImplementation('DoSomething', 'source'),
                DiagnosticMessages.duplicateFunctionImplementation('DoSomething', 'source')
            ]);
        });

        it('maintains correct callables list', () => {
            let initialCallableCount = program.getScopeByName('source').getAllCallables().length;
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            expect(program.getScopeByName('source').getAllCallables().length).equals(initialCallableCount + 2);
            //set the file contents again (resetting the wasProcessed flag)
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
                `);
            expect(program.getScopeByName('source').getAllCallables().length).equals(initialCallableCount + 2);
            program.removeFile(`${rootDir}/source/main.brs`);
            expect(program.getScopeByName('source').getAllCallables().length).equals(initialCallableCount);
        });

        it('resets errors on revalidate', () => {
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            program.validate();
            expectHasDiagnostics(program, 2);
            //set the file contents again (resetting the wasProcessed flag)
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
                sub DoSomething()
                end sub
            `);
            program.validate();
            expectHasDiagnostics(program, 2);

            //load in a valid file, the errors should go to zero
            program.setFile('source/main.brs', `
                sub DoSomething()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('identifies invocation of unknown function', () => {
            //call a function that doesn't exist
            program.setFile('source/main.brs', `
                sub Main()
                    name = "Hello"
                    DoSomething(name)
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('DoSomething')
            ]);
        });

        it('supports using vars defined in nested if statements', () => {
            //call a function that doesn't exist
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub Main()
                    if true
                        name = "bob"
                    end if
                    print name
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('supports using `m` vars in parameter default values', () => {
            //call a function that doesn't exist
            program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
                sub findNode(nodeId as string, parentNode = m.top as object)
                    return parentNode.findNode(nodeId)
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('detects methods from another file in a subdirectory', () => {
            program.setFile('source/main.brs', `
                sub Main()
                    DoSomething()
                end sub
            `);
            program.setFile('source/ui/lib.brs', `
                function DoSomething()
                    print "hello world"
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('hasFile', () => {
        it('recognizes when it has a file loaded', () => {
            expect(program.hasFile('file1.brs')).to.be.false;
            program.setFile('file1.brs', `'comment`);
            expect(program.hasFile('file1.brs')).to.be.true;
        });
    });

    describe('getPaths', () => {
        function getPaths(...args: any[]) {
            return (program as any).getPaths(...args);
        }
        it('works for dest', () => {
            expect(
                getPaths('source/main.brs', rootDir)
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('works for absolute src', () => {
            expect(
                getPaths(`${rootDir}/source\\main.brs`, rootDir)
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('works for missing src', () => {
            expect(
                getPaths({ dest: 'source/main.brs' }, rootDir)
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('works for missing dest', () => {
            expect(
                getPaths({ src: `${rootDir}/source/main.brs` }, rootDir)
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('works for pkg string', () => {
            expect(
                getPaths('pkg:/source/main.brs', rootDir)
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('favors pkgPath over destPath', () => {
            expect(
                getPaths({ srcPath: `${rootDir}/source/main.brs`, destPath: 'source/DontUse.brs', pkgPath: `pkg:/source/main.brs` })
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });

        it('works when given a file', () => {
            expect(
                getPaths({ srcPath: `${rootDir}/source/main.brs`, pkgPath: `source/main.brs` })
            ).to.eql({
                srcPath: s`${rootDir}/source/main.brs`,
                pkgPath: s`source/main.brs`
            });
        });
    });

    describe('setFile', () => {
        it('links xml scopes based on xml parent-child relationships', () => {
            program.setFile('components/ParentScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                </component>
            `);

            //create child component
            program.setFile('components/ChildScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                </component>
            `);

            expect(program.getScopeByName('components/ChildScene.xml').getParentScope().name).to.equal(s`components/ParentScene.xml`);

            //change the parent's name.
            program.setFile('components/ParentScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="NotParentScene" extends="Scene">
                </component>
            `);

            //The child scope should no longer have the link to the parent scope, and should instead point back to global
            expect(program.getScopeByName('components/ChildScene.xml').getParentScope().name).to.equal('global');
        });

        it('creates a new scope for every added component xml', () => {
            //we have global callables, so get that initial number
            program.setFile('components/component1.xml', '');
            expect(program.getScopeByName(`components/component1.xml`)).to.exist;

            program.setFile('components/component1.xml', '');
            program.setFile('components/component2.xml', '');
            expect(program.getScopeByName(`components/component1.xml`)).to.exist;
            expect(program.getScopeByName(`components/component2.xml`)).to.exist;
        });

        it('includes referenced files in xml scopes', () => {
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            program.setFile('components/component1.brs', '');

            let scope = program.getScopeByName(`components/component1.xml`);
            expect(scope.getFile('components/component1.xml').pkgPath).to.equal(s`components/component1.xml`);
            expect(scope.getFile('components/component1.brs').pkgPath).to.equal(s`components/component1.brs`);
        });

        it('adds xml file to files map', () => {
            program.setFile('components/component1.xml', '');
            expect(program.getFile('components/component1.xml')).to.exist;
        });

        it('detects missing script reference', () => {
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.referencedFileDoesNotExist(),
                range: Range.create(2, 42, 2, 72)
            }]);
        });

        it('adds warning instead of error on mismatched upper/lower case script import', () => {
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="component1.brs" />
                </component>
            `);
            program.setFile('components/COMPONENT1.brs', '');

            //validate
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.scriptImportCaseMismatch(s`components\\COMPONENT1.brs`)
            ]);
        });
    });

    describe('reloadFile', () => {
        it('picks up new files in a scope when an xml file is loaded', () => {
            program.options.ignoreErrorCodes.push(1013);
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.referencedFileDoesNotExist()
            ]);

            //add the file, the error should go away
            program.setFile('components/component1.brs', '');
            program.validate();
            expectZeroDiagnostics(program);

            //add the xml file back in, but change the component brs file name. Should have an error again
            program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component2.brs" />
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.referencedFileDoesNotExist()
            ]);
        });

        it('handles when the brs file is added before the component', () => {
            let brsPath = s`${rootDir}/components/component1.brs`;
            program.setFile('components/component1.brs', '');

            let xmlFile = program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(program.getScopeByName(xmlFile.pkgPath).getFile(brsPath)).to.exist;
        });

        it('reloads referenced fles when xml file changes', () => {
            program.options.ignoreErrorCodes.push(1013);
            program.setFile('components/component1.brs', '');

            let xmlFile = program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">

                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(program.getScopeByName(xmlFile.pkgPath).getFile('components/component1.brs')).not.to.exist;

            //reload the xml file contents, adding a new script reference.
            xmlFile = program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="HeroScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/component1.brs" />
                </component>
            `);

            expect(program.getScopeByName(xmlFile.pkgPath).getFile('components/component1.brs')).to.exist;
        });
    });

    describe('getCodeActions', () => {
        it('does not fail when file is missing from program', () => {
            doesNotThrow(() => {
                program.getCodeActions('not/real/file', util.createRange(1, 2, 3, 4));
            });
        });
    });

    describe('xml inheritance', () => {
        it('handles parent-child attach and detach', () => {
            //create parent component
            let parentFile = program.setFile('components/ParentScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                </component>
            `);

            //create child component
            let childFile = program.setFile('components/ChildScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                </component>
            `);

            //the child should have been attached to the parent
            expect((childFile as XmlFile).parentComponent).to.equal(parentFile);

            //change the name of the parent
            parentFile = program.setFile('components/ParentScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="NotParentScene" extends="Scene">
                </component>
            `);

            //the child should no longer have a parent
            expect((childFile as XmlFile).parentComponent).not.to.exist;
        });

        it('provides child components with parent functions', () => {
            //create parent component
            program.setFile('components/ParentScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                </component>
            `);

            //create child component
            program.setFile('components/ChildScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            program.setFile('components/ChildScene.brs', `
                sub Init()
                    DoParentThing()
                end sub
            `);

            program.validate();

            //there should be an error when calling DoParentThing, since it doesn't exist on child or parent
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('DoParentThing')
            ]);

            //add the script into the parent
            program.setFile('components/ParentScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="Scene">
                    <script type="text/brightscript" uri="ParentScene.brs" />
                </component>
            `);

            program.setFile('components/ParentScene.brs', `
                sub DoParentThing()

                end sub
            `);

            program.validate();
            //the error should be gone because the child now has access to the parent script
            expectZeroDiagnostics(program);
        });
    });

    describe('xml scope', () => {
        it('does not fail on base components with many children', () => {
            program.setFile('source/lib.brs', `
                sub DoSomething()
                end sub
            `);

            //add a brs file with invalid syntax
            program.setFile('components/base.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="BaseScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            let childCount = 20;
            //add many children, we should never encounter an error
            for (let i = 0; i < childCount; i++) {
                program.setFile(`components/child${i}.xml`, trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Child${i}" extends="BaseScene">
                        <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                    </component>
                `);
            }
            program.validate();

            //the children shouldn't have diagnostics about shadowing their parent lib.brs file.
            expectZeroDiagnostics(
                program.getDiagnostics().filter((x) => x.code === DiagnosticMessages.overridesAncestorFunction('', '', '', '').code)
            );

            //the children all include a redundant import of lib.brs file which is imported by the parent.
            expect(
                program.getDiagnostics().filter((x) => x.code === DiagnosticMessages.unnecessaryScriptImportInChildFromParent('').code)
            ).to.be.lengthOf(childCount);
        });

        it('detects script import changes', () => {
            //create the xml file without script imports
            let xmlFile = program.setFile('components/component.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyScene" extends="Scene">
                </component>
            `);

            //the component scope should only have the xml file
            expect(program.getScopeByName(xmlFile.pkgPath).getOwnFiles().length).to.equal(1);

            //create the lib file
            let libFile = program.setFile('source/lib.brs', `'comment`);

            //change the xml file to have a script import
            xmlFile = program.setFile('components/component.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            let scope = program.getScopeByName(xmlFile.pkgPath);
            //the component scope should have the xml file AND the lib file
            expect(scope.getOwnFiles().length).to.equal(2);
            expect(scope.getFile(xmlFile.srcPath)).to.exist;
            expect(scope.getFile(libFile.srcPath)).to.exist;

            //reload the xml file again, removing the script import.
            xmlFile = program.setFile('components/component.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyScene" extends="Scene">
                </component>
            `);

            //the scope should again only have the xml file loaded
            expect(program.getScopeByName(xmlFile.pkgPath).getOwnFiles().length).to.equal(1);
            expect(program.getScopeByName(xmlFile.pkgPath)).to.exist;
        });
    });

    describe('removeFiles', () => {
        it('removes files by absolute paths', () => {
            program.setFile('source/main.brs', '');
            expect(program.getFile(s`source/main.brs`)).to.exist;
            program.removeFiles([`${rootDir}/source/main.brs`]);
            expect(program.getFile(s`source/main.brs`)).not.to.exist;
        });
    });

    describe('getDiagnostics', () => {
        it('includes diagnostics from files not included in any scope', () => {
            program.setFile('components/a/b/c/main.brs', `
                sub A()
                    "this string is not terminated
                end sub
            `);
            //the file should be included in the program
            expect(program.getFile('components/a/b/c/main.brs')).to.exist;
            let diagnostics = program.getDiagnostics();
            expectHasDiagnostics(diagnostics);
            let parseError = diagnostics.filter(x => x.message === 'Unterminated string at end of line')[0];
            expect(parseError).to.exist;
        });

        it('it excludes specified error codes', () => {
            //declare file with two different syntax errors
            program.setFile('source/main.brs', `
                sub A()
                    'call with wrong param count
                    B("one", "two")

                    'call unknown function
                    C()
                end sub

                sub B(name as string)
                end sub
            `);

            program.validate();
            expectHasDiagnostics(program, 2);

            program.options.diagnosticFilters = [
                DiagnosticMessages.mismatchArgumentCount(0, 0).code
            ];

            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('C')
            ]);
        });
    });

    describe('getCompletions', () => {
        it('returns all functions in scope', () => {
            program.setFile('source/main.brs', `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            program.setFile('source/lib.brs', `
                sub ActionB()
                end sub
            `);

            program.validate();

            let completions = program
                //get completions
                .getCompletions(`${rootDir}/source/main.brs`, util.createPosition(2, 10))
                //only keep the label property for this test
                .map(x => pick(x, 'label'));

            expect(completions).to.deep.include({ label: 'Main' });
            expect(completions).to.deep.include({ label: 'ActionA' });
            expect(completions).to.deep.include({ label: 'ActionB' });
        });
    });

    it('does not create map by default', async () => {
        fsExtra.ensureDirSync(program.options.stagingDir);
        program.setFile('source/main.brs', `
            sub main()
            end sub
        `);
        program.validate();
        await program.transpile([], program.options.stagingDir);
        expect(fsExtra.pathExistsSync(s`${stagingDir}/source/main.brs`)).is.true;
        expect(fsExtra.pathExistsSync(s`${stagingDir}/source/main.brs.map`)).is.false;
    });

    it('creates sourcemap for brs and xml files', async () => {
        fsExtra.ensureDirSync(program.options.stagingDir);
        program.setFile('source/main.brs', `
            sub main()
            end sub
        `);
        program.setFile('components/comp1.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="SimpleScene" extends="Scene">
            </component>
        `);
        program.validate();

        expect(fsExtra.pathExistsSync(s`${stagingDir}/source/main.brs.map`)).is.false;
        expect(fsExtra.pathExistsSync(s`${stagingDir}/components/comp1.xml.map`)).is.false;

        let filePaths = [{
            src: s`${rootDir}/source/main.brs`,
            dest: s`source/main.brs`
        }, {
            src: s`${rootDir}/components/comp1.xml`,
            dest: s`components/comp1.xml`
        }];
        program.options.sourceMap = true;
        await program.transpile(filePaths, program.options.stagingDir);

        expect(fsExtra.pathExistsSync(s`${stagingDir}/source/main.brs.map`)).is.true;
        expect(fsExtra.pathExistsSync(s`${stagingDir}/components/comp1.xml.map`)).is.true;
    });

    it('copies the bslib.brs file', async () => {
        fsExtra.ensureDirSync(program.options.stagingDir);
        program.validate();

        await program.transpile([], program.options.stagingDir);

        expect(fsExtra.pathExistsSync(s`${stagingDir}/source/bslib.brs`)).is.true;
    });

    describe('getTranspiledFileContents', () => {
        it('fires plugin events', async () => {
            const file = program.setFile('source/main.brs', trim`
                sub main()
                    print "hello world"
                end sub
            `);
            const plugin = program.plugins.add({
                name: 'TestPlugin',
                beforeFileTranspile: (event) => {
                    const stmt = ((event.file as BrsFile).ast.statements[0] as FunctionStatement).func.body.statements[0] as PrintStatement;
                    event.editor.setProperty((stmt.expressions[0] as LiteralExpression).token, 'text', '"hello there"');
                },
                afterFileTranspile: sinon.spy()
            });
            expect(
                (await program.getTranspiledFileContents(file.srcPath)).code
            ).to.eql(trim`
                sub main()
                    print "hello there"
                end sub`
            );
            expect(plugin.afterFileTranspile.callCount).to.be.greaterThan(0);
        });

        it('allows events to modify the file contents', async () => {
            program.options.emitDefinitions = true;
            program.plugins.add({
                name: 'TestPlugin',
                afterFileTranspile: (event) => {
                    event.code = `'code comment\n${event.code}`;
                    event.typedef = `'typedef comment\n${event.typedef}`;
                }
            });
            program.setFile('source/lib.bs', `
                sub log(message)
                    print message
                end sub
            `);
            await program.transpile([], stagingDir);
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/lib.brs`).toString().trimEnd()
            ).to.eql(trim`
                'code comment
                sub log(message)
                    print message
                end sub`
            );
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/lib.d.bs`).toString().trimEnd()
            ).to.eql(trim`
                'typedef comment
                sub log(message)
                end sub
            `);
        });
    });

    it('beforeProgramTranspile sends entries in alphabetical order', () => {
        program.setFile('source/main.bs', trim`
            sub main()
                print "hello world"
            end sub
        `);

        program.setFile('source/common.bs', trim`
            sub getString()
                return "test"
            end sub
        `);

        //send the files out of order
        const result = program['beforeProgramTranspile']([{
            src: s`${rootDir}/source/main.bs`,
            dest: 'source/main.bs'
        }, {
            src: s`${rootDir}/source/main.bs`,
            dest: 'source/main.bs'
        }], program.options.stagingDir);

        //entries should now be in alphabetic order
        expect(
            result.entries.map(x => x.outputPath)
        ).to.eql([
            s`${stagingDir}/source/common.brs`,
            s`${stagingDir}/source/main.brs`
        ]);
    });

    describe('transpile', () => {
        it('detects and transpiles files added between beforeProgramTranspile and afterProgramTranspile', async () => {
            program.setFile('source/main.bs', trim`
                sub main()
                    print "hello world"
                end sub
            `);
            program.plugins.add({
                name: 'TestPlugin',
                beforeFileTranspile: (event) => {
                    if (isBrsFile(event.file)) {
                        //add lib1
                        if (event.outputPath.endsWith('main.brs')) {
                            event.program.setFile('source/lib1.bs', `
                                sub lib1()
                                end sub
                            `);
                        }
                        //add lib2 (this should happen during the next cycle of "catch missing files" cycle
                        if (event.outputPath.endsWith('main.brs')) {
                            //add another file
                            event.program.setFile('source/lib2.bs', `
                                sub lib2()
                                end sub
                            `);
                        }
                    }
                }
            });
            await program.transpile([], stagingDir);
            //our new files should exist
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/lib1.brs`).toString()
            ).to.eql(trim`
                sub lib1()
                end sub
            `);
            //our changes should be there
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/lib2.brs`).toString()
            ).to.eql(trim`
                sub lib2()
                end sub
            `);
        });

        it('sets needsTranspiled=true when there is at least one edit', async () => {
            program.setFile('source/main.brs', trim`
                sub main()
                    print "hello world"
                end sub
            `);
            program.plugins.add({
                name: 'TestPlugin',
                beforeFileTranspile: (event) => {
                    const stmt = ((event.file as BrsFile).ast.statements[0] as FunctionStatement).func.body.statements[0] as PrintStatement;
                    event.editor.setProperty((stmt.expressions[0] as LiteralExpression).token, 'text', '"hello there"');
                }
            });
            await program.transpile([], stagingDir);
            //our changes should be there
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/main.brs`).toString()
            ).to.eql(trim`
                sub main()
                    print "hello there"
                end sub`
            );
        });

        it('handles AstEditor flow properly', async () => {
            program.setFile('source/main.bs', `
                sub main()
                    print "hello world"
                end sub
            `);
            let literalExpression: LiteralExpression;
            //replace all strings with "goodbye world"
            program.plugins.add({
                name: 'TestPlugin',
                beforeFileTranspile: (event) => {
                    if (isBrsFile(event.file)) {
                        event.file.ast.walk(createVisitor({
                            LiteralExpression: (literal) => {
                                literalExpression = literal;
                                event.editor.setProperty(literal.token, 'text', '"goodbye world"');
                            }
                        }), {
                            walkMode: WalkMode.visitExpressionsRecursive
                        });
                    }
                }
            });
            //transpile the file
            await program.transpile([], stagingDir);
            //our changes should be there
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/main.brs`).toString()
            ).to.eql(trim`
                sub main()
                    print "goodbye world"
                end sub`
            );

            //our literalExpression should have been restored to its original value
            expect(literalExpression.token.text).to.eql('"hello world"');
        });

        it('handles AstEditor for beforeProgramTranspile', async () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main()
                    print "hello world"
                end sub
            `);
            let literalExpression: LiteralExpression;
            //replace all strings with "goodbye world"
            program.plugins.add({
                name: 'TestPlugin',
                beforeProgramTranspile: (event) => {
                    file.ast.walk(createVisitor({
                        LiteralExpression: (literal) => {
                            literalExpression = literal;
                            event.editor.setProperty(literal.token, 'text', '"goodbye world"');
                        }
                    }), {
                        walkMode: WalkMode.visitExpressionsRecursive
                    });
                }
            });
            //transpile the file
            await program.transpile([], stagingDir);
            //our changes should be there
            expect(
                fsExtra.readFileSync(`${stagingDir}/source/main.brs`).toString()
            ).to.eql(trim`
                sub main()
                    print "goodbye world"
                end sub`
            );

            //our literalExpression should have been restored to its original value
            expect(literalExpression.token.text).to.eql('"hello world"');
        });

        it('copies bslib.brs when no ropm version was found', async () => {
            await program.transpile([], stagingDir);
            expect(fsExtra.pathExistsSync(`${stagingDir}/source/bslib.brs`)).to.be.true;
        });

        it('does not copy bslib.brs when found in roku_modules', async () => {
            program.setFile('source/roku_modules/bslib/bslib.brs', '');
            await program.transpile([], stagingDir);
            expect(fsExtra.pathExistsSync(`${stagingDir}/source/bslib.brs`)).to.be.false;
            expect(fsExtra.pathExistsSync(`${stagingDir}/source/roku_modules/bslib/bslib.brs`)).to.be.true;
        });

        it('transpiles in-memory-only files', async () => {
            program.setFile('source/logger.bs', trim`
                sub logInfo()
                    print SOURCE_LINE_NUM
                end sub
            `);
            await program.transpile([], program.options.stagingDir);
            expect(trimMap(
                fsExtra.readFileSync(s`${stagingDir}/source/logger.brs`).toString()
            )).to.eql(trim`
                sub logInfo()
                    print 2
                end sub
            `);
        });

        it('copies in-memory-only .brs files to stagingDir', async () => {
            program.setFile('source/logger.brs', trim`
                sub logInfo()
                    print "logInfo"
                end sub
            `);
            await program.transpile([], program.options.stagingDir);
            expect(trimMap(
                fsExtra.readFileSync(s`${stagingDir}/source/logger.brs`).toString()
            )).to.eql(trim`
                sub logInfo()
                    print "logInfo"
                end sub
            `);
        });

        it('copies in-memory .xml file', async () => {
            program.setFile('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                </component>
            `);
            await program.transpile([], program.options.stagingDir);
            expect(trimMap(
                fsExtra.readFileSync(s`${stagingDir}/components/Component1.xml`).toString()
            )).to.eql(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `);
        });

        it('uses sourceRoot when provided for brs files', async () => {
            let sourceRoot = s`${tempDir}/sourceRootFolder`;
            program = new Program({
                rootDir: rootDir,
                stagingDir: stagingDir,
                sourceRoot: sourceRoot,
                sourceMap: true
            });
            program.setFile('source/main.brs', `
                sub main()
                end sub
            `);
            await program.transpile([{
                src: s`${rootDir}/source/main.brs`,
                dest: s`source/main.brs`
            }], stagingDir);

            let contents = fsExtra.readFileSync(s`${stagingDir}/source/main.brs.map`).toString();
            let map = JSON.parse(contents);
            expect(
                s`${map.sources[0]}`
            ).to.eql(
                s`${sourceRoot}/source/main.brs`
            );
        });

        it('uses sourceRoot when provided for bs files', async () => {
            let sourceRoot = s`${tempDir}/sourceRootFolder`;
            program = new Program({
                rootDir: rootDir,
                stagingDir: stagingDir,
                sourceRoot: sourceRoot,
                sourceMap: true
            });
            program.setFile('source/main.bs', `
                sub main()
                end sub
            `);
            await program.transpile([{
                src: s`${rootDir}/source/main.bs`,
                dest: s`source/main.bs`
            }], stagingDir);

            let contents = fsExtra.readFileSync(s`${stagingDir}/source/main.brs.map`).toString();
            let map = JSON.parse(contents);
            expect(
                s`${map.sources[0]}`
            ).to.eql(
                s`${sourceRoot}/source/main.bs`
            );
        });
    });

    describe('typedef', () => {
        describe('emitDefinitions', () => {
            it('generates typedef for .bs files', async () => {
                program.setFile<BrsFile>('source/Duck.bs', `
                    class Duck
                    end class
                `);
                program.options.emitDefinitions = true;
                program.validate();
                await program.transpile([], stagingDir);

                expect(fsExtra.pathExistsSync(s`${stagingDir}/source/Duck.brs`)).to.be.true;
                expect(fsExtra.pathExistsSync(s`${stagingDir}/source/Duck.d.bs`)).to.be.true;
                expect(fsExtra.pathExistsSync(s`${stagingDir}/source/Duck.d.brs`)).to.be.false;
            });

            it('does not generate typedef for typedef file', async () => {
                program.setFile<BrsFile>('source/Duck.d.bs', `
                    class Duck
                    end class
                `);
                program.options.emitDefinitions = true;
                program.validate();
                await program.transpile([], stagingDir);

                expect(fsExtra.pathExistsSync(s`${stagingDir}/source/Duck.d.brs`)).to.be.false;
                expect(fsExtra.pathExistsSync(s`${stagingDir}/source/Duck.brs`)).to.be.false;
            });
        });

        it('ignores bs1018 for d.bs files', () => {
            program.setFile<BrsFile>('source/main.d.bs', `
                class Duck
                    sub new(name as string)
                    end sub
                    name as string
                end class

                class BabyDuck extends Duck
                    sub new(name as string, age as integer)
                    end sub
                    age as integer
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('getSignatureHelp', () => {
        function getSignatureHelp(line: number, column: number) {
            return program.getSignatureHelp(
                'source/main.bs',
                util.createPosition(line, column)
            );
        }

        function assertSignatureHelp(line: number, col: number, text: string, index: number) {
            let signatureHelp = getSignatureHelp(line, col);
            expect(signatureHelp?.[0]?.signature?.label, `wrong label for ${line},${col} - got: "${signatureHelp?.[0]?.signature?.label}" expected "${text}"`).to.equal(text);
            expect(signatureHelp?.[0]?.index, `wrong index for ${line},${col} - got ${signatureHelp?.[0]?.index} expected ${index}`).to.equal(index);
        }

        it('does not crash when there is no file', () => {
            let signatureHelp = getSignatureHelp(1, 9);
            expectZeroDiagnostics(program);
            expect(signatureHelp[0]?.signature).to.not.exist;
        });

        it('does not crash when there is no expression at location', () => {
            program.validate();
            let signatureHelp = getSignatureHelp(1, 9);

            expectZeroDiagnostics(program);
            expect(signatureHelp[0]?.signature).to.not.exist;
        });

        describe('gets signature info for regular function call', () => {
            it('does not get help when on method name', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello("name", 12)
                    end sub

                    sub sayHello(name as string, age as integer)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                for (let i = 24; i < 33; i++) {
                    let signatureHelp = getSignatureHelp(2, i);
                    expect(signatureHelp).is.empty;
                }
            });

            it('gets help when on first param', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello("name", 12)
                    end sub

                    sub sayHello(name as string, age as integer)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                for (let i = 33; i < 40; i++) {
                    assertSignatureHelp(2, i, 'sub sayHello(name as string, age as integer)', 0);
                }
            });

            it('gets help when on second param', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello("name", 12)
                    end sub

                    sub sayHello(name as string, age as integer)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                for (let i = 41; i < 44; i++) {
                    assertSignatureHelp(2, i, 'sub sayHello(name as string, age as integer)', 1);
                }
            });
        });

        describe('does not crash for unknown function info for regular function call', () => {
            it('gets help when on method name', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        cryHello("name", 12)
                    end sub

                    sub sayHello(name as string, age as integer)
                    end sub
                `);
                program.validate();
                let signatureHelp = getSignatureHelp(2, 26);
                expect(signatureHelp).to.be.empty;
                signatureHelp = getSignatureHelp(2, 34);
                expect(signatureHelp).to.be.empty;
                signatureHelp = getSignatureHelp(2, 43);
                expect(signatureHelp).to.be.empty;
            });
        });

        describe('gets signature info for class function call', () => {
            it('gets help when on method name', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        william = new Greeter()
                        william.sayHello("name", 12)
                    end sub
                    class Greeter
                        sub sayHello(name as string, age as integer)
                        end sub
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 42, 'sub sayHello(name as string, age as integer)', 0);
            });

            it('gets help when on first param', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        william = new Greeter()
                        william.sayHello("name", 12)
                    end sub
                    class Greeter
                        sub sayHello(name as string, age as integer)
                        end sub
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 51, 'sub sayHello(name as string, age as integer)', 1);
            });
        });

        describe('gets signature info for class function call on this class', () => {
            it('gets help when on method name', () => {
                program.setFile('source/main.bs', `
                    class Greeter
                        sub greet()
                            m.sayHello("name", 12)
                        end sub
                        sub sayHello(name as string, age as integer)
                        end sub
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 42, 'sub sayHello(name as string, age as integer)', 0);
            });

            it('gets help when on second param', () => {
                program.setFile('source/main.bs', `
                    class Greeter
                        sub greet()
                            m.sayHello("name", 12)
                        end sub
                        sub sayHello(name as string, age as integer)
                        end sub
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 49, 'sub sayHello(name as string, age as integer)', 1);
            });

        });
        describe('gets signature info for overridden class function call', () => {
            it('gets help when on first param', () => {
                program.setFile('source/main.bs', `
                    class Greeter extends Person
                        sub greet()
                            m.sayHello("name", 12)
                        end sub
                        override sub sayHello(name as string, age as integer)
                        end sub

                        end class
                        class Person
                            sub sayHello(name as string, age as integer)
                            end sub
                        end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 43, 'sub sayHello(name as string, age as integer)', 0);
            });

            it('gets help when on second param', () => {
                program.setFile('source/main.bs', `
                    class Greeter extends Person
                        sub greet()
                            m.sayHello("name", 12)
                        end sub
                        override sub sayHello(name as string, age as integer)
                        end sub

                        end class
                        class Person
                            sub sayHello(name as string, age as integer)
                            end sub
                        end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 49, 'sub sayHello(name as string, age as integer)', 1);
            });
        });

        describe('gets signature info for overridden super method function call', () => {
            it('gets help when on first param', () => {
                program.setFile('source/main.bs', `
                    class Greeter extends Person
                        sub greet()
                            m.sayHello("name", 12)
                        end sub
                        override sub sayHello(name as string, age as integer)
                        end sub

                        end class
                        class Person
                            sub sayHello(name as string, age as integer)
                            end sub
                        end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 43, 'sub sayHello(name as string, age as integer)', 0);
            });

            it('gets help when on first param', () => {
                program.setFile('source/main.bs', `
                    class Greeter extends Person
                        sub greet()
                            m.sayHello("name", 12)
                        end sub
                        override sub sayHello(name as string, age as integer)
                        end sub

                        end class
                        class Person
                            sub sayHello(name as string, age as integer)
                            end sub
                        end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 49, 'sub sayHello(name as string, age as integer)', 1);
            });
        });

        describe('gets signature info for nested function call', () => {
            it('gets signature info for the outer function - index 0', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        outer([inner(["apple"], 100)], 12)
                    end sub

                    sub outer(name as object, age as integer)
                    end sub

                    function inner(fruits as object, age as integer)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 36, 'sub outer(name as object, age as integer)', 0);
            });

            it('gets signature info for the outer function - index 1', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        outer([inner(["apple"], 100)], 12)
                    end sub

                    sub outer(name as object, age as integer)
                    end sub

                    function inner(fruits as object, age as integer)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 57, 'sub outer(name as object, age as integer)', 1);
            });

            it('gets signature info for the inner function - name', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        outer([inner(["apple"], 100)], 12)
                    end sub

                    sub outer(name as object, age as integer)
                    end sub

                    function inner(fruits as object, age as integer)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 43, 'function inner(fruits as object, age as integer)', 0);
            });

            it('gets signature info for the inner function - param 0', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        outer([inner(["apple"], 100)], 12)
                    end sub

                    sub outer(name as object, age as integer)
                    end sub

                    function inner(fruits as object, age as integer)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 51, 'function inner(fruits as object, age as integer)', 1);
            });

            it('gets signature info for the inner function - param 1', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        outer([inner(["apple"], 100)], 12)
                    end sub

                    sub outer(name as object, age as integer)
                    end sub

                    function inner(fruits as object, age as integer)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 48, 'function inner(fruits as object, age as integer)', 1);
            });
        });

        describe('classes', () => {
            it('gives signature help in constructors', () => {
                program.setFile('source/main.bs', `
                    sub test()
                        p = new Person("george", 20, "text")
                    end sub
                    class Person
                        function new(name as string, age as integer, n2 as string)
                        end function
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);

                for (let i = 40; i < 48; i++) {
                    assertSignatureHelp(2, i, 'Person(name as string, age as integer, n2 as string)', 0);
                }
                for (let i = 48; i < 52; i++) {
                    assertSignatureHelp(2, i, 'Person(name as string, age as integer, n2 as string)', 1);
                }
                for (let i = 52; i < 60; i++) {
                    assertSignatureHelp(2, i, 'Person(name as string, age as integer, n2 as string)', 2);
                }
            });

            it('gives signature help for class with no constructor', () => {
                program.setFile('source/main.bs', `
                    sub test()
                        p = new Person()
                    end sub
                    class Person
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);

                assertSignatureHelp(2, 40, 'Person()', 0);
            });

            it('gives signature help for base constructor', () => {
                program.setFile('source/main.bs', `
                    sub test()
                        p = new Person("george", 20, "text")
                    end sub
                    class Person extends Being
                    end class
                    class Being
                        function new(name as string, age as integer, n2 as string)
                        end function
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);

                for (let i = 40; i < 48; i++) {
                    assertSignatureHelp(2, i, 'Person(name as string, age as integer, n2 as string)', 0);
                }
                for (let i = 48; i < 52; i++) {
                    assertSignatureHelp(2, i, 'Person(name as string, age as integer, n2 as string)', 1);
                }
                for (let i = 52; i < 60; i++) {
                    assertSignatureHelp(2, i, 'Person(name as string, age as integer, n2 as string)', 2);
                }
            });

            it('gives signature help in constructors in namespaced class', () => {
                program.setFile('source/main.bs', `
                    sub test()
                        p = new being.human.Person("george", 20, "text")
                    end sub
                    namespace being.human
                        class Person
                            function new(name as string, age as integer, n2 as string)
                            end function
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);

                for (let i = 52; i < 60; i++) {
                    assertSignatureHelp(2, i, 'being.human.Person(name as string, age as integer, n2 as string)', 0);
                }
                for (let i = 60; i < 64; i++) {
                    assertSignatureHelp(2, i, 'being.human.Person(name as string, age as integer, n2 as string)', 1);
                }
                for (let i = 64; i < 72; i++) {
                    assertSignatureHelp(2, i, 'being.human.Person(name as string, age as integer, n2 as string)', 2);
                }
            });
        });

        describe('edge cases', () => {
            it('still gives signature help on commas', () => {
                program.setFile('source/main.bs', `
                    class Person
                        function sayHello(name as string, age as integer, n2 as string)
                        end function

                        function yes(a as string)
                            m.sayHello("george",m.yes("a"),
                            m.yes(""))
                        end function
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);

                for (let i = 42; i < 48; i++) {
                    assertSignatureHelp(6, i, 'function sayHello(name as string, age as integer, n2 as string)', 0);
                }
                for (let i = 48; i < 54; i++) {
                    assertSignatureHelp(6, i, 'function sayHello(name as string, age as integer, n2 as string)', 1);
                }
                for (let i = 54; i < 58; i++) {
                    assertSignatureHelp(6, i, 'function yes(a as string)', 0);
                }
            });

            it('still gives signature help on spaces', () => {
                program.setFile('source/main.bs', `
                    class Person
                        function sayHello(name as string, age as integer, n2 as string)
                        end function

                        function yes(a as string)
                            m.sayHello("george", m.yes("a"),
                            m.yes(""))
                        end function
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);

                for (let i = 42; i < 48; i++) {
                    assertSignatureHelp(6, i, 'function sayHello(name as string, age as integer, n2 as string)', 0);
                }
                for (let i = 48; i < 55; i++) {
                    assertSignatureHelp(6, i, 'function sayHello(name as string, age as integer, n2 as string)', 1);
                }
                for (let i = 55; i < 58; i++) {
                    assertSignatureHelp(6, i, 'function yes(a as string)', 0);
                }
                for (let i = 0; i < 33; i++) {
                    assertSignatureHelp(7, i, 'function sayHello(name as string, age as integer, n2 as string)', 2);
                }
            });
        });

        describe('gets signature info for function calls that go over a line', () => {
            it('gets signature info for the outer function - index 0', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello([getName([
                            "apple"
                            "pear"
                        ], function()
                            return 10
                        end function
                        )], 12)
                    end sub

                    sub sayHello(name as object, age as integer)
                    end sub

                    function getName(fruits as object, age as function)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                for (let i = 34; i < 42; i++) {
                    assertSignatureHelp(2, i, 'sub sayHello(name as object, age as integer)', 0);
                }
            });

            it('gets signature info for the outer function - end of index 0', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello([getName([
                            "apple"
                            "pear"
                        ], function()
                            return 10
                        end function
                        )], 12)
                    end sub

                    sub sayHello(name as object, age as integer)
                    end sub

                    function getName(fruits as object, age as function)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(8, 25, 'sub sayHello(name as object, age as integer)', 0);
            });

            it('gets signature info for the outer function - index 1', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello([getName([
                            "apple"
                            "pear"
                        ], function()
                            return 10
                        end function
                        )], 12)
                    end sub

                    sub sayHello(name as object, age as integer)
                    end sub

                    function getName(fruits as object, age as function)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(8, 30, 'sub sayHello(name as object, age as integer)', 1);
            });

            it('gets signature info for the inner function - param 0', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello([getName([
                            "apple"
                            "pear"
                        ], function()
                            return 10
                        end function
                        )], 12)
                    end sub

                    sub sayHello(name as object, age as integer)
                    end sub

                    function getName(fruits as object, age as function)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(3, 31, 'function getName(fruits as object, age as function)', 0);
                assertSignatureHelp(4, 31, 'function getName(fruits as object, age as function)', 0);
            });

            it('gets signature info for the inner function - param 1 - function declartion', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello([getName([
                            "apple"
                            "pear"
                        ], function()
                            return 10
                        end function
                        )], 12)
                    end sub

                    sub sayHello(name as object, age as integer)
                    end sub

                    function getName(fruits as object, age as function)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(5, 31, 'function getName(fruits as object, age as function)', 1);
            });

            it('gets signature info for the inner function - param 1 - in anon function', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        sayHello([getName([
                            "apple"
                            "pear"
                        ], function()
                            return 10
                        end function
                        )], 12)
                    end sub

                    sub sayHello(name as object, age as integer)
                    end sub

                    function getName(fruits as object, age as function)
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(6, 31, 'function getName(fruits as object, age as function)', 1);
            });
        });

        describe('gets signature info for namespace function call', () => {
            it('gets signature info function - index 0', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        person.greeter.sayHello("hey", 12)
                    end sub
                    sub sayHello(notThisOne = true)
                    end sub
                    namespace person.greeter
                        sub sayHello(name as string, age as integer)
                        end sub
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 49, 'sub person.greeter.sayHello(name as string, age as integer)', 0);
            });

            it('gets signature info for the outer function - index 1', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        person.greeter.sayHello("hey", 12)
                    end sub
                    sub sayHello(notThisOne = true)
                    end sub
                    namespace person.greeter
                        sub sayHello(name as string, age as integer)
                        end sub
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
                assertSignatureHelp(2, 57, 'sub person.greeter.sayHello(name as string, age as integer)', 1);
            });
        });

        it('gets signature help for partially typed line', () => {
            program.setFile('source/main.bs', `
                function main()
                    thing@.test(a1
                end function
                function test(arg1, arg2, arg3)
                end function
                `);
            program.setFile('components/MyNode.bs', `
                function test(arg1, arg2, arg3)
                end function
                `);
            program.setFile<XmlFile>('components/MyNode.xml',
                trim`<?xml version="1.0" encoding="utf-8" ?>
            <component name="Component1" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/MyNode.bs" />
                <interface>
                    <function name="test"/>
                </interface>
            </component>`);
            program.validate();

            for (let col = 32; col < 33; col++) {
                let signatureHelp = (program.getSignatureHelp(`${rootDir}/source/main.bs`, Position.create(2, col)));
                expect(signatureHelp, `failed on col ${col}`).to.have.lengthOf(1);
                expect(signatureHelp[0].index, `failed on col ${col}`).to.equal(0);
            }
        });
    });

    describe('plugins', () => {
        it('emits file validation events', () => {
            const plugin = {
                name: 'test',
                beforeFileValidate: sinon.spy(),
                onFileValidate: sinon.spy(),
                afterFileValidate: sinon.spy()
            };
            program.plugins.add(plugin);
            program.setFile('source/main.brs', '');
            program.validate();
            expect(plugin.beforeFileValidate.callCount).to.equal(1);
            expect(plugin.onFileValidate.callCount).to.equal(1);
            expect(plugin.afterFileValidate.callCount).to.equal(1);
        });

        it('emits file validation events', () => {
            const plugin = {
                name: 'test',
                beforeFileValidate: sinon.spy(),
                onFileValidate: sinon.spy(),
                afterFileValidate: sinon.spy()
            };
            program.plugins.add(plugin);
            program.setFile('components/main.xml', '');
            program.validate();
            expect(plugin.beforeFileValidate.callCount).to.equal(1);
            expect(plugin.onFileValidate.callCount).to.equal(1);
            expect(plugin.afterFileValidate.callCount).to.equal(1);
        });

        it('emits program dispose event', () => {
            const plugin = {
                name: 'test',
                beforeProgramDispose: sinon.spy()
            };
            program.plugins.add(plugin);
            program.dispose();
            expect(plugin.beforeProgramDispose.callCount).to.equal(1);
        });
    });

    describe('getScopesForFile', () => {
        it('returns empty array when no scopes were found', () => {
            expect(program.getScopesForFile('does/not/exist')).to.eql([]);
        });
    });

    describe('findFilesForEnum', () => {
        it('finds files', () => {
            const file = program.setFile('source/main.bs', `
                enum Direction
                    up
                    down
                end enum
            `);
            expect(
                program.findFilesForEnum('Direction').map(x => x.srcPath)
            ).to.eql([
                file.srcPath
            ]);
        });
    });
});
