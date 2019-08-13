import { assert, expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';
import { CompletionItem, CompletionItemKind, Position, Range } from 'vscode-languageserver';

import { diagnosticMessages } from '../DiagnosticMessages';
import { Diagnostic, FileReference } from '../interfaces';
import { Program } from '../Program';
import { BrsFile } from './BrsFile';
import { XmlFile } from './XmlFile';
let n = path.normalize;

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
        it('does not include commented-out script imports', async () => {
            let file = new XmlFile('abs', 'rel', null);
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
            let file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildScene" extends="Scene">
                    <script type="text/brightscript" uri="ChildScene1.brs" /> <script type="text/brightscript" uri="ChildScene2.brs" /> <script type="text/brightscript" uri="ChildScene3.brs" />
                </component>
            `);
            expect(file.ownScriptImports).to.be.lengthOf(3);
            expect(file.ownScriptImports[0]).to.deep.include(<FileReference>{
                lineIndex: 3,
                text: 'ChildScene1.brs',
                columnIndexBegin: 58,
                columnIndexEnd: 73
            });
            expect(file.ownScriptImports[1]).to.deep.include(<FileReference>{
                lineIndex: 3,
                text: 'ChildScene2.brs',
                columnIndexBegin: 116,
                columnIndexEnd: 131
            });
            expect(file.ownScriptImports[2]).to.deep.include(<FileReference>{
                lineIndex: 3,
                text: 'ChildScene3.brs',
                columnIndexBegin: 174,
                columnIndexEnd: 189
            });
        });

        it('finds component names', async () => {
            let file = new XmlFile('abs', 'rel', null);
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
            let file = new XmlFile('abs', 'rel', null);
            await file.parse(`<script type="text/brightscript" uri="ChildScene.brs" />`);
            expect(file.parseDiagnistics).to.be.lengthOf(1);
            expect(file.parseDiagnistics[0].message).to.equal(diagnosticMessages.Xml_component_missing_component_declaration_1005().message);
        });

        it('adds error when component does not declare a name', async () => {
            let file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component extends="ParentScene">
                <script type="text/brightscript" uri="ChildScene.brs" />
                </component>
            `);
            expect(file.parseDiagnistics).to.be.lengthOf(1);
            expect(file.parseDiagnistics[0]).to.deep.include(<Diagnostic>{
                message: diagnosticMessages.Component_missing_name_attribute_1006().message,
                location: Range.create(2, 16, 2, 26)
            });
        });

        it('catches xml parse errors', async () => {
            let file = new XmlFile('abs', 'rel', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component 1extends="ParentScene">
                </component>
            `);
            expect(file.parseDiagnistics).to.be.lengthOf(1);
            expect(file.parseDiagnistics[0]).to.deep.include(<Diagnostic>{
                code: diagnosticMessages.Xml_parse_error_1008().code,
                location: Range.create(2, 27, 2, 27),
            });
        });

        it('finds script imports', async () => {
            let file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', null);
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
                lineIndex: 3,
                columnIndexBegin: 58,
                columnIndexEnd: 82,
                pkgPath: `components${path.sep}cmp1.brs`
            });
        });

        it('throws an error if the file has already been parsed', async () => {
            let file = new XmlFile('abspath', 'relpath', null);
            await file.parse(`'a comment`);
            try {
                await file.parse(`'a new comment`);
                assert.fail(null, null, 'Should have thrown an exception, but did not');
            } catch (e) {
                //test passes
            }
        });

        it('resolves relative paths', async () => {
            let file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', null);
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
            let file = new XmlFile('abspath/components/cmp1.xml', 'components/cmp1.xml', null);
            await file.parse(`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Cmp1" extends="Scene">
                    <script type="text/brightscript" uri="" />
                </component>
            `);
            expect(file.ownScriptImports.length).to.equal(1);
            expect(file.ownScriptImports[0]).to.deep.include({
                lineIndex: 3,
                columnIndexBegin: 58,
                columnIndexEnd: 58,
            });
        });
    });

    describe('doesReferenceFile', () => {
        it('compares case insensitive', () => {
            let xmlFile = new XmlFile('absolute', 'relative', null);
            xmlFile.ownScriptImports.push({
                pkgPath: `components${path.sep}HeroGrid.brs`,
                text: '',
                lineIndex: 1,
                sourceFile: xmlFile
            });
            let brsFile = new BrsFile('absolute', `components${path.sep}HEROGRID.brs`, program);
            expect(xmlFile.doesReferenceFile(brsFile)).to.be.true;
        });
    });

    describe('getCompletions', () => {
        it('formats completion paths with proper slashes', async () => {
            let scriptPath = n('C:/app/components/component1/component1.brs');
            program.files[scriptPath] = new BrsFile(scriptPath, n('components/component1/component1.brs'), program);

            let xmlFile = new XmlFile('component.xml', 'relative', <any>program);
            xmlFile.ownScriptImports.push({
                pkgPath: ``,
                text: '',
                lineIndex: 1,
                columnIndexBegin: 1,
                columnIndexEnd: 1,
                sourceFile: xmlFile
            });

            expect(xmlFile.getCompletions(Position.create(1, 1)).completions[0]).to.include({
                label: 'components/component1/component1.brs',
                kind: CompletionItemKind.File
            });

            expect(xmlFile.getCompletions(Position.create(1, 1)).completions[1]).to.include(<CompletionItem>{
                label: 'pkg:/components/component1/component1.brs',
                kind: CompletionItemKind.File
            });
        });

        it('returns empty set when out of range', async () => {
            let file = new XmlFile('abs', 'rel', null);
            await file.parse('');
            expect(file.getCompletions(Position.create(99, 99)).completions).to.be.empty;
        });

        //TODO - refine this test once cdata scripts are supported
        it('prevents context completions entirely', async () => {
            await program.addOrReplaceFile(`${rootDir}/components/Component1.brs`, ``);

            let file = await program.addOrReplaceFile(`${rootDir}/components/Component1.xml`, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentScene" extends="GrandparentScene">
                    <script type="text/brightscript" uri="./Component1.brs" />
                </component>
            `);

            expect(program.getCompletions(file.pathAbsolute, Position.create(1, 1))).to.be.empty;
        });
    });

    describe('getAllScriptImports', () => {
        it('returns own imports', () => {
            let file = new XmlFile('file.xml', 'file.xml', null);
            let scriptImport = {
                text: 'some-import'
            };
            file.ownScriptImports.push(<any>scriptImport);
            expect(file.getAllScriptImports()).to.be.lengthOf(1);
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
    });
});
