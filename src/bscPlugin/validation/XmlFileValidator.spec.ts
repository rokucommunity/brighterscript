import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import type { XmlFile } from '../../files/XmlFile';
import type { BsDiagnostic } from '../../interfaces';
import { trim, rootDir } from '../../testHelpers.spec';

describe('XmlFileValidator', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        program.dispose();
    });

    //codes for the scenegraph node/field diagnostics added by this validator
    const scenegraphCodes = [1155, 1156, 1157, 1158];
    function scenegraphDiagnostics(file: XmlFile): BsDiagnostic[] {
        return file.diagnostics.filter(diagnostic => scenegraphCodes.includes(diagnostic.code as number));
    }

    it('flags an unknown component type in <children>', () => {
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <Lable />
                </children>
            </component>
        `);
        program.validate();
        const diagnostics = scenegraphDiagnostics(file);
        expect(diagnostics.map(x => x.code)).to.include(1155);
        expect(diagnostics[0].message).to.include('Lable');
    });

    it('does not flag known built-in nodes or project components', () => {
        program.setFile('components/widget.xml', trim`
            <component name="Widget" extends="Group">
            </component>
        `);
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <Label text="hi" />
                    <Widget />
                </children>
            </component>
        `);
        program.validate();
        expect(scenegraphDiagnostics(file)).to.be.empty;
    });

    it('flags an unknown field on a known node', () => {
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <Label bogusField="x" />
                </children>
            </component>
        `);
        program.validate();
        expect(scenegraphDiagnostics(file).map(x => x.code)).to.include(1156);
    });

    it('does not flag a case-differing field name (no longer a diagnostic)', () => {
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <Label Text="hi" />
                </children>
            </component>
        `);
        program.validate();
        expect(scenegraphDiagnostics(file)).to.be.empty;
    });

    it('flags a clearly-invalid scalar field value but allows valid and ambiguous ones', () => {
        const badFile = program.setFile<XmlFile>('components/bad.xml', trim`
            <component name="Bad" extends="Group">
                <children>
                    <Label opacity="halfway" />
                </children>
            </component>
        `);
        const goodFile = program.setFile<XmlFile>('components/good.xml', trim`
            <component name="Good" extends="Group">
                <children>
                    <Label opacity="0.5" text="anything goes" />
                </children>
            </component>
        `);
        program.validate();
        expect(scenegraphDiagnostics(badFile).map(x => x.code)).to.include(1157);
        expect(scenegraphDiagnostics(goodFile)).to.be.empty;
    });

    it('does not flag component-library components', () => {
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <MyLib:SomeView />
                </children>
            </component>
        `);
        program.validate();
        //complib-scoped names (containing ':') can't be resolved yet, so they should not be flagged
        expect(scenegraphDiagnostics(file)).to.be.empty;
    });

    it('lets a plugin claim an attribute to opt out of field validation', () => {
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <Label data-custom="x" />
                </children>
            </component>
        `);
        program.plugins.add({
            name: 'claims custom attributes',
            onValidateXmlAttribute: (event) => {
                if (event.attribute.key.text.startsWith('data-')) {
                    event.handled = true;
                }
            }
        });
        program.validate();
        //the plugin claimed `data-custom`, so brighterscript should not flag it as an unknown field
        expect(scenegraphDiagnostics(file)).to.be.empty;
    });

    it('flags mismatched opening and closing tag names', () => {
        const file = program.setFile<XmlFile>('components/main.xml', trim`
            <component name="Main" extends="Group">
                <children>
                    <Rectangle></rectangle>
                </children>
            </component>
        `);
        program.validate();
        expect(scenegraphDiagnostics(file).map(x => x.code)).to.include(1158);
    });
});
