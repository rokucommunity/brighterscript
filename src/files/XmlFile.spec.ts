import { assert, expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';
import { CompletionItem, CompletionItemKind, Position, Range, DiagnosticSeverity } from 'vscode-languageserver';

import { DiagnosticMessages } from '../DiagnosticMessages';
import { BsDiagnostic, FileReference } from '../interfaces';
import { Program } from '../Program';
import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
import { standardizePath as s } from '../util';
import { getTestTranspile } from './BrsFile.spec';

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
        it('allows modifying the parsed XML model', async () => {
            const expected = 'OtherName';
            file = new XmlFile('abs', 'rel', program);
            program.plugins.add({
                name: 'allows modifying the parsed XML model',
                afterFileParse: () => {
                    file.parsedXml.component.$.name = expected;
                }
            });
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                </component>
            `);
            expect(file.componentName).to.equal(expected);
        });

        it('supports importing BrighterScript files', async () => {
            file = await program.addOrReplaceFile({ src: `${rootDir}/components/custom.xml`, dest: 'components/custom.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene.bs" />
                </component>
            `) as any;
            expect(file.scriptTagImports.map(x => x.pkgPath)[0]).to.equal(
                s`components/ChildScene.bs`
            );
        });
        it('does not include commented-out script imports', async () => {
            file = await program.addOrReplaceFile({ src: `${rootDir}/components/custom.xml`, dest: 'components/custom.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene.brs" />
                    <!--
                        <script type="text/brightscript" uri="ChildScene.brs" />
                    -->
                </component>
            `) as any;
            expect(
                file.scriptTagImports?.[0]?.pkgPath
            ).to.eql(
                s`components/ChildScene.brs`
            );
        });

        it('finds scripts when more than one per line', async () => {
            file = new XmlFile('abs', 'rel', program);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                </component>
            `);
            expect(file.scriptTagImports).to.be.lengthOf(3);
            expect(file.scriptTagImports[0]).to.deep.include(<FileReference>{
                text: 'ChildScene1.brs',
                filePathRange: Range.create(3, 58, 3, 73)
            });
            expect(file.scriptTagImports[1]).to.deep.include(<FileReference>{
                text: 'ChildScene2.brs',
                filePathRange: Range.create(3, 116, 3, 131)
            });
            expect(file.scriptTagImports[2]).to.deep.include(<FileReference>{
                text: 'ChildScene3.brs',
                filePathRange: Range.create(3, 174, 3, 189)
            });
        });

        it('finds component names', async () => {
            file = new XmlFile('abs', 'rel', program);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            expect(file.parentComponentName).to.equal('ParentScene');
            expect(file.componentName).to.equal('ChildScene');
        });

        it('Adds error when no component is declared in xml', async () => {
            file = new XmlFile('abs', 'rel', program);
            await file.parse('<script type="text/brightscript" uri="ChildScene.brs" />');
            expect(file.diagnostics).to.be.lengthOf(1);
            expect(file.diagnostics[0].message).to.equal(DiagnosticMessages.xmlComponentMissingComponentDeclaration().message);
        });

        it('adds error when component does not declare a name', async () => {
            file = new XmlFile('abs', 'rel', program);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component extends="ParentScene">
                <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            expect(file.diagnostics).to.be.lengthOf(1);
            expect(file.diagnostics[0]).to.deep.include(<BsDiagnostic>{
                message: DiagnosticMessages.xmlComponentMissingNameAttribute().message,
                range: Range.create(2, 16, 2, 26)
            });
        });

        it('catches xml parse errors', async () => {
            file = new XmlFile('abs', 'rel', program);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component 1extends="ParentScene">
                </component>
            `);
            expect(file.diagnostics).to.be.lengthOf(1);
            expect(file.diagnostics[0]).to.deep.include(<BsDiagnostic>{
                code: DiagnosticMessages.xmlGenericParseError('Some generic parse error').code,
                range: Range.create(2, 27, 2, 27)
            });
        });

        it('finds script imports', async () => {
            file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', program);
            await file.parse(`
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
                filePathRange: Range.create(3, 58, 3, 82)
            });
        });

        it('throws an error if the file has already been parsed', async () => {
            file = new XmlFile('abspath', 'relpath', program);
            await file.parse('a comment');
            try {
                await file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('resolves relative paths', async () => {
            file = await program.addOrReplaceFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: 'components/comp1.xml'
            }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="cmp1.brs" />
                </component>
            `) as any;
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
            }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="" />
                </component>
            `) as any;
            expect(file.scriptTagImports.length).to.equal(1);
            expect(file.scriptTagImports[0]?.filePathRange).to.eql(
                Range.create(3, 58, 3, 58)
            );
        });
    });

    describe('doesReferenceFile', () => {
        it('compares case insensitive', async () => {
            let xmlFile = await program.addOrReplaceFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: 'components/comp1.xml'
            }, `
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
            await program.addOrReplaceFile({ src: `${rootDir}/components/comp1.xml`, dest: 'components/comp1.xml' }, `
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
            await program.addOrReplaceFile({ src: `${rootDir}/components/comp1.xml`, dest: 'components/comp1.xml' }, `
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
        it('formats completion paths with proper slashes', async () => {
            let scriptPath = s`C:/app/components/component1/component1.brs`;
            program.files[scriptPath] = new BrsFile(scriptPath, s`components/component1/component1.brs`, program);

            let xmlFile = new XmlFile(s`${rootDir}/components/component1/component1.xml`, s`components/component1/component1.xml`, <any>program);
            xmlFile.scriptTagImports.push({
                pkgPath: s`components/component1/component1.brs`,
                text: 'component1.brs',
                filePathRange: Range.create(1, 1, 1, 1),
                sourceFile: xmlFile
            });

            expect((await xmlFile.getCompletions(Position.create(1, 1)))[0]).to.include({
                label: 'component1.brs',
                kind: CompletionItemKind.File
            });

            expect((await xmlFile.getCompletions(Position.create(1, 1)))[1]).to.include(<CompletionItem>{
                label: 'pkg:/components/component1/component1.brs',
                kind: CompletionItemKind.File
            });
        });

        it('returns empty set when out of range', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/Component1.brs`, dest: 'components/component1.brs' }, ``);
            expect(await file.getCompletions(Position.create(99, 99))).to.be.empty;
        });

        //TODO - refine this test once cdata scripts are supported
        it('prevents scope completions entirely', async () => {
            await program.addOrReplaceFile({ src: `${rootDir}/components/Component1.brs`, dest: 'components/component1.brs' }, ``);

            let xmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/Component1.xml`, dest: 'components/component1.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./Component1.brs" />
                </component>
            `);

            expect(program.getCompletions(xmlFile.pathAbsolute, Position.create(1, 1))).to.be.empty;
        });
    });

    describe('getAllScriptImports', () => {
        it('returns own imports', async () => {
            file = await program.addOrReplaceFile({
                src: `${rootDir}/components/comp1.xml`,
                dest: `components/comp1.xml`
            }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="BaseScene">
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                </component>
            `) as any;
            expect(file.getAllScriptImports()).to.eql([
                s`source/lib.brs`
            ]);
        });
    });

    it('invalidates dependent scopes on change', async () => {
        let xmlFile = await program.addOrReplaceFile({
            src: `${rootDir}/components/comp1.xml`,
            dest: `components/comp1.xml`
        }, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="BaseScene">
                <script type="text/brightscript" uri="pkg:/source/lib.bs" />
            </component>
        `) as any as XmlFile;
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
        let xmlFile1 = await program.addOrReplaceFile({
            src: `${rootDir}/components/comp1.xml`,
            dest: `components/comp1.xml`
        }, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene1" extends="BaseScene">
                <script type="text/brightscript" uri="pkg:/source/lib.brs" />
            </component>
        `) as any as XmlFile;

        let xmlFile2 = await program.addOrReplaceFile({
            src: `${rootDir}/components/comp2.xml`,
            dest: `components/comp2.xml`
        }, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene2" extends="BaseScene">
            </component>
        `) as any as XmlFile;

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

    describe('findExtendsPosition', () => {
        it('works for single-line', () => {
            expect(file.findExtendsPosition(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="BaseScene">
                </component>
            `)).to.eql(Range.create(2, 54, 2, 63));
        });

        it('works for multi-line', () => {
            expect(file.findExtendsPosition(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene"
                    extends="BaseScene">
                </component>
            `)).to.eql(Range.create(3, 29, 3, 38));
        });
        it('does not throw when unable to find extends', () => {
            file.findExtendsPosition(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                </component>
            `);
        });

        it('adds warning when no "extends" attribute is found', async () => {
            file = await program.addOrReplaceFile(
                {
                    src: `${rootDir}/components/comp1.xml`,
                    dest: `components/comp1.xml`
                },
                `
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="ChildScene">
                    </component>
                `
            ) as any;

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
        }, `
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
        it('changes file extensions to brs from bs', async () => {
            await program.addOrReplaceFile(`components/SimpleScene.bs`, `
                import "pkg:/source/lib.bs"
            `);
            await program.addOrReplaceFile('source/lib.bs', ``);

            await testTranspile(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script type="text/brighterscript" uri="SimpleScene.bs"/>
                </component>
            `, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="SimpleScene" extends="Scene">
                    <script type="text/brightscript" uri="SimpleScene.brs"/>
                    <script type="text/brightscript" uri="pkg:/source/lib.brs" />
                    <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                </component>
            `, 'none', 'components/SimpleScene.xml');
        });
    });

    it('catches brighterscript script tags missing the proper type', async () => {
        await program.addOrReplaceFile({
            src: `${rootDir}/components/SimpleScene.bs`,
            dest: `components/SimpleScene.bs`
        }, '');

        //missing type
        await program.addOrReplaceFile({
            src: `${rootDir}/components/SimpleScene.xml`,
            dest: `components/SimpleScene.xml`
        }, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="SimpleScene" extends="Scene">
                <script uri="SimpleScene.bs"/>
            </component>
        `);

        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.exist.and.to.equal(
            DiagnosticMessages.brighterscriptScriptTagMissingTypeAttribute().message
        );

        //wrong type
        await program.addOrReplaceFile({
            src: `${rootDir}/components/SimpleScene.xml`,
            dest: `components/SimpleScene.xml`
        }, `
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="SimpleScene" extends="Scene">
                <script type="text/brightscript" uri="SimpleScene.bs"/>
            </component>
        `);

        //wrong type
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.exist.and.to.equal(
            DiagnosticMessages.brighterscriptScriptTagMissingTypeAttribute().message
        );
    });

    describe('Transform plugins', () => {
        async function parseFileWithPlugins(validateXml: (file: XmlFile) => void) {
            const rootDir = process.cwd();
            const program = new Program({
                rootDir: rootDir
            });
            file = new XmlFile('abs', 'rel', program);
            program.plugins.add({
                name: 'Transform plugins',
                afterFileParse: () => validateXml(file)
            });
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                </component>
            `);
            return file;
        }

        it('Calls XML file validation plugins', async () => {
            const validateXml = sinon.spy();
            const file = await parseFileWithPlugins(validateXml);
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

        await program.addOrReplaceFile('components/comp.xml', `
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
        it('loads `d.bs` files into scope', async () => {
            const xmlFile = await program.addOrReplaceFile<XmlFile>('components/Component1.xml', `
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

        it.only('does not load .brs information into scope if related d.bs is in scope', async () => {
            const xmlFile = await program.addOrReplaceFile<XmlFile>('components/Component1.xml', `
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
    });
});
