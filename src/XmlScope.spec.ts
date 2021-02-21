import { expect } from 'chai';
import { Position, Range } from 'vscode-languageserver';
import { DiagnosticMessages } from './DiagnosticMessages';
import type { XmlFile } from './files/XmlFile';
import { Program } from './Program';
import { trim } from './testHelpers.spec';
import { standardizePath as s, util } from './util';
let rootDir = s`${process.cwd()}/rootDir`;

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
        it('listens for attach/detach parent events', () => {
            let parentXmlFile = program.addOrReplaceFile<XmlFile>('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Parent" extends="Scene">
                </component>
            `);
            let scope = program.getScopeByName(parentXmlFile.pkgPath);

            //should default to global scope
            expect(scope.getParentScope()).to.equal(program.globalScope);

            let childXmlFile = program.addOrReplaceFile<XmlFile>('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child" extends="Parent">
                </component>
            `);
            let childScope = program.getComponentScope('Child');

            program.validate();

            // child should have found its parent
            expect(childXmlFile.parentComponent).to.equal(parentXmlFile);
            // child's parent scope should have found the parent scope
            expect(childScope.getParentScope()).to.equal(program.getComponentScope('Parent'));

            //remove the parent component
            program.removeFileBySrcPath(`${rootDir}/components/parent.xml`);
            program.validate();
            //the child should know the parent no longer exists
            expect(childXmlFile.parentComponent).not.to.exist;
            //child's parent scope should be the global scope
            expect(childScope.getParentScope()).to.equal(program.globalScope);
        });
    });

    describe('getDefinition', () => {
        it('finds parent file', () => {
            let parentXmlFile = program.addOrReplaceFile({ src: `${rootDir}/components/parent.xml`, dest: 'components/parent.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ParentComponent">
                </component>
            `);
            let childXmlFile = program.addOrReplaceFile({ src: `${rootDir}/components/child.xml`, dest: 'components/child.xml' }, trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="ChildComponent" extends="ParentComponent">
                </component>
            `);
            let childScope = program.getScopesForFile(childXmlFile);
            let definition = childScope[0].getDefinition(childXmlFile, Position.create(1, 48));
            expect(definition).to.be.lengthOf(1);
            expect(definition[0].uri).to.equal(util.pathToUri(parentXmlFile.srcPath));
        });
    });

    describe('getFiles', () => {
        it('includes the xml file', () => {
            let xmlFile = program.addOrReplaceFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Child">
                </component>
            `);
            program.validate();
            expect(program.getComponentScope('Child').getOwnFiles()[0]).to.equal(xmlFile);
        });
    });

    describe('validate', () => {
        it('adds an error when an interface function cannot be found', () => {
            program = new Program({ rootDir: rootDir });

            program.addOrReplaceFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <interface>
                        <function name="func1" />
                        <function name="func2" />
                        <function id="func3" />
                        <function name="" />
                        <function name />
                    </interface>
                    <script uri="child.brs"/>
                </component>
            `);
            program.addOrReplaceFile(s`components/child.brs`, `
                sub func1()
                end sub
            `);
            program.validate();
            let childScope = program.getComponentScope('child');
            let diagnostics = childScope.getDiagnostics();
            expect(diagnostics.length).to.equal(5);
            expect(diagnostics[0]).to.deep.include({
                ...DiagnosticMessages.xmlFunctionNotFound('func2'),
                range: Range.create(4, 24, 4, 29)
            });
            expect(diagnostics[1]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('function', 'name'),
                range: Range.create(5, 9, 5, 17)
            });
            expect(diagnostics[2]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('function', 'name'),
                range: Range.create(6, 9, 6, 17)
            });
            expect(diagnostics[3]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('function', 'name'),
                range: Range.create(7, 9, 7, 17)
            });
            expect(diagnostics[4]).to.deep.include({ // syntax error expecting '=' but found '/>'
                code: DiagnosticMessages.xmlGenericParseError('').code
            });
        });

        it('adds an error when an interface field is invalid', () => {
            program = new Program({ rootDir: rootDir });

            program.addOrReplaceFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <interface>
                        <field id="field1" type="node" />
                        <field id="field2" type="no" />
                        <field id="field3" />
                        <field name="field4" type="str" />
                        <field id="field5" alias="other.field" />
                        <field id="" type="int" />
                        <field id />
                    </interface>
                    <script uri="child.brs"/>
                </component>
            `);
            program.addOrReplaceFile(s`components/child.brs`, `
                sub init()
                end sub
            `);
            program.validate();
            let childScope = program.getComponentScope('child');
            let diagnostics = childScope.getDiagnostics();
            expect(diagnostics.length).to.equal(7);
            expect(diagnostics[0]).to.deep.include({
                ...DiagnosticMessages.xmlInvalidFieldType('no'),
                range: Range.create(4, 33, 4, 35)
            });
            expect(diagnostics[1]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'type'),
                range: Range.create(5, 9, 5, 14)
            });
            expect(diagnostics[2]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'id'),
                range: Range.create(6, 9, 6, 14)
            });
            expect(diagnostics[3]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'id'),
                range: Range.create(8, 9, 8, 14)
            });
            expect(diagnostics[4]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'id'),
                range: Range.create(9, 9, 9, 14)
            });
            expect(diagnostics[5]).to.deep.include({
                ...DiagnosticMessages.xmlTagMissingAttribute('field', 'type'),
                range: Range.create(9, 9, 9, 14)
            });
            expect(diagnostics[6]).to.deep.include({ // syntax error expecting '=' but found '/>'
                code: DiagnosticMessages.xmlGenericParseError('').code
            });
        });
    });
});
