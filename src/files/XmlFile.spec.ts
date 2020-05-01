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

describe('XmlFile', () => {
    let rootDir = process.cwd();
    let program: Program;
    let sinon = sinonImport.createSandbox();
    let file: XmlFile;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
        file = new XmlFile(`${rootDir}/components/MainComponent.xml`, 'components/MainComponent.xml', program);
    });
    afterEach(() => {
        sinon.restore();
    });

    describe('parse', () => {
        it('supports importing BrighterScript files', async () => {
            file = new XmlFile(`${rootDir}/components/custom.xml`, 'components/custom.xml', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                <script type="text/brightscript" uri="ChildScene.bs" />
                </component>
            `);
            expect(file.ownScriptImports.map(x => x.pkgPath)[0]).to.equal(
                s`components/ChildScene.bs`
            );
        });
        it('does not include commented-out script imports', async () => {
            file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                <script type="text/brightscript" uri="ChildScene.brs" />
                <!--
                        <script type="text/brightscript" uri="ChildScene.brs" />
                    -->
                </component>
            `);
            expect(file.ownScriptImports).to.be.lengthOf(1);
        });

        it('finds scripts when more than one per line', async () => {
            file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                </component>
            `);
            expect(file.ownScriptImports).to.be.lengthOf(3);
            expect(file.ownScriptImports[0]).to.deep.include(<FileReference>{
                text: 'ChildScene1.brs',
                filePathRange: Range.create(3, 58, 3, 73)
            });
            expect(file.ownScriptImports[1]).to.deep.include(<FileReference>{
                text: 'ChildScene2.brs',
                filePathRange: Range.create(3, 116, 3, 131)
            });
            expect(file.ownScriptImports[2]).to.deep.include(<FileReference>{
                text: 'ChildScene3.brs',
                filePathRange: Range.create(3, 174, 3, 189)
            });
        });

        it('finds component names', async () => {
            file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            expect(file.parentName).to.equal('ParentScene');
            expect(file.componentName).to.equal('ChildScene');
        });

        it('Adds error when no component is declared in xml', async () => {
            file = new XmlFile('abs', 'rel', null);
            await file.parse('<script type="text/brightscript" uri="ChildScene.brs" />');
            expect(file.diagnostics).to.be.lengthOf(1);
            expect(file.diagnostics[0].message).to.equal(DiagnosticMessages.xmlComponentMissingComponentDeclaration().message);
        });

        it('adds error when component does not declare a name', async () => {
            file = new XmlFile('abs', 'rel', null);
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
            file = new XmlFile('abs', 'rel', null);
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
            file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="pkg:/components/cmp1.brs" />
                </component>
            `);
            expect(file.ownScriptImports.length).to.equal(1);
            expect(file.ownScriptImports[0]).to.deep.include(<FileReference>{
                sourceFile: file,
                text: 'pkg:/components/cmp1.brs',
                pkgPath: `components${path.sep}cmp1.brs`,
                filePathRange: Range.create(3, 58, 3, 82)
            });
        });

        it('throws an error if the file has already been parsed', async () => {
            file = new XmlFile('abspath', 'relpath', null);
            await file.parse('a comment');
            try {
                await file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('resolves relative paths', async () => {
            file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="cmp1.brs" />
                </component>
            `);
            expect(file.ownScriptImports.length).to.equal(1);
            expect(file.ownScriptImports[0]).to.deep.include(<FileReference>{
                text: 'cmp1.brs',
                pkgPath: `components${path.sep}cmp1.brs`
            });
        });

        it('finds correct position for empty uri in script tag', async () => {
            file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="" />
                </component>
            `);
            expect(file.ownScriptImports.length).to.equal(1);
            expect(file.ownScriptImports[0]?.filePathRange).to.eql(
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

            //enable the setting
            program.options.autoImportComponentScript = true;

            //remove the file and re-add it
            program.removeFile(`${rootDir}/components/comp1.bs`);

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
            xmlFile.ownScriptImports.push({
                pkgPath: s`components/component1/component1..brs`,
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
            file = new XmlFile('abs', 'rel', null);
            await file.parse('');
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
        it('returns own imports', () => {
            file = new XmlFile('file.xml', 'file.xml', null);
            let scriptImport = {
                text: 'some-import'
            };
            file.ownScriptImports.push(<any>scriptImport);
            file.program = program;
            expect(file.getAllFileReferences()).to.be.lengthOf(1);
        });
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
            file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene">
                </component>
            `);
            expect(file.getDiagnostics()[0]).to.include({
                severity: DiagnosticSeverity.Warning,
                message: DiagnosticMessages.xmlComponentMissingExtendsAttribute().message
            });
        });
    });
});
