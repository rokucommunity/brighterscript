import { assert, expect } from 'chai';
import { Position } from 'vscode-languageserver';

import { XmlFile } from './files/XmlFile';
import { Program } from './Program';
import { XmlScope } from './XmlScope';
import { standardizePath as s, util } from './util';
let rootDir = 'C:/projects/RokuApp';

describe('XmlScope', () => {
    let xmlFile: XmlFile;
    let scope: XmlScope;
    let program: Program;
    let xmlFilePath = s`${rootDir}/components/component.xml`;
    beforeEach(async () => {

        program = new Program({ rootDir: rootDir });
        xmlFile = await program.addOrReplaceFile({
            src: xmlFilePath,
            dest: 'components/component.xml'
        }, '') as XmlFile;
        scope = new XmlScope(xmlFile, program);
    });
    describe('onProgramFileRemove', () => {
        it('handles file-removed event when file does not have component name', async () => {
            xmlFile.parentComponentName = 'Scene';
            xmlFile.componentName = 'ParentComponent';
            let namelessComponent = await program.addOrReplaceFile({ src: `${rootDir}/components/child.xml`, dest: 'components/child.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component extends="ParentComponent">
                </component>
            `);
            try {
                (scope as any).onProgramFileRemove(namelessComponent);
            } catch (e) {
                assert.fail(null, null, 'Should not have thrown');
            }
        });
    });

    describe('constructor', () => {
        it('listens for attach/detach parent events', async () => {
            let parentXmlFile = await program.addOrReplaceFile({
                src: `${rootDir}/components/parent.xml`,
                dest: `components/parent.xml`
            }, '') as XmlFile;
            let parentScope = new XmlScope(parentXmlFile, program);
            (program as any).scopes[parentScope.name] = parentScope;

            //should default to global scope
            expect(scope.getParentScope()).to.equal(program.globalScope);

            //when the xml file attaches an xml parent, the xml scope should be notified and find its parent scope
            // xmlFile.attachParent(parentXmlFile);
            expect(scope.getParentScope()).to.equal(parentScope);

            // xmlFile.detachParent();
            expect(scope.getParentScope()).to.equal(program.globalScope);
        });
    });

    describe('getDefinition', () => {
        it('finds parent file', async () => {
            let parentXmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/parent.xml`, dest: 'components/parent.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentComponent">
                </component>
            `);
            let childXmlFile = await program.addOrReplaceFile({ src: `${rootDir}/components/child.xml`, dest: 'components/child.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildComponent" extends="ParentComponent">
                </component>
            `);
            await program.validate();
            let childScope = program.getScopesForFile(childXmlFile);
            let definition = childScope[0].getDefinition(childXmlFile, Position.create(2, 64));
            expect(definition).to.be.lengthOf(1);
            expect(definition[0].uri).to.equal(util.pathToUri(parentXmlFile.pathAbsolute));
        });
    });
});
