import { expect } from 'chai';
import { Position } from 'vscode-languageserver';
import { XmlFile } from './files/XmlFile';
import { Program } from './Program';
import { util } from './util';
let rootDir = 'C:/projects/RokuApp';

describe('XmlScope', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    afterEach(() => {
        program.dispose();
    });

    describe('constructor', () => {
        it('listens for attach/detach parent events', async () => {
            let parentXmlFile = await program.addOrReplaceFile('components/parent.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Parent" extends="Scene">
                </component>
            `) as XmlFile;
            let scope = program.getScopeByName(parentXmlFile.pkgPath);

            //should default to global scope
            expect(scope.getParentScope()).to.equal(program.globalScope);

            let childXmlFile = await program.addOrReplaceFile('components/child.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child" extends="Parent">
                </component>
            `) as XmlFile;
            let childScope = program.getComponentScope('Child');

            await program.validate();

            // child should have found its parent
            expect(childXmlFile.parentComponent).to.equal(parentXmlFile);
            // child's parent scope should have found the parent scope
            expect(childScope.getParentScope()).to.equal(program.getComponentScope('Parent'));

            //remove the parent component
            program.removeFile(`${rootDir}/components/parent.xml`);
            await program.validate();
            //the child should know the parent no longer exists
            expect(childXmlFile.parentComponent).not.to.exist;
            //child's parent scope should be the global scope
            expect(childScope.getParentScope()).to.equal(program.globalScope);
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
            let childScope = program.getScopesForFile(childXmlFile);
            let definition = childScope[0].getDefinition(childXmlFile, Position.create(2, 64));
            expect(definition).to.be.lengthOf(1);
            expect(definition[0].uri).to.equal(util.pathToUri(parentXmlFile.pathAbsolute));
        });
    });

    describe('getFiles', () => {
        it('includes the xml file', async () => {
            let xmlFile = await program.addOrReplaceFile('components/child.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child">
                </component>
            `);
            await program.validate();
            expect(program.getComponentScope('Child').getFiles()[0]).to.equal(xmlFile);
        });
    });
});
