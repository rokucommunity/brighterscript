import { assert, expect } from '../chai-config.spec';
import { SourceMapConsumer } from 'source-map';
import * as path from 'path';
import * as sinonImport from 'sinon';
import type { CompletionItem } from 'vscode-languageserver';
import { CompletionItemKind, Position, Range, SymbolKind } from 'vscode-languageserver';
import * as fsExtra from 'fs-extra';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { BsDiagnostic, FileReference } from '../interfaces';
import { Program } from '../Program';
import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
import { standardizePath as s } from '../util';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile, trim, trimMap } from '../testHelpers.spec';
import { ProgramBuilder } from '../ProgramBuilder';
import { LogLevel } from '../logging';
import { isBrsFile, isXmlFile } from '../astUtils/reflection';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';

describe('XmlFile', () => {

    let program: Program;
    let sinon = sinonImport.createSandbox();
    let file: XmlFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        fsExtra.ensureDirSync(rootDir);
        fsExtra.ensureDirSync(stagingDir);
        program = new Program({ rootDir: rootDir });
        file = new XmlFile(`${rootDir}/components/MainComponent.xml`, 'components/MainComponent.xml', program);
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('parse', () => {
        it('allows modifying the parsed XML model', () => {
            const expected = 'OtherName';
            program.plugins.add({
                name: 'allows modifying the parsed XML model',
                afterFileParse: (file) => {
                    if (isXmlFile(file) && file.parser.ast.root?.attributes?.[0]?.value) {
                        file.parser.ast.root.attributes[0].value.text = expected;
                    }
                }
            });
            file = program.setFile('components/ChildScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                </component>
            `);
            expect(file.componentName.text).to.equal(expected);
        });

        it('only removes specified attribute when calling setAttribute', () => {
            file = new XmlFile('abs', 'rel', program);
            program.plugins.add({
                name: 'allows modifying the parsed XML model',
                afterFileParse: () => {
                    let child = file.parser.ast.component!.children.children[0];
                    expect(child.attributes).to.have.lengthOf(4);
                    child.setAttribute('text', undefined as any);
                    expect(child.getAttribute('id')!.value.text).to.equal('one');
                    expect(child.attributes).to.have.lengthOf(3);
                    child.setAttribute('text3', undefined as any);
                    expect(child.getAttribute('id')!.value.text).to.equal('one');
                    expect(child.attributes).to.have.lengthOf(2);
                }
            });
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                    <children>
                    <Label id="one"
                        text="two"
                        text2="three"
                        text3="four"
                    />
                    </children>
                </component>
            `);
        });

        it('supports importing BrighterScript files', () => {
            file = program.setFile('components/custom.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene.bs" />
                </component>
            `);
            expect(file.scriptTagImports.map(x => x.pkgPath)[0]).to.equal(
                s`components/ChildScene.bs`
            );
        });
        it('does not include commented-out script imports', () => {
            file = program.setFile('components/custom.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                    <!--
                        <script type="text/brightscript" uri="ChildScene.brs" />
                    -->
                </component>
            `);
            expect(
                file.scriptTagImports?.[0]?.pkgPath
            ).to.eql(
                s`components/ChildScene.brs`
            );
        });

        it('finds scripts when more than one per line', () => {
            file = new XmlFile('abs', 'rel', program);
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                </component>
            `);
            expect(file.scriptTagImports).to.be.lengthOf(3);
            expect(file.scriptTagImports[0]).to.deep.include(<FileReference>{
                text: 'ChildScene1.brs',
                filePathRange: Range.create(2, 42, 2, 57)
            });
            expect(file.scriptTagImports[1]).to.deep.include(<FileReference>{
                text: 'ChildScene2.brs',
                filePathRange: Range.create(2, 100, 2, 115)
            });
            expect(file.scriptTagImports[2]).to.deep.include(<FileReference>{
                text: 'ChildScene3.brs',
                filePathRange: Range.create(2, 158, 2, 173)
            });
        });

        it('finds component names', () => {
            file = new XmlFile('abs', 'rel', program);
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            expect(file.parentComponentName.text).to.equal('ParentScene');
            expect(file.componentName.text).to.equal('ChildScene');
        });

        it('Adds error when whitespace appears before the prolog', () => {
            file = new XmlFile('abs', 'rel', program);
            file.parse(/* not trimmed */`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                </component>`
            );
            expect(file.diagnostics).to.be.lengthOf(2);
            expect(file.diagnostics[0]).to.deep.include({ // expecting opening tag but got prolog
                code: DiagnosticMessages.xmlGenericParseError('').code,
                range: Range.create(1, 16, 1, 22)
            });
            expect(file.diagnostics[1]).to.deep.include({
                ...DiagnosticMessages.xmlGenericParseError('Syntax error: whitespace found before the XML prolog'),
                range: Range.create(0, 0, 1, 16)
            });
        });

        it('Adds error when an unknown tag is found in xml', () => {
            file = new XmlFile('abs', 'rel', program);
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                    <interface>
                        <unexpected />
                    </interface>
                    <unexpectedToo />
                </component>
            `);
            expect(file.diagnostics).to.be.lengthOf(2);
            expect(file.diagnostics[0]).to.deep.include({
                ...DiagnosticMessages.xmlUnexpectedTag('unexpected'),
                range: Range.create(3, 9, 3, 19)
            });
            expect(file.diagnostics[1]).to.deep.include({
                ...DiagnosticMessages.xmlUnexpectedTag('unexpectedToo'),
                range: Range.create(5, 5, 5, 18)
            });
        });

        it('Adds error when no component is declared in xml', () => {
            program.setFile('components/comp.xml', '<script type="text/brightscript" uri="ChildScene.brs" />');
            program.validate();
            expectDiagnostics(program, [
                {
                    ...DiagnosticMessages.xmlUnexpectedTag('script'),
                    range: Range.create(0, 1, 0, 7)
                },
                DiagnosticMessages.xmlComponentMissingComponentDeclaration()
            ]);
        });

        it('adds error when component does not declare a name', () => {
            file = program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component extends="ParentScene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            program.validate();
            expect(file.diagnostics).to.be.lengthOf(1);
            expect(file.diagnostics[0]).to.deep.include(<BsDiagnostic>{
                message: DiagnosticMessages.xmlComponentMissingNameAttribute().message,
                range: Range.create(1, 1, 1, 10)
            });
        });

        it('catches xml parse errors', () => {
            file = program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component 1extends="ParentScene">
                </component>
            `);
            program.validate();
            expect(file.diagnostics).to.be.lengthOf(2);
            expect(file.diagnostics[0].code).to.equal(DiagnosticMessages.xmlGenericParseError('').code); //unexpected character '1'
            expect(file.diagnostics[1]).to.deep.include(<BsDiagnostic>{
                code: DiagnosticMessages.xmlComponentMissingNameAttribute().code,
                range: Range.create(1, 1, 1, 10)
            });
        });

        it('finds script imports', () => {
            file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', program);
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/cmp1.brs" />
                </component>
            `);
            expect(file.scriptTagImports.length).to.equal(1);
            expect(file.scriptTagImports[0]).to.deep.include(<FileReference>{
                sourceFile: file,
                text: 'pkg:/components/cmp1.brs',
                pkgPath: `components${path.sep}cmp1.brs`,
                filePathRange: Range.create(2, 42, 2, 66)
            });
        });

        it('throws an error if the file has already been parsed', () => {
            file = new XmlFile('abspath', 'relpath', program);
            file.parse('a comment');
            try {
                file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('resolves relative paths', () => {
            file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="cmp1.brs" />
                </component>
            `);
            expect(file.scriptTagImports.length).to.equal(1);
            expect(file.scriptTagImports[0]).to.deep.include(<FileReference>{
                text: 'cmp1.brs',
                pkgPath: `components${path.sep}cmp1.brs`
            });
        });

        it('finds correct position for empty uri in script tag', () => {
            file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="" />
                </component>
            `);
            expect(file.scriptTagImports.length).to.equal(1);
            expect(file.scriptTagImports[0]?.filePathRange).to.eql(
                Range.create(2, 42, 2, 42)
            );
        });
    });

    describe('doesReferenceFile', () => {
        it('compares case insensitive', () => {
            let xmlFile = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="HeroGrid.brs" />
                </component>
            `);
            let brsFile = program.setFile(`components/HEROGRID.brs`, ``);
            expect((xmlFile as XmlFile).doesReferenceFile(brsFile)).to.be.true;
        });
    });

    describe('autoImportComponentScript', () => {
        it('is not enabled by default', () => {
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./lib.brs" />
                </component>
            `);

            program.setFile('components/lib.brs', `
                function libFunc()
                end function
            `);

            program.setFile('components/comp1.bs', `
                function init()
                    libFunc()
                end function
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.fileNotReferencedByAnyOtherFile()
            ]);
        });

        it('is not enabled by default', () => {
            program = new Program({
                rootDir: rootDir,
                autoImportComponentScript: true
            });
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./lib.brs" />
                </component>
            `);

            program.setFile('components/lib.brs', `
                function libFunc()
                end function
            `);

            program.setFile('components/comp1.bs', `
                function init()
                    libFunc()
                end function
            `);

            program.validate();

            //there should be no errors
            expectZeroDiagnostics(program);
        });
    });

    describe('getCompletions', () => {
        it('formats completion paths with proper slashes', () => {
            let scriptPath = s`C:/app/components/component1/component1.brs`;
            program.files[scriptPath] = new BrsFile(scriptPath, s`components/component1/component1.brs`, program);

            let xmlFile = new XmlFile(s`${rootDir}/components/component1/component1.xml`, s`components/component1/component1.xml`, <any>program);
            xmlFile.parser.references.scriptTagImports.push({
                pkgPath: s`components/component1/component1.brs`,
                text: 'component1.brs',
                filePathRange: Range.create(1, 1, 1, 1)
            });

            expect(xmlFile.getCompletions(Position.create(1, 1))[0]).to.include({
                label: 'component1.brs',
                kind: CompletionItemKind.File
            });

            expect(xmlFile.getCompletions(Position.create(1, 1))[1]).to.include(<CompletionItem>{
                label: 'pkg:/components/component1/component1.brs',
                kind: CompletionItemKind.File
            });
        });

        it('returns empty set when out of range', () => {
            program.setFile('components/component1.brs', ``);
            expect(file.getCompletions(Position.create(99, 99))).to.be.empty;
        });

        //TODO - refine this test once cdata scripts are supported
        it('prevents scope completions entirely', () => {
            program.setFile('components/component1.brs', ``);

            let xmlFile = program.setFile('components/component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./Component1.brs" />
                </component>
            `);

            expect(program.getCompletions(xmlFile.srcPath, Position.create(1, 1))).to.be.empty;
        });
    });

    describe('getAllDependencies', () => {
        it('returns own imports', () => {
            file = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="BaseScene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `);
            expect(file.getOwnDependencies().sort()).to.eql([
                s`source/lib.brs`,
                s`source/lib.d.bs`
            ]);
        });
    });

    it('invalidates dependent scopes on change', () => {
        let xmlFile = program.setFile<XmlFile>({
            src: `${rootDir}/components/comp1.xml`,
            dest: `components/comp1.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="BaseScene">
                <script type="text/brightscript" uri="pkg:/source/lib.bs" />
            </component>
        `);
        program.validate();
        let scope = program.getScopesForFile(xmlFile)[0];
        //scope should be validated
        expect(scope.isValidated);

        //add lib1
        program.setFile(`source/lib.bs`, ``);
        //adding a dependent file should have invalidated the scope
        expect(scope.isValidated).to.be.false;
        program.validate();
        expect(scope.isValidated).to.be.true;

        //update lib1 to include an import
        program.setFile(`source/lib.bs`, `
            import "lib2.bs"
        `);

        //scope should have been invalidated again
        expect(scope.isValidated).to.be.false;
        program.validate();
        expect(scope.isValidated).to.be.true;

        //add the lib2 imported from lib
        program.setFile(`source/lib2.bs`, ``);

        //scope should have been invalidated again because of chained dependency
        expect(scope.isValidated).to.be.false;
        program.validate();
        expect(scope.isValidated).to.be.true;

        program.removeFile(`${rootDir}/source/lib.bs`);
        expect(scope.isValidated).to.be.false;
    });

    it('does not invalidate unrelated scopes on change', () => {
        let xmlFile1 = program.setFile<XmlFile>({
            src: `${rootDir}/components/comp1.xml`,
            dest: `components/comp1.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene1" extends="BaseScene">
                <script type="text/brightscript" uri="pkg:/source/lib.brs" />
            </component>
        `);

        let xmlFile2 = program.setFile<XmlFile>({
            src: `${rootDir}/components/comp2.xml`,
            dest: `components/comp2.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene2" extends="BaseScene">
            </component>
        `);

        program.validate();
        //scope should be validated
        expect(program.getScopesForFile(xmlFile1)[0].isValidated).to.be.true;
        expect(program.getScopesForFile(xmlFile2)[0].isValidated).to.be.true;

        //add the lib file
        program.setFile(`source/lib.brs`, ``);
        expect(program.getScopesForFile(xmlFile1)[0].isValidated).to.be.false;
        expect(program.getScopesForFile(xmlFile2)[0].isValidated).to.be.true;
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

    describe('component extends', () => {
        it('works for single-line', () => {
            file = program.setFile(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene" extends="BaseScene">
                    </component>
                `
            );
            expect(file.parentComponentName.range).to.eql(Range.create(1, 38, 1, 47));
        });

        it('works for multi-line', () => {
            file = program.setFile(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene"
                        extends="BaseScene">
                    </component>
                `
            );
            expect(file.parentComponentName.range).to.eql(Range.create(2, 13, 2, 22));
        });

        it('does not throw when unable to find extends', () => {
            file = program.setFile(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene">
                    </component>
                `
            );
            expect(file.parentComponentName).to.not.exist;
        });

        it('adds warning when no "extends" attribute is found', () => {
            program.setFile<XmlFile>(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene">
                    </component>
                `
            );
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.xmlComponentMissingExtendsAttribute()
            ]);
        });
    });

    it('detects when importing the codebehind file unnecessarily', () => {
        program = new Program({
            autoImportComponentScript: true,
            rootDir: rootDir
        });
        program.setFile(`components/SimpleScene.bs`, '');
        program.setFile(`components/SimpleScene.xml`, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="SimpleScene" extends="Scene">
                <script type="text/brighterscript" uri="SimpleScene.bs" />
            </component>
        `);

        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.unnecessaryCodebehindScriptImport()
        ]);
    });

    describe('transpile', () => {
        it('handles single quotes properly', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="AnimationExample" extends="Scene">
                    <children>
                        <Animated frames='["pkg:/images/animation-1.png"]' />
                    </children>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="AnimationExample" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                    <children>
                        <Animated frames='["pkg:/images/animation-1.png"]' />
                    </children>
                </component>
            `, 'none', 'components/Comp.xml');
        });

        it('supports instantresume <customization> elements', async () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, '');
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `sub main()\nend sub`);
            fsExtra.outputFileSync(`${rootDir}/components/MainScene.xml`, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <customization resumehandler="customResume" />
                    <customization suspendhandler="customSuspend" />
                    <children>
                        <Rectangle width="1920" height="1080" />
                    </children>
                </component>
            `);
            const builder = new ProgramBuilder();
            await builder.run({
                cwd: rootDir,
                retainStagingDir: true,
                stagingDir: stagingDir,
                logLevel: LogLevel.off
            });
            expect(
                trim(
                    fsExtra.readFileSync(`${stagingDir}/components/MainScene.xml`).toString()
                )
            ).to.eql(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                    <children>
                        <Rectangle width="1920" height="1080" />
                    </children>
                    <customization resumehandler="customResume" />
                    <customization suspendhandler="customSuspend" />
                </component>
            `);
        });

        it(`honors the 'needsTranspiled' flag when set in 'afterFileParse'`, () => {
            program.plugins.add({
                name: 'test',
                afterFileParse: (file) => {
                    //enable transpile for every file
                    file.needsTranspiled = true;
                }
            });
            const file = program.setFile('components/file.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                </component>
            `);
            expect(file.needsTranspiled).to.be.true;
        });

        it('includes bslib script', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/Comp.xml');
        });

        it('does not include additional bslib script if already there ', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/child.xml');
        });

        it('does not include bslib script if already there from ropm', () => {
            program.setFile('source/roku_modules/bslib/bslib.brs', ``);
            program.setFile('source/lib.bs', ``);
            //include a bs file to force transpile for the xml file
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/lib.bs" />
                    <script type="text/brightscript" uri="pkg:/source/roku_modules/bslib/bslib.brs" />
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                    <script type="text/brightscript" uri="pkg:/source/roku_modules/bslib/bslib.brs" />
                </component>
            `, 'none', 'components/child.xml');
        });

        it('does not transpile xml file when bslib script is already present', () => {
            const file = program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Comp" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(file.needsTranspiled).to.be.false;
        });


        /**
         * There was a bug that would incorrectly replace one of the script paths on the second or third transpile, so this test verifies it doesn't do that anymore
         */
        it('does not mangle scripts on multiple transpile', async () => {
            program.setFile('components/SimpleScene.bs', ``);

            program.setFile(`components/SimpleScene.xml`, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script type="text/brightscript" uri="SimpleScene.bs" />
                </component>
            `);

            const expected = trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script type="text/brightscript" uri="SimpleScene.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `;

            await program.transpile([], stagingDir);
            expect(
                trim(
                    fsExtra.readFileSync(`${stagingDir}/components/SimpleScene.xml`).toString()
                )
            ).to.eql(expected);

            //clear the output folder
            fsExtra.emptyDirSync(stagingDir);
            await program.transpile([], stagingDir);
            expect(
                trim(
                    fsExtra.readFileSync(`${stagingDir}/components/SimpleScene.xml`).toString()
                )
            ).to.eql(expected);
        });

        it('keeps all content of the XML', () => {
            program.setFile(`components/SimpleScene.bs`, `
                sub b()
                end sub
            `);

            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component
                    name="SimpleScene" extends="Scene"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd"
                >
                    <interface>
                        <field id="a" type="string" />
                        <function name="b" />
                    </interface>
                    <script type="text/brightscript" uri="SimpleScene.bs"/>
                    <children>
                        <aa id="aa">
                            <bb id="bb" />
                        </aa>
                    </children>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd">
                    <interface>
                        <field id="a" type="string" />
                        <function name="b" />
                    </interface>
                    <script type="text/brightscript" uri="SimpleScene.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                    <children>
                        <aa id="aa">
                            <bb id="bb" />
                        </aa>
                    </children>
                </component>
            `, 'none', 'components/SimpleScene.xml');
        });

        it('changes file extensions from bs to brs', () => {
            program.setFile(`components/SimpleScene.bs`, `
                import "pkg:/source/lib.bs"
            `);
            program.setFile('source/lib.bs', ``);

            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script type="text/brighterscript" uri="SimpleScene.bs"/>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script type="text/brightscript" uri="SimpleScene.brs" />
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/SimpleScene.xml');
        });

        it('does not fail on missing script type', () => {
            program.setFile('components/SimpleScene.brs', '');
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script uri="SimpleScene.brs"/>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script uri="SimpleScene.brs" type="text/brightscript" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, null as any, 'components/comp.xml');
        });

        it('returns the XML unmodified if needsTranspiled is false', () => {
            let file = program.setFile('components/SimpleScene.xml',
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <!-- should stay as-is -->
                <component name="SimpleScene" extends="Scene" >
                <script type="text/brightscript" uri="SimpleScene.brs"/>
                </component>
            `);
            //prevent the default auto-imports to ensure no transpilation from AST
            (file as any).getMissingImportsForTranspile = () => [];
            expect(trimMap(file.transpile().code)).to.equal(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <!-- should stay as-is -->
                <component name="SimpleScene" extends="Scene" >
                <script type="text/brightscript" uri="SimpleScene.brs"/>
                </component>
            `);
        });

        it('needsTranspiled is false by default', () => {
            let file = program.setFile('components/SimpleScene.xml',
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" >
                </component>
            `);
            expect(file.needsTranspiled).to.be.false;
        });

        it('needsTranspiled is true if an import is brighterscript', () => {
            let file = program.setFile('components/SimpleScene.xml',
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" >
                    <script type="text/brightscript" uri="SimpleScene.bs"/>
                </component>
            `);
            expect(file.needsTranspiled).to.be.true;
        });

        it('simple source mapping includes sourcemap reference', () => {
            program.options.sourceMap = true;
            let file = program.setFile('components/SimpleScene.xml',
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                </component>
            `);
            //prevent the default auto-imports to ensure no transpilation from AST
            (file as any).getMissingImportsForTranspile = () => [];
            const code = file.transpile().code;
            expect(code.endsWith(`<!--//# sourceMappingURL=./SimpleScene.xml.map -->`)).to.be.true;
        });

        it('AST-based source mapping includes sourcemap reference', () => {
            program.options.sourceMap = true;
            let file = program.setFile('components/SimpleScene.xml',
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                </component>
            `);
            file.needsTranspiled = true;
            const code = file.transpile().code;
            expect(code.endsWith(`<!--//# sourceMappingURL=./SimpleScene.xml.map -->`)).to.be.true;
        });

        it('removes script imports if given file is not publishable', () => {
            program.options.pruneEmptyCodeFiles = true;
            program.setFile(`components/SimpleScene.bs`, `
                enum simplescenetypes
                    hero
                    intro
                end enum
            `);

            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component
                    name="SimpleScene" extends="Scene"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd"
                >
                    <script type="text/brightscript" uri="SimpleScene.bs"/>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd">
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/SimpleScene.xml');
        });

        it('removes extra imports found via dependencies if given file is not publishable', () => {
            program.options.pruneEmptyCodeFiles = true;
            program.setFile(`source/simplescenetypes.bs`, `
                enum SimpleSceneTypes
                    world = "world"
                end enum
            `);
            program.setFile(`components/SimpleScene.bs`, `
                import "pkg:/source/simplescenetypes.bs"

                sub init()
                    ? "Hello " + SimpleSceneTypes.world
                end sub
            `);

            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component
                    name="SimpleScene" extends="Scene"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd"
                >
                    <script type="text/brightscript" uri="SimpleScene.bs"/>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd">
                    <script type="text/brightscript" uri="SimpleScene.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/SimpleScene.xml');
        });

        it('removes imports of empty brightscript files', () => {
            program.options.pruneEmptyCodeFiles = true;
            program.setFile(`components/EmptyFile.brs`, '');
            program.setFile(`components/SimpleScene.brs`, `
                sub init()
                    ? "Hello World"
                end sub
            `);
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component
                    name="SimpleScene" extends="Scene"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd"
                >
                    <script type="text/brightscript" uri="SimpleScene.brs"/>
                    <script type="text/brightscript" uri="EmptyFile.brs"/>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd">
                    <script type="text/brightscript" uri="SimpleScene.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/SimpleScene.xml');
        });
    });

    describe('Transform plugins', () => {
        function parseFileWithPlugins(validateXml: (file: XmlFile) => void) {
            const rootDir = process.cwd();
            const program = new Program({
                rootDir: rootDir
            });
            program.plugins.add({
                name: 'Transform plugins',
                afterFileParse: file => validateXml(file as XmlFile)
            });
            file = program.setFile<XmlFile>('components/component.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                </component>
            `);
            program.validate();
            return file;
        }

        it('Calls XML file validation plugins', () => {
            const validateXml = sinon.spy();
            const file = parseFileWithPlugins(validateXml);
            expect(validateXml.callCount).to.be.greaterThan(0);
            expect(
                validateXml.getCalls().flatMap(x => x.args)
            ).to.include(file);
        });
    });

    it('plugin diagnostics work for xml files', () => {
        program.plugins.add({
            name: 'Xml diagnostic test',
            afterFileParse: (file) => {
                if (file.srcPath.endsWith('.xml')) {
                    file.addDiagnostics([{
                        file: file,
                        message: 'Test diagnostic',
                        range: Range.create(0, 0, 0, 0),
                        code: 9999
                    }]);
                }
            }
        });

        program.setFile('components/comp.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Cmp1" extends="Scene">
            </component>
        `);
        program.validate();
        expectDiagnostics(program, [{
            message: 'Test diagnostic',
            code: 9999
        }]);
    });

    describe('typedef', () => {
        it('loads d.bs files from parent scope', () => {
            program.setFile<XmlFile>('components/ParentComponent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentComponent" extends="Scene">
                    <script uri="ParentComponent.brs" />
                </component>
            `);

            program.setFile('components/ParentComponent.d.bs', `
                import "Lib.brs"
                namespace Parent
                    sub log()
                    end sub
                end namespace
            `);
            program.setFile('components/ParentComponent.brs', `
                sub Parent_log()
                end sub
            `);

            program.setFile('components/Lib.d.bs', `
                namespace Lib
                    sub log()
                    end sub
                end namespace
            `);
            program.setFile('components/Lib.brs', `
                sub Lib_log()
                end sub
            `);

            program.setFile<XmlFile>('components/ChildComponent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildComponent" extends="ParentComponent">
                    <script uri="ChildComponent.bs" />
                </component>
            `);
            program.setFile('components/ChildComponent.bs', `
                sub init()
                    Parent.log()
                    Lib.log()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const scope = program.getComponentScope('ChildComponent')!;
            expect([...scope.namespaceLookup.keys()].sort()).to.eql([
                'lib',
                'parent'
            ]);
        });

        it('loads `d.bs` files into scope', () => {
            const xmlFile = program.setFile<XmlFile>('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script uri="Component1.brs" />
                </component>
            `);
            program.setFile('components/Component1.d.bs', `
                sub logInfo()
                end sub
            `);

            expect(program.getScopesForFile(xmlFile)[0].getAllCallables().map(x => x.callable.name)).to.include('logInfo');
        });

        it('does not include `d.bs` script during transpile', () => {
            program.setFile('source/logger.d.bs', `
                sub logInfo()
                end sub
            `);
            program.setFile('source/logger.brs', `
                sub logInfo()
                end sub
            `);
            program.setFile('components/Component1.bs', `
                import "pkg:/source/logger.brs"
                sub init()
                end sub
            `);
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brighterscript" uri="Component1.bs" />
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script type="text/brightscript" uri="Component1.brs" />
                    <script type="text/brightscript" uri="pkg:/source/logger.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/Component1.xml');
        });

        it('does not load .brs information into scope if related d.bs is in scope', () => {
            const xmlFile = program.setFile<XmlFile>('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script uri="Component1.brs" />
                </component>
            `);
            const scope = program.getScopesForFile(xmlFile)[0];

            //load brs file
            program.setFile('components/Component1.brs', `
                sub logInfo()
                end sub
                sub logWarning()
                end sub
            `);

            let functionNames = scope.getAllCallables().map(x => x.callable.name);
            expect(functionNames).to.include('logInfo');
            expect(functionNames).to.include('logWarning');

            //load d.bs file, which should shadow out the .brs file
            program.setFile('components/Component1.d.bs', `
                sub logError()
                end sub
            `);

            functionNames = scope.getAllCallables().map(x => x.callable.name);
            expect(functionNames).to.include('logError');
            expect(functionNames).not.to.include('logInfo');
            expect(functionNames).not.to.include('logWarning');
        });

        it('updates xml scope when typedef disappears', () => {
            const xmlFile = program.setFile<XmlFile>('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script uri="Component1.brs" />
                </component>
            `);
            const scope = program.getScopesForFile(xmlFile)[0];

            //load brs file
            program.setFile('components/Component1.brs', `
                sub logBrs()
                end sub
            `);
            //load d.bs file, which should shadow out the .brs file
            const typedef = program.setFile('components/Component1.d.bs', `
                sub logTypedef()
                end sub
            `);
            program.validate();
            let functionNames = scope.getOwnCallables().map(x => x.callable.name);
            expect(functionNames).to.include('logTypedef');
            expect(functionNames).not.to.include('logBrs');

            //remove the typdef file
            program.removeFile(typedef.srcPath);

            program.validate();
            functionNames = scope.getOwnCallables().map(x => x.callable.name);
            expect(functionNames).not.to.include('logTypedef');
            expect(functionNames).to.include('logBrs');
        });
    });

    it('finds script imports for single-quoted script tags', () => {
        const file = program.setFile<XmlFile>('components/file.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Cmp1" extends="Scene">
                <script uri='SingleQuotedFile.brs' />
            </component>
        `);
        expect(file.scriptTagImports[0]?.text).to.eql('SingleQuotedFile.brs');
    });

    describe('commentFlags', () => {
        it('ignores warning from previous line comment', () => {
            //component without a name attribute
            program.setFile<XmlFile>('components/file.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <!--bs:disable-next-line-->
                <component>
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('ignores warning from previous line just for the specified code', () => {
            //component without a name attribute
            program.setFile<XmlFile>('components/file.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <!--bs:disable-next-line 1006-->
                <component>
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.xmlComponentMissingExtendsAttribute()
            ]);
        });

        it('ignores warning from previous line comment', () => {
            //component without a name attribute
            program.setFile<XmlFile>('components/file.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component> <!--bs:disable-line-->
                </component>
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('ignores warning from previous line just for the specified code', () => {
            //component without a name attribute
            program.setFile<XmlFile>('components/file.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component> <!--bs:disable-line 1006-->
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.xmlComponentMissingExtendsAttribute()
            ]);
        });
    });

    describe('duplicate components', () => {
        it('more gracefully handles multiple components with the same name', () => {
            program.setFile('components/comp1.brs', ``);
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Group">
                    <script uri="comp1.brs" />
                </component>
            `);
            //add another component with the same name
            program.setFile('components/comp2.brs', ``);
            program.setFile('components/comp2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Group">
                    <script uri="comp2.brs" />
                </component>
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.duplicateComponentName('comp1'),
                DiagnosticMessages.duplicateComponentName('comp1')
            ]);
        });

        it('maintains consistent component selection', () => {
            //add comp2 first
            const comp2 = program.setFile('components/comp2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1">
                </component>
            `);
            expect(program.getComponent('comp1')!.file.pkgPath).to.equal(comp2.pkgPath);

            //add comp1. it should become the main component with this name
            const comp1 = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Group">
                </component>
            `);
            expect(program.getComponent('comp1')!.file.pkgPath).to.equal(comp1.pkgPath);

            //remove comp1, comp2 should be the primary again
            program.removeFile(s`${rootDir}/components/comp1.xml`);
            expect(program.getComponent('comp1')!.file.pkgPath).to.equal(comp2.pkgPath);

            //add comp3
            program.setFile('components/comp3.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1">
                </component>
            `);
            //...the 2nd file should still be main
            expect(program.getComponent('comp1')!.file.pkgPath).to.equal(comp2.pkgPath);
        });
    });

    describe('inline CDATA scripts', () => {

        it('registers a synthetic BrsFile for a brightscript CDATA block', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            expect(xmlFile.inlineScriptPkgPaths).to.eql(['components/MyComp.cdata-0.script.brs']);
            const syntheticFile = program.getFile<BrsFile>('components/MyComp.cdata-0.script.brs');
            expect(syntheticFile).to.exist;
            expect(syntheticFile.isSynthetic).to.be.true;
        });

        it('registers a synthetic .bs file when type is text/brighterscript', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            expect(xmlFile.inlineScriptPkgPaths).to.eql(['components/MyComp.cdata-0.script.bs']);
            expect(program.getFile('components/MyComp.cdata-0.script.bs')).to.exist;
        });

        it('registers a synthetic .bs file when type is text/bs', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/bs"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            expect(xmlFile.inlineScriptPkgPaths).to.eql(['components/MyComp.cdata-0.script.bs']);
            expect(program.getFile('components/MyComp.cdata-0.script.bs')).to.exist;
        });

        it('does NOT treat text/brightscript as brighterscript', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            expect(xmlFile.inlineScriptPkgPaths[0]).to.equal('components/MyComp.cdata-0.script.brs');
        });

        it('indexes multiple CDATA blocks independently', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function a()
                        end function
                    ]]></script>
                    <script type="text/brighterscript"><![CDATA[
                        function b()
                        end function
                    ]]></script>
                </component>
            `);
            expect(xmlFile.inlineScriptPkgPaths).to.eql([
                'components/MyComp.cdata-0.script.brs',
                'components/MyComp.cdata-1.script.bs'
            ]);
            expect(program.getFile('components/MyComp.cdata-0.script.brs')).to.exist;
            expect(program.getFile('components/MyComp.cdata-1.script.bs')).to.exist;
        });

        it('transpile preserves CDATA blocks inline in the xml output', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('transpile preserves mixed uri and CDATA scripts inline preserving order', () => {
            program.setFile('components/helper.brs', '');
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript" uri="./helper.brs" />
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript" uri="./helper.brs" />
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('transpile transforms ternary expressions in brighterscript CDATA', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        sub init()
                            x = true ? "yes" : "no"
                        end sub
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[sub init()
                    if true then
                        x = "yes"
                    else
                        x = "no"
                    end if
                end sub]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('transpile inlines enum values in brighterscript CDATA', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        enum Direction
                            up = "up"
                            down = "down"
                        end enum
                        sub init()
                            d = Direction.up
                        end sub
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[

                sub init()
                    d = "up"
                end sub]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('transpile flattens namespaces in brighterscript CDATA', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        namespace util
                            sub greet(name as string)
                                print "Hello " + name
                            end sub
                        end namespace
                        sub init()
                            util.greet("world")
                        end sub
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[sub util_greet(name as string)
                    print "Hello " + name
                end sub

                sub init()
                    util_greet("world")
                end sub]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('transpile inlines const values in brighterscript CDATA', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        const MAX_RETRIES = 3
                        sub init()
                            print MAX_RETRIES
                        end sub
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[

                sub init()
                    print 3
                end sub]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('transpile transforms null coalescing in brighterscript CDATA', () => {
            testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        sub init()
                            x = m.value ?? "default"
                        end sub
                    ]]></script>
                </component>
            `, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[sub init()
                    x = (function(m)
                            __bsConsequent = m.value
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return "default"
                            end if
                        end function)(m)
                end sub]]></script>
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/MyComp.xml');
        });

        it('source map points back to original xml positions for plain brs CDATA', async () => {
            // Generated output (1-based lines):
            //   3: "    <script type="text/brightscript"><![CDATA["
            //   4: "        sub init()"   ← col 0 → source line 4, col 0
            //   5: "        end sub"      ← col 0 → source line 5, col 0
            const xmlFile = program.setFile<XmlFile>({ src: s`${rootDir}/components/MyComp.xml`, dest: 'components/MyComp.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        sub init()
                        end sub
                    ]]></script>
                </component>
            `);
            program.options.sourceMap = true;
            program.validate();
            const result = xmlFile.transpile();
            expect(result.map).to.exist;

            await SourceMapConsumer.with(result.map.toJSON(), null, (consumer) => {
                // raw CDATA lines map at col 0 back to the same line in the xml source
                const subPos = consumer.originalPositionFor({ line: 4, column: 0 });
                expect(subPos.source).to.include('MyComp.xml');
                expect(subPos.line).to.equal(4);
                expect(subPos.column).to.equal(0);

                const endSubPos = consumer.originalPositionFor({ line: 5, column: 0 });
                expect(endSubPos.source).to.include('MyComp.xml');
                expect(endSubPos.line).to.equal(5);
                expect(endSubPos.column).to.equal(0);
            });
        });

        it('source map points back to xml positions for transpiled brighterscript CDATA', async () => {
            // Generated output (1-based lines):
            //   3: "    <script ...><![CDATA[sub init()"  ← 'sub' at col 46 → source (4, 8)
            //   4: "    if true then"                     ← col 4           → source (5, 21) (ternary)
            //   5: "        x = \"yes\""                  ← col 8           → source (5, 12)
            const xmlFile = program.setFile<XmlFile>({ src: s`${rootDir}/components/MyComp.xml`, dest: 'components/MyComp.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        sub init()
                            x = true ? "yes" : "no"
                        end sub
                    ]]></script>
                </component>
            `);
            program.options.sourceMap = true;
            program.validate();
            const result = xmlFile.transpile();
            expect(result.map).to.exist;
            // only the xml file should appear in sources — not the synthetic brs file
            expect(result.map.toJSON().sources).to.eql([s`${rootDir}/components/MyComp.xml`]);

            await SourceMapConsumer.with(result.map.toJSON(), null, (consumer) => {
                // 'sub' is on gen line 3 right after '<![CDATA[' at col 46
                const subPos = consumer.originalPositionFor({ line: 3, column: 46 });
                expect(subPos.source).to.include('MyComp.xml');
                expect(subPos.line).to.equal(4); // source line 4 (1-based) in the xml
                expect(subPos.column).to.equal(8);

                // the true branch 'x = "yes"' is on gen line 5 col 8, maps back to the ternary 'x' at source (5, 12)
                const xPos = consumer.originalPositionFor({ line: 5, column: 8 });
                expect(xPos.source).to.include('MyComp.xml');
                expect(xPos.line).to.equal(5);
                expect(xPos.column).to.equal(12);
            });
        });

        it('source map points back to xml positions for transpiled enum values in CDATA', async () => {
            // Generated output (1-based lines):
            //   5: "sub init()"       ← col 0 → source (7, 8)
            //   6: "    d = \"up\""   ← col 4 → source (8, 12)
            //   7: "end sub]]>..."    ← col 0 → source (9, 8)
            const xmlFile = program.setFile<XmlFile>({ src: s`${rootDir}/components/MyComp.xml`, dest: 'components/MyComp.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brighterscript"><![CDATA[
                        enum Direction
                            up = "up"
                        end enum
                        sub init()
                            d = Direction.up
                        end sub
                    ]]></script>
                </component>
            `);
            program.options.sourceMap = true;
            program.validate();
            const result = xmlFile.transpile();
            expect(result.map).to.exist;
            expect(result.map.toJSON().sources).to.eql([s`${rootDir}/components/MyComp.xml`]);

            await SourceMapConsumer.with(result.map.toJSON(), null, (consumer) => {
                // 'sub' on gen line 5 col 0 → source (7, 8)
                const subPos = consumer.originalPositionFor({ line: 5, column: 0 });
                expect(subPos.source).to.include('MyComp.xml');
                expect(subPos.line).to.equal(7);
                expect(subPos.column).to.equal(8);

                // 'd' on gen line 6 col 4 → source (8, 12)
                const dPos = consumer.originalPositionFor({ line: 6, column: 4 });
                expect(dPos.source).to.include('MyComp.xml');
                expect(dPos.line).to.equal(8);
                expect(dPos.column).to.equal(12);
            });
        });

        it('cleans up synthetic files when the xml file is removed', () => {
            program.setFile('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            expect(program.getFile('components/MyComp.cdata-0.script.brs')).to.exist;
            program.removeFile(s`${rootDir}/components/MyComp.xml`);
            expect(program.getFile('components/MyComp.cdata-0.script.brs')).to.not.exist;
        });

        it('replaces old synthetic files when the xml file is re-parsed', () => {
            program.setFile('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            const firstFile = program.getFile('components/MyComp.cdata-0.script.brs');
            expect(firstFile).to.exist;

            //re-set with different cdata content
            program.setFile('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                            print "updated"
                        end function
                    ]]></script>
                </component>
            `);
            const secondFile = program.getFile<BrsFile>('components/MyComp.cdata-0.script.brs');
            expect(secondFile).to.exist;
            //a new BrsFile object should have been created
            expect(secondFile).to.not.equal(firstFile);
        });

        it('includes the synthetic file in scope dependencies', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            const deps = xmlFile.getOwnDependencies();
            expect(deps.some(d => d.includes('cdata-0.script.brs'))).to.be.true;
        });

        it('validates code inside CDATA blocks and remaps diagnostics to the xml file', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                            undeclaredVar = unknownFunction()
                        end function
                    ]]></script>
                </component>
            `);
            program.validate();
            const allDiagnostics = program.getDiagnostics();
            //diagnostics from the CDATA block should be remapped to the parent xml file, not the synthetic file
            expect(allDiagnostics.some(d => d.file.pkgPath === xmlFile.pkgPath)).to.be.true;
            expect(allDiagnostics.every(d => d.file.pkgPath !== 'components/MyComp.cdata-0.script.brs')).to.be.true;
            //the reported position should be within the xml file's line range (not line 1 of a standalone brs file)
            const cdataDiagnostics = allDiagnostics.filter(d => d.file.pkgPath === xmlFile.pkgPath);
            expect(cdataDiagnostics.every(d => d.range.start.line > 2)).to.be.true;
        });

        it('sets needsTranspiled on the xml file when CDATA is present', () => {
            const xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MyComp" extends="Scene">
                    <script type="text/brightscript"><![CDATA[
                        function init()
                        end function
                    ]]></script>
                </component>
            `);
            expect(xmlFile.needsTranspiled).to.be.true;
        });

        describe('LSP event remapping', () => {
            // After trim, the file looks like:
            //   line 0: <?xml version="1.0" encoding="utf-8" ?>
            //   line 1: <component name="MyComp" extends="Scene">
            //   line 2:     <script type="text/brightscript"><![CDATA[   <- cdataStartLine=2, cdataStartChar=37
            //   line 3:         sub greet(name as string)
            //   line 4:             print name
            //   line 5:         end sub
            //   line 6:         function getCount() as integer
            //   line 7:             return 42
            //   line 8:         end function
            //   line 9:     ]]></script>
            //   line 10: </component>
            const cdataStartLine = 2;

            let xmlFile: XmlFile;
            beforeEach(() => {
                xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="MyComp" extends="Scene">
                        <script type="text/brightscript"><![CDATA[
                            sub greet(name as string)
                                print name
                            end sub
                            function getCount() as integer
                                return 42
                            end function
                        ]]></script>
                    </component>
                `);
                program.validate();
            });

            it('getCompletions returns BrightScript completions inside CDATA', () => {
                // position cursor at `name` usage on line 4 col 20 (inside "name")
                const completions = program.getCompletions(xmlFile.srcPath, Position.create(4, 20));
                expect(completions.map(c => c.label)).to.include('name');
            });

            it('getCompletions returns empty outside CDATA', () => {
                // position inside the <component> tag (line 1), not in CDATA
                const completions = program.getCompletions(xmlFile.srcPath, Position.create(1, 5));
                expect(completions).to.be.empty;
            });

            it('getHover returns hover info for a function inside CDATA', () => {
                // hover over `greet` at line 3 col 12
                const hovers = program.getHover(xmlFile.srcPath, Position.create(3, 12));
                expect(hovers).to.have.length.greaterThan(0);
            });

            it('getHover remaps the hover range to XML coordinates', () => {
                // hover over `greet` at line 3 col 12
                const hovers = program.getHover(xmlFile.srcPath, Position.create(3, 12));
                for (const hover of hovers) {
                    if (hover.range) {
                        // range must be within the CDATA block in XML coordinates, not synthetic line 0
                        expect(hover.range.start.line).to.be.at.least(cdataStartLine);
                    }
                }
            });

            it('getDefinition returns a location inside the XML file for a symbol in CDATA', () => {
                // go-to-definition on `greet` reference (line 3, col 12 is the definition site itself)
                // use getCount call from synthetic line 0 edge case — instead hover greet on its def line
                const locations = program.getDefinition(xmlFile.srcPath, Position.create(3, 12));
                expect(locations).to.have.length.greaterThan(0);
                for (const loc of locations) {
                    // all returned locations must use the xml file URI
                    expect(loc.uri).to.include('MyComp.xml');
                    // and be within the CDATA block line range
                    expect(loc.range.start.line).to.be.at.least(cdataStartLine);
                }
            });

            it('getReferences returns locations in XML coordinates', () => {
                // find references of the `name` parameter — position inside the word (not at the start)
                // line 3: `        sub greet(name as string)` — `name` starts at col 18, use col 20 (inside)
                const refs = program.getReferences(xmlFile.srcPath, Position.create(3, 20));
                expect(refs).to.have.length.greaterThan(0);
                for (const ref of refs) {
                    expect(ref.uri).to.include('MyComp.xml');
                    expect(ref.range.start.line).to.be.at.least(cdataStartLine);
                }
            });

            it('getSemanticTokens returns tokens with XML-file coordinates', () => {
                // Use a .bs CDATA block with namespace+class to generate semantic tokens
                const bsXmlFile = program.setFile<XmlFile>('components/BsComp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="BsComp" extends="Scene">
                        <script type="text/brighterscript"><![CDATA[
                            namespace MyNs
                                class Greeter
                                end class
                            end namespace
                            sub init()
                                x = new MyNs.Greeter()
                            end sub
                        ]]></script>
                    </component>
                `);
                program.validate();
                const tokens = program.getSemanticTokens(bsXmlFile.srcPath);
                expect(tokens).to.exist;
                expect(tokens).to.have.length.greaterThan(0);
                for (const token of tokens) {
                    // all tokens must be inside the CDATA block (line 2+ in XML)
                    expect(token.range.start.line).to.be.at.least(cdataStartLine + 1);
                }
            });

            it('getDocumentSymbols returns function symbols with XML-file coordinates', () => {
                const symbols = program.getDocumentSymbols(xmlFile.srcPath);
                expect(symbols).to.exist;
                const names = symbols.map(s => s.name);
                expect(names).to.include('greet');
                expect(names).to.include('getCount');
                for (const sym of symbols) {
                    if (sym.name === 'greet' || sym.name === 'getCount') {
                        expect(sym.kind).to.equal(SymbolKind.Function);
                        // symbol range must start inside the CDATA block
                        expect(sym.range.start.line).to.be.at.least(cdataStartLine + 1);
                    }
                }
            });

            it('getSignatureHelp returns signature for a function call inside CDATA', () => {
                // Add a call site so we can test signature help
                xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="MyComp" extends="Scene">
                        <script type="text/brightscript"><![CDATA[
                            sub greet(name as string)
                            end sub
                            sub init()
                                greet(
                            end sub
                        ]]></script>
                    </component>
                `);
                program.validate();
                // line 6 is `            greet(` — `(` is at col 17, col 18 is inside the arg list
                const sigHelp = program.getSignatureHelp(xmlFile.srcPath, Position.create(6, 18));
                expect(sigHelp).to.have.length.greaterThan(0);
                expect(sigHelp[0].signature.label).to.include('greet');
            });

            it('getCodeActions workspace edits reference the XML file URI', () => {
                // use a range inside the CDATA block (line 3 = `sub greet(name as string)`)
                const actions = program.getCodeActions(xmlFile.srcPath, Range.create(3, 8, 3, 30));
                // if any code action has workspace edits, they must target the xml file
                for (const action of actions) {
                    if (action.edit?.changes) {
                        for (const uri of Object.keys(action.edit.changes)) {
                            expect(uri).to.include('MyComp.xml');
                        }
                    }
                    if (action.edit?.documentChanges) {
                        for (const change of action.edit.documentChanges) {
                            if ('textDocument' in change) {
                                expect(change.textDocument.uri).to.include('MyComp.xml');
                            }
                        }
                    }
                }
            });

            it('hover works when CDATA content starts on the same line as the opening marker', () => {
                // The synthetic BrsFile is padded so its positions match XML coordinates directly.
                // When content starts inline with <![CDATA[, the first token sits at the same
                // line/column as in the XML file — no coordinate transformation needed.
                const inlineFile = program.setFile<XmlFile>('components/Inline.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Inline" extends="Scene">
                        <script type="text/brightscript"><![CDATA[sub init()
                        end sub]]></script>
                    </component>
                `);
                program.validate();
                // `<![CDATA[` starts at col 37, so content starts at col 46.
                // `init` is after `sub `, so at col 46 + 4 = 50 on XML line 2.
                const hovers = program.getHover(inlineFile.srcPath, Position.create(2, 50));
                expect(hovers).to.have.length.greaterThan(0);
                for (const hover of hovers) {
                    if (hover.range) {
                        expect(hover.range.start.line).to.equal(cdataStartLine);
                    }
                }
            });
        });

        describe('synthetic file plugin context', () => {
            // Verifies that emitWithSyntheticFileContext sets _cdataDiagnosticsContext for
            // every plugin event that fires with a synthetic BrsFile as event.file, so that
            // plugins calling program.getDiagnostics() from inside the handler get results
            // where x.file === event.file holds (diagnostics not yet remapped to the XmlFile).

            let xmlFile: XmlFile;

            beforeEach(() => {
                xmlFile = program.setFile<XmlFile>('components/MyComp.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="MyComp" extends="Scene">
                        <script type="text/brightscript"><![CDATA[
                            function init()
                                undeclaredVar = unknownFunction()
                            end function
                        ]]></script>
                    </component>
                `);
                program.validate();
            });

            // Note: afterFileParse cannot be covered here because isSynthetic is set on the
            // BrsFile *after* setFile() returns, which is after afterFileParse fires. So the
            // emitWithSyntheticFileContext wrapper cannot identify the file as synthetic at
            // that point. This is a known limitation.

            it('onFileValidate: _cdataDiagnosticsContext is set to the synthetic BrsFile during the event', () => {
                // onFileValidate fires during the validation pass, before scope diagnostics are
                // produced. We verify the context flag is set so getDiagnostics() would scope
                // correctly if called by a plugin.
                let contextFileInsideHandler: BrsFile | undefined;
                program.plugins.add({
                    name: 'test',
                    onFileValidate: function(event) {
                        if (isBrsFile(event.file) && event.file.isSynthetic) {
                            contextFileInsideHandler = (program as any)._cdataDiagnosticsContext;
                        }
                    }
                });
                program.setFile('components/MyComp.xml', xmlFile.fileContents);
                program.validate();
                expect(contextFileInsideHandler).to.exist;
                expect((contextFileInsideHandler as BrsFile).isSynthetic).to.be.true;
            });

            it('provideDocumentSymbols: program.getDiagnostics() inside handler associates diagnostics with the synthetic BrsFile', () => {
                let fileIdentityWorked = false;
                program.plugins.add({
                    name: 'test',
                    provideDocumentSymbols: function(event) {
                        if (isBrsFile(event.file) && (event.file as BrsFile).isSynthetic) {
                            const diags = program.getDiagnostics()
                                .filter(x => x.file === event.file);
                            if (diags.length > 0) {
                                fileIdentityWorked = true;
                            }
                        }
                    }
                });
                program.getDocumentSymbols(xmlFile.srcPath);
                expect(fileIdentityWorked).to.be.true;
            });

            it('onGetSemanticTokens: program.getDiagnostics() inside handler associates diagnostics with the synthetic BrsFile', () => {
                let fileIdentityWorked = false;
                program.plugins.add({
                    name: 'test',
                    onGetSemanticTokens: function(event) {
                        if (isBrsFile(event.file) && (event.file as BrsFile).isSynthetic) {
                            const diags = program.getDiagnostics()
                                .filter(x => x.file === event.file);
                            if (diags.length > 0) {
                                fileIdentityWorked = true;
                            }
                        }
                    }
                });
                program.getSemanticTokens(xmlFile.srcPath);
                expect(fileIdentityWorked).to.be.true;
            });

            it('onGetCodeActions: program.getDiagnostics() inside handler supports "fix all" pattern across multiple CDATA diagnostics', () => {
                // Two `then` violations in one CDATA block — simulate the bslint "fix all" pattern
                const twoThenFile = program.setFile<XmlFile>('components/TwoThen.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="TwoThen" extends="Scene">
                        <script type="text/brightscript"><![CDATA[
                            function a() : end function
                            function b() : end function
                        ]]></script>
                    </component>
                `);
                program.validate();
                const twoThenSynthetic = program.getFile<BrsFile>('components/TwoThen.cdata-0.script.brs');

                // Simulate plugin calling getDiagnostics() filtered by event.file identity
                const fixAllDiagsFoundBySyntheticIdentity: BsDiagnostic[][] = [];
                program.plugins.add({
                    name: 'test',
                    onGetCodeActions: function(event) {
                        if (event.file === twoThenSynthetic) {
                            // This is exactly the pattern a "fix all" plugin would use
                            const allInFile = program.getDiagnostics()
                                .filter(x => x.file === event.file);
                            fixAllDiagsFoundBySyntheticIdentity.push(allInFile);
                        }
                    }
                });

                // trigger inside first function range
                program.getCodeActions(twoThenFile.srcPath, Range.create(3, 12, 3, 12));

                // the plugin must have seen diagnostics associated with the synthetic BrsFile
                expect(fixAllDiagsFoundBySyntheticIdentity.length).to.be.greaterThan(0);
                // and all returned diagnostics must reference the synthetic file, not the xml file
                for (const group of fixAllDiagsFoundBySyntheticIdentity) {
                    for (const d of group) {
                        expect(d.file).to.equal(twoThenSynthetic, 'expected diagnostic.file to be the synthetic BrsFile, not the XmlFile');
                    }
                }
            });
        });
    });
});

