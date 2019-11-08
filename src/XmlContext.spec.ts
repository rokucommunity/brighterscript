import { assert, expect } from 'chai';
import * as path from 'path';
import { Position } from 'vscode-languageserver';

import { XmlFile } from './files/XmlFile';
import { Program } from './Program';
import util from './util';
import { XmlContext } from './XmlContext';

let n = path.normalize;
let rootDir = 'C:/projects/RokuApp';

describe('XmlContext', () => {
    let xmlFile: XmlFile;
    let context: XmlContext;
    let program: Program;
    let xmlFilePath = n(`${rootDir}/components/component.xml`);
    beforeEach(() => {

        program = new Program({ rootDir: rootDir });
        xmlFile = new XmlFile(xmlFilePath, n('components/component.xml'), program);
        context = new XmlContext(xmlFile);
        context.attachProgram(program);

        context.parentContext = program.platformContext;
    });
    describe('onProgramFileRemove', () => {
        it('handles file-removed event when file does not have component name', async () => {
            xmlFile.parentName = 'Scene';
            xmlFile.componentName = 'ParentComponent';
            let namelessComponent = await program.addOrReplaceFile({ src: `${rootDir}/components/child.xml`, dest: 'components/child.xml' }, `
                <?xml version="1.0" encoding="utf-8" ?>
                <component extends="ParentComponent">
                </component>
            `);
            try {
                (context as any).onProgramFileRemove(namelessComponent);
            } catch (e) {
                assert.fail(null, null, 'Should not have thrown');
            }
        });
    });

    describe('constructor', () => {
        it('listens for attach/detach parent events', () => {
            let parentXmlFile = new XmlFile(n(`${rootDir}/components/parent.xml`), n('components/parent.xml'), program);
            let parentContext = new XmlContext(parentXmlFile);
            (program as any).contexts[parentContext.name] = parentContext;

            //should default to platform context
            expect(context.parentContext).to.equal(program.platformContext);

            //when the xml file attaches an xml parent, the xml context should be notified and find its parent context
            xmlFile.attachParent(parentXmlFile);
            expect(context.parentContext).to.equal(parentContext);

            xmlFile.detachParent();
            expect(context.parentContext).to.equal(program.platformContext);
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
            let childContext = program.getContextsForFile(childXmlFile);
            let definition = childContext[0].getDefinition(childXmlFile, Position.create(2, 64));
            expect(definition).to.be.lengthOf(1);
            expect(definition[0].uri).to.equal(util.pathToUri(parentXmlFile.pathAbsolute));
        });
    });
});
