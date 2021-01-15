import { assert, expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';
import type { CompletionItem } from 'vscode-languageserver';
import { CompletionItemKind, Position, Range, DiagnosticSeverity } from 'vscode-languageserver';

import { DiagnosticMessages } from '../DiagnosticMessages';
import type { BsDiagnostic, FileReference } from '../interfaces';
import { Program } from '../Program';
import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
import { standardizePath as s } from '../util';
import { getTestTranspile } from './BrsFile.spec';
import { trim, trimMap } from '../testHelpers.spec';

describe('XmlFile', () => {
    let rootDir = process.cwd();
    let program: Program;
    let sinon = sinonImport.createSandbox();
    let file: XmlFile;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
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
            file = new XmlFile('abs', 'rel', program);
            program.plugins.add({
                name: 'allows modifying the parsed XML model',
                afterFileParse: () => {
                    file.parser.ast.root.attributes[0].value.text = expected;
                }
            });
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                </component>
            `);
            expect(file.componentName.text).to.equal(expected);
        });

        it('supports importing BrighterScript files', async () => {
            file = await program.addOrReplaceFile({ src: `${rootDir}/components/custom.xml`, dest: 'components/custom.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene.bs" />
                </component>
            `);
            expect(file.scriptTagImports.map(x => x.pkgPath)[0]).to.equal(
                s`components/ChildScene.bs`
            );
        });
        it('does not include commented-out script imports', async () => {
            file = await program.addOrReplaceFile({ src: `${rootDir}/components/custom.xml`, dest: 'components/custom.xml' }, trim`
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
            file = new XmlFile('abs', 'rel', program);
            file.parse('<script type="text/brightscript" uri="ChildScene.brs" />');
            expect(file.diagnostics).to.be.lengthOf(2);
            expect(file.diagnostics[0]).to.deep.include({
                ...DiagnosticMessages.xmlUnexpectedTag('script'),
                range: Range.create(0, 1, 0, 7)
            });
            expect(file.diagnostics[1]).to.deep.include(
                DiagnosticMessages.xmlComponentMissingComponentDeclaration()
            );
        });

        it('adds error when component does not declare a name', () => {
            file = new XmlFile('abs', 'rel', program);
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component extends="ParentScene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            expect(file.diagnostics).to.be.lengthOf(1);
            expect(file.diagnostics[0]).to.deep.include(<BsDiagnostic>{
                message: DiagnosticMessages.xmlComponentMissingNameAttribute().message,
                range: Range.create(1, 1, 1, 10)
            });
        });

        it('catches xml parse errors', () => {
            file = new XmlFile('abs', 'rel', program);
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component 1extends="ParentScene">
                </component>
            `);
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

        it('resolves relative paths', async () => {
            file = await program.addOrReplaceFile({
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

        it('finds correct position for empty uri in script tag', async () => {
            file = await program.addOrReplaceFile({
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
        it('compares case insensitive', async () => {
            let xmlFile = await program.addOrReplaceFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: 'components/comp1.xml'
            }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="HeroGrid.brs" />
                </component>
            `);
            let brsFile = await program.addOrReplaceFile({
                src: `${rootDir}/components/HEROGRID.brs`,
                dest: `components/HEROGRID.brs`
            }, ``);
            expect((xmlFile as XmlFile).doesReferenceFile(brsFile)).to.be.true;
        });
    });

    describe('autoImportComponentScript', () => {
        it('is not enabled by default', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/comp1.xml`, dest: 'components/comp1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./lib.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/lib.brs`, dest: 'components/lib.brs' }, `
                function libFunc()
                end function
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/comp1.bs`, dest: 'components/comp1.bs' }, `
                function init()
                    libFunc()
                end function
            `);

            await program.validate();

            expect(
                program.getDiagnostics().map(x => x.message)
            ).to.include(
                DiagnosticMessages.fileNotReferencedByAnyOtherFile().message
            );
        });

        it('is not enabled by default', async () => {
            program = new Program({
                rootDir: rootDir,
                autoImportComponentScript: true
            });
            await program.addOrReplaceFile({ src: `${rootDir}/components/comp1.xml`, dest: 'components/comp1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./lib.brs" />
                </component>
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/lib.brs`, dest: 'components/lib.brs' }, `
                function libFunc()
                end function
            `);

            await program.addOrReplaceFile({ src: `${rootDir}/components/comp1.bs`, dest: 'components/comp1.bs' }, `
                function init()
                    libFunc()
                end function
            `);

            await program.validate();

            //there should be no errors
            expect(
                program.getDiagnostics().map(x => x.message)[0]
            ).not.to.exist;
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

        it('returns empty set when out of range', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/Component1.brs`, dest: 'components/component1.brs' }, ``);
            expect(file.getCompletions(Position.create(99, 99))).to.be.empty;
        });

        //TODO - refine this test once cdata scripts are supported
        it('prevents scope completions entirely', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/Component1.brs`, dest: 'components/component1.brs' }, ``);

            let xmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/Component1.xml`, dest: 'components/component1.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./Component1.brs" />
                </component>
            `);

            expect(program.getCompletions(xmlFile.pathAbsolute, Position.create(1, 1))).to.be.empty;
        });
    });

    describe('getAllDependencies', () => {
        it('returns own imports', async () => {
            file = await program.addOrReplaceFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="BaseScene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `) as any;
            expect(file.getOwnDependencies().sort()).to.eql([
                s`source/lib.brs`,
                s`source/lib.d.bs`
            ]);
        });
    });

    it('invalidates dependent scopes on change', async () => {
        let xmlFile = await program.addOrReplaceFile<XmlFile>({
            src: `${rootDir}/components/comp1.xml`,
            dest: `components/comp1.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="BaseScene">
                <script type="text/brightscript" uri="pkg:/source/lib.bs" />
            </component>
        `);
        await program.validate();
        let scope = program.getScopesForFile(xmlFile)[0];
        //scope should be validated
        expect(scope.isValidated);

        //add lib1
        await program.addOrReplaceFile({
            src: `${rootDir}/source/lib.bs`,
            dest: `source/lib.bs`
        }, ``);
        //adding a dependent file should have invalidated the scope
        expect(scope.isValidated).to.be.false;
        await program.validate();
        expect(scope.isValidated).to.be.true;

        //update lib1 to include an import
        await program.addOrReplaceFile({
            src: `${rootDir}/source/lib.bs`,
            dest: `source/lib.bs`
        }, `
            import "lib2.bs"
        `);

        //scope should have been invalidated again
        expect(scope.isValidated).to.be.false;
        await program.validate();
        expect(scope.isValidated).to.be.true;

        //add the lib2 imported from lib
        await program.addOrReplaceFile({
            src: `${rootDir}/source/lib2.bs`,
            dest: `source/lib2.bs`
        }, ``);

        //scope should have been invalidated again because of chained dependency
        expect(scope.isValidated).to.be.false;
        await program.validate();
        expect(scope.isValidated).to.be.true;

        program.removeFile(`${rootDir}/source/lib.bs`);
        expect(scope.isValidated).to.be.false;
    });

    it('does not invalidate unrelated scopes on change', async () => {
        let xmlFile1 = await program.addOrReplaceFile<XmlFile>({
            src: `${rootDir}/components/comp1.xml`,
            dest: `components/comp1.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene1" extends="BaseScene">
                <script type="text/brightscript" uri="pkg:/source/lib.brs" />
            </component>
        `);

        let xmlFile2 = await program.addOrReplaceFile<XmlFile>({
            src: `${rootDir}/components/comp2.xml`,
            dest: `components/comp2.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene2" extends="BaseScene">
            </component>
        `);

        await program.validate();
        //scope should be validated
        expect(program.getScopesForFile(xmlFile1)[0].isValidated).to.be.true;
        expect(program.getScopesForFile(xmlFile2)[0].isValidated).to.be.true;

        //add the lib file
        await program.addOrReplaceFile({
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
        const actual = file.getDiagnostics();
        expect(actual).deep.equal(expected);
    });

    describe('component extends', () => {
        it('works for single-line', async () => {
            file = await program.addOrReplaceFile(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene" extends="BaseScene">
                    </component>
                `
            ) as any;
            expect(file.parentComponentName.range).to.eql(Range.create(1, 38, 1, 47));
        });

        it('works for multi-line', async () => {
            file = await program.addOrReplaceFile(
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
            ) as any;
            expect(file.parentComponentName.range).to.eql(Range.create(2, 13, 2, 22));
        });

        it('does not throw when unable to find extends', async () => {
            file = await program.addOrReplaceFile(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene">
                    </component>
                `
            ) as any;
            expect(file.parentComponentName).to.not.exist;
        });

        it('adds warning when no "extends" attribute is found', async () => {
            file = await program.addOrReplaceFile<XmlFile>(
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

            expect(file.getDiagnostics()[0]).to.include({
                severity: DiagnosticSeverity.Warning,
                message: DiagnosticMessages.xmlComponentMissingExtendsAttribute().message
            });
        });
    });

    it('detects when importing the codebehind file unnecessarily', async () => {
        program = new Program({
            autoImportComponentScript: true,
            rootDir: rootDir
        });
        await program.addOrReplaceFile({
            src: `${rootDir}/components/SimpleScene.bs`,
            dest: `components/SimpleScene.bs`
        }, '');
        await program.addOrReplaceFile({
            src: `${rootDir}/components/SimpleScene.xml`,
            dest: `components/SimpleScene.xml`
        }, trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="SimpleScene" extends="Scene">
                <script type="text/brighterscript" uri="SimpleScene.bs" />
            </component>
        `);

        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.unnecessaryCodebehindScriptImport().message
        );
    });

    describe('transpile', () => {
        it('keeps all content of the XML', async () => {
            await program.addOrReplaceFile(`components/SimpleScene.bs`, `
                sub init()
                end sub
            `);

            await testTranspile(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component
                    name="SimpleScene" extends="Scene"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:noNamespaceSchemaLocation="https://devtools.web.roku.com/schema/RokuSceneGraph.xsd"
                >
                    <interface>
                        <field id="a" />
                        <function name="b" />
                    </interface>
                    <script type="text/brightscript" uri="SimpleScene.brs"/>
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
                        <field id="a" />
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

        it('changes file extensions to brs from bs', async () => {
            await program.addOrReplaceFile(`components/SimpleScene.bs`, `
                import "pkg:/source/lib.bs"
            `);
            await program.addOrReplaceFile('source/lib.bs', ``);

            await testTranspile(trim`
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

        it('returns the XML unmodified if needsTranspiled is false', async () => {
            let file = await program.addOrReplaceFile(
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

        it('needsTranspiled is false by default', async () => {
            let file = await program.addOrReplaceFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" >
                </component>
            `);
            expect(file.needsTranspiled).to.be.false;
        });

        it('needsTranspiled is true if an import is brighterscript', async () => {
            let file = await program.addOrReplaceFile(
                { src: s`${rootDir}/components/SimpleScene.xml`, dest: 'components/SimpleScene.xml' },
                trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene" >
                    <script type="text/brightscript" uri="SimpleScene.bs"/>
                </component>
            `);
            expect(file.needsTranspiled).to.be.true;
        });

        it('simple source mapping includes sourcemap reference', async () => {
            let file = await program.addOrReplaceFile(
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

        it('AST-based source mapping includes sourcemap reference', async () => {
            let file = await program.addOrReplaceFile(
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
            file = new XmlFile('abs', 'rel', program);
            program.plugins.add({
                name: 'Transform plugins',
                afterFileParse: () => validateXml(file)
            });
            file.parse(trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                </component>
            `);
            return file;
        }

        it('Calls XML file validation plugins', () => {
            const validateXml = sinon.spy();
            const file = parseFileWithPlugins(validateXml);
            expect(validateXml.callCount).to.equal(1);
            expect(validateXml.calledWith(file)).to.be.true;
        });
    });

    it('plugin diagnostics work for xml files', async () => {
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

        await program.addOrReplaceFile('components/comp.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Cmp1" extends="Scene">
            </component>
        `);
        await program.validate();
        expect(program.getDiagnostics().map(x => ({ message: x.message, code: x.code }))).to.eql([{
            message: 'Test diagnostic',
            code: 9999
        }]);
    });

    describe('typedef', () => {
        it('loads d.bs files from parent scope', async () => {
            await program.addOrReplaceFile<XmlFile>('components/ParentComponent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentComponent" extends="Scene">
                    <script uri="ParentComponent.brs" />
                </component>
            `);

            await program.addOrReplaceFile('components/ParentComponent.d.bs', `
                import "Lib.brs"
                namespace Parent
                    sub log()
                    end sub
                end namespace
            `);
            await program.addOrReplaceFile('components/ParentComponent.brs', `
                sub Parent_log()
                end sub
            `);

            await program.addOrReplaceFile('components/Lib.d.bs', `
                namespace Lib
                    sub log()
                    end sub
                end namespace
            `);
            await program.addOrReplaceFile('components/Lib.brs', `
                sub Lib_log()
                end sub
            `);

            await program.addOrReplaceFile<XmlFile>('components/ChildComponent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildComponent" extends="ParentComponent">
                    <script uri="ChildComponent.bs" />
                </component>
            `);
            await program.addOrReplaceFile('components/ChildComponent.bs', `
                sub init()
                    Parent.log()
                    Lib.log()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            const scope = program.getComponentScope('ChildComponent');
            expect(Object.keys(scope.namespaceLookup).sort()).to.eql([
                'lib',
                'parent'
            ]);
        });

        it('loads `d.bs` files into scope', async () => {
            const xmlFile = await program.addOrReplaceFile<XmlFile>('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script uri="Component1.brs" />
                </component>
            `);
            await program.addOrReplaceFile('components/Component1.d.bs', `
                sub logInfo()
                end sub
            `);

            expect(program.getScopesForFile(xmlFile)[0].getAllCallables().map(x => x.callable.name)).to.include('logInfo');
        });

        it('does not include `d.bs` script during transpile', async () => {
            await program.addOrReplaceFile('source/logger.d.bs', `
                sub logInfo()
                end sub
            `);
            await program.addOrReplaceFile('source/logger.brs', `
                sub logInfo()
                end sub
            `);
            await program.addOrReplaceFile('components/Component1.bs', `
                import "pkg:/source/logger.brs"
                sub logInfo()
                end sub
            `);
            await testTranspile(trim`
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

        it('does not load .brs information into scope if related d.bs is in scope', async () => {
            const xmlFile = await program.addOrReplaceFile<XmlFile>('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script uri="Component1.brs" />
                </component>
            `);
            const scope = program.getScopesForFile(xmlFile)[0];

            //load brs file
            await program.addOrReplaceFile('components/Component1.brs', `
                sub logInfo()
                end sub
                sub logWarning()
                end sub
            `);

            let functionNames = scope.getAllCallables().map(x => x.callable.name);
            expect(functionNames).to.include('logInfo');
            expect(functionNames).to.include('logWarning');

            //load d.bs file, which should shadow out the .brs file
            await program.addOrReplaceFile('components/Component1.d.bs', `
                sub logError()
                end sub
            `);

            functionNames = scope.getAllCallables().map(x => x.callable.name);
            expect(functionNames).to.include('logError');
            expect(functionNames).not.to.include('logInfo');
            expect(functionNames).not.to.include('logWarning');
        });

        it('updates xml scope when typedef disappears', async () => {
            const xmlFile = await program.addOrReplaceFile<XmlFile>('components/Component1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Component1" extends="Scene">
                    <script uri="Component1.brs" />
                </component>
            `);
            const scope = program.getScopesForFile(xmlFile)[0];

            //load brs file
            await program.addOrReplaceFile('components/Component1.brs', `
                sub logBrs()
                end sub
            `);
            //load d.bs file, which should shadow out the .brs file
            const typedef = await program.addOrReplaceFile('components/Component1.d.bs', `
                sub logTypedef()
                end sub
            `);
            await program.validate();
            let functionNames = scope.getOwnCallables().map(x => x.callable.name);
            expect(functionNames).to.include('logTypedef');
            expect(functionNames).not.to.include('logBrs');

            //remove the typdef file
            program.removeFile(typedef.pathAbsolute);

            await program.validate();
            functionNames = scope.getOwnCallables().map(x => x.callable.name);
            expect(functionNames).not.to.include('logTypedef');
            expect(functionNames).to.include('logBrs');
        });
    });

    it('finds script imports for single-quoted script tags', async () => {
        const file = await program.addOrReplaceFile<XmlFile>('components/file.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="Cmp1" extends="Scene">
                <script uri='SingleQuotedFile.brs' />
            </component>
        `);
        expect(file.scriptTagImports[0]?.text).to.eql('SingleQuotedFile.brs');
    });
});
