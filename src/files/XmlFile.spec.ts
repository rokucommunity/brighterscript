import { assert, expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';
import type { CompletionItem } from 'vscode-languageserver';
import { CompletionItemKind, Position, Range } from 'vscode-languageserver';
import * as fsExtra from 'fs-extra';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { BsDiagnostic, FileReference } from '../interfaces';
import { Program } from '../Program';
import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
import { standardizePath as s } from '../util';
import { expectDiagnostics, expectZeroDiagnostics, getTestTranspile, trim, trimMap } from '../testHelpers.spec';
import { ProgramBuilder } from '../ProgramBuilder';
import { LogLevel } from '../Logger';
import { isXmlFile } from '../astUtils/reflection';

describe('XmlFile', () => {
    const tempDir = s`${process.cwd()}/.tmp`;
    const rootDir = s`${tempDir}/rootDir`;
    const stagingDir = s`${tempDir}/stagingDir`;

    let program: Program;
    let sinon = sinonImport.createSandbox();
    let file: XmlFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(tempDir);
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
                    let child = file.parser.ast.component.children.children[0];
                    expect(child.attributes).to.have.lengthOf(4);
                    child.setAttribute('text', undefined);
                    expect(child.getAttribute('id').value.text).to.equal('one');
                    expect(child.attributes).to.have.lengthOf(3);
                    child.setAttribute('text3', undefined);
                    expect(child.getAttribute('id').value.text).to.equal('one');
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
            file = program.setFile({ src: `${rootDir}/components/custom.xml`, dest: 'components/custom.xml' }, trim`
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
            file = program.setFile({ src: `${rootDir}/components/custom.xml`, dest: 'components/custom.xml' }, trim`
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
            file = program.setFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: 'components/comp1.xml'
            }, trim`
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
            file = program.setFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: 'components/comp1.xml'
            }, trim`
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
            let xmlFile = program.setFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: 'components/comp1.xml'
            }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="HeroGrid.brs" />
                </component>
            `);
            let brsFile = program.setFile({
                src: `${rootDir}/components/HEROGRID.brs`,
                dest: `components/HEROGRID.brs`
            }, ``);
            expect((xmlFile as XmlFile).doesReferenceFile(brsFile)).to.be.true;
        });
    });

    describe('autoImportComponentScript', () => {
        it('is not enabled by default', () => {
            program.setFile({ src: `${rootDir}/components/comp1.xml`, dest: 'components/comp1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./lib.brs" />
                </component>
            `);

            program.setFile({ src: `${rootDir}/components/lib.brs`, dest: 'components/lib.brs' }, `
                function libFunc()
                end function
            `);

            program.setFile({ src: `${rootDir}/components/comp1.bs`, dest: 'components/comp1.bs' }, `
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
            program.setFile({ src: `${rootDir}/components/comp1.xml`, dest: 'components/comp1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./lib.brs" />
                </component>
            `);

            program.setFile({ src: `${rootDir}/components/lib.brs`, dest: 'components/lib.brs' }, `
                function libFunc()
                end function
            `);

            program.setFile({ src: `${rootDir}/components/comp1.bs`, dest: 'components/comp1.bs' }, `
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
            program.setFile({ src: `${rootDir}/components/Component1.brs`, dest: 'components/component1.brs' }, ``);
            expect(file.getCompletions(Position.create(99, 99))).to.be.empty;
        });

        //TODO - refine this test once cdata scripts are supported
        it('prevents scope completions entirely', () => {
            program.setFile({ src: `${rootDir}/components/Component1.brs`, dest: 'components/component1.brs' }, ``);

            let xmlFile = program.setFile({ src: `${rootDir}/components/Component1.xml`, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./Component1.brs" />
                </component>
            `);

            expect(program.getCompletions(xmlFile.pathAbsolute, Position.create(1, 1))).to.be.empty;
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
        program.setFile({
            src: `${rootDir}/source/lib.bs`,
            dest: `source/lib.bs`
        }, ``);
        //adding a dependent file should have invalidated the scope
        expect(scope.isValidated).to.be.false;
        program.validate();
        expect(scope.isValidated).to.be.true;

        //update lib1 to include an import
        program.setFile({
            src: `${rootDir}/source/lib.bs`,
            dest: `source/lib.bs`
        }, `
            import "lib2.bs"
        `);

        //scope should have been invalidated again
        expect(scope.isValidated).to.be.false;
        program.validate();
        expect(scope.isValidated).to.be.true;

        //add the lib2 imported from lib
        program.setFile({
            src: `${rootDir}/source/lib2.bs`,
            dest: `source/lib2.bs`
        }, ``);

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
        program.setFile({
            src: `${rootDir}/source/lib.brs`,
            dest: `source/lib.brs`
        }, ``);
        expect(program.getScopesForFile(xmlFile1)[0].isValidated).to.be.false;
        expect(program.getScopesForFile(xmlFile2)[0].isValidated).to.be.true;
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
        program.setFile({
            src: `${rootDir}/components/SimpleScene.bs`,
            dest: `components/SimpleScene.bs`
        }, '');
        program.setFile({
            src: `${rootDir}/components/SimpleScene.xml`,
            dest: `components/SimpleScene.xml`
        }, trim`
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
                retainStagingFolder: true,
                stagingFolderPath: stagingDir,
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
            `, null, 'components/comp.xml');
        });

        it('returns the XML unmodified if needsTranspiled is false', () => {
            let file = program.setFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
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
            let file = program.setFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" >
                </component>
            `);
            expect(file.needsTranspiled).to.be.false;
        });

        it('needsTranspiled is true if an import is brighterscript', () => {
            let file = program.setFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
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
            let file = program.setFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
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
            let file = program.setFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                </component>
            `);
            file.needsTranspiled = true;
            const code = file.transpile().code;
            expect(code.endsWith(`<!--//# sourceMappingURL=./SimpleScene.xml.map -->`)).to.be.true;
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
                if (file.pathAbsolute.endsWith('.xml')) {
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
            const scope = program.getComponentScope('ChildComponent');
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
            program.removeFile(typedef.pathAbsolute);

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
            expect(program.getComponent('comp1').file.pkgPath).to.equal(comp2.pkgPath);

            //add comp1. it should become the main component with this name
            const comp1 = program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Group">
                </component>
            `);
            expect(program.getComponent('comp1').file.pkgPath).to.equal(comp1.pkgPath);

            //remove comp1, comp2 should be the primary again
            program.removeFile(s`${rootDir}/components/comp1.xml`);
            expect(program.getComponent('comp1').file.pkgPath).to.equal(comp2.pkgPath);

            //add comp3
            program.setFile('components/comp3.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1">
                </component>
            `);
            //...the 2nd file should still be main
            expect(program.getComponent('comp1').file.pkgPath).to.equal(comp2.pkgPath);
        });
    });
});
