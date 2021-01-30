import { expect } from 'chai';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { expectZeroDiagnostics, trim } from '../testHelpers.spec';
import SGParser from './SGParser';
import { standardizePath as s } from '../util';
import { createSandbox } from 'sinon';
import { Program } from '../Program';
import type { XmlFile } from '../files/XmlFile';

let sinon = createSandbox();
describe('SGParser', () => {

    let rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: false });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('Parses well formed SG component', () => {
        const file = program.addOrReplaceFile<XmlFile>('components/file.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ParentScene" extends="GrandparentScene">
                <interface>
                    <field id="content" type="string" alwaysNotify="true" />
                    <function name="load" />
                </interface>
                <!-- some XML comment -->
                <script type="text/brightscript" uri="./Component1.brs" />
                <script type="text/brightscript">
                    <![CDATA[
                        function init()
                            print "hello"
                        end function
                    ]]>
                </script>
                <children>
                    <Label id="loadingIndicator"
                        text="Loading..."
                        font="font:MediumBoldSystemFont"
                        />
                </children>
            </component>`
        );
        const { ast } = file.parser;
        expect(ast.prolog).to.exist;
        expect(ast.component).to.exist;
        expect(ast.root).to.equal(ast.component);
        expectZeroDiagnostics(file);

        const output = file.transpile();
        expect(output.code).to.equal(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ParentScene" extends="GrandparentScene">
                <interface>
                    <field id="content" type="string" alwaysNotify="true" />
                    <function name="load" />
                </interface>
                <script type="text/brightscript" uri="./Component1.brs" />
                <script type="text/brightscript"><![CDATA[
                        function init()
                            print "hello"
                        end function
                    ]]></script>
                <script type="text/brightscript" uri="pkg:/source/bslib.brs" />
                <children>
                    <Label id="loadingIndicator" text="Loading..." font="font:MediumBoldSystemFont" />
                </children>
            </component>
        `);
    });

    it('Adds error when an unexpected tag is found in xml', () => {
        const parser = new SGParser();
        parser.parse(
            'pkg:/components/ParentScene.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <interface>
                    <unexpected />
                </interface>
                <unexpectedToo />
            </component>
        `);
        expect(parser.diagnostics).to.be.lengthOf(2);
        expect(parser.diagnostics[0]).to.deep.include({
            ...DiagnosticMessages.xmlUnexpectedTag('unexpected'),
            range: Range.create(3, 9, 3, 19)
        });
        expect(parser.diagnostics[1]).to.deep.include({
            ...DiagnosticMessages.xmlUnexpectedTag('unexpectedToo'),
            range: Range.create(5, 5, 5, 18)
        });
    });

    it('Adds error when a leaf tag is found to have children', () => {
        const parser = new SGParser();
        parser.parse(
            'pkg:/components/ParentScene.xml', trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <interface>
                    <field id="prop">
                        <unexpected />
                    </field>
                </interface>
                <script type="text/brightscript" uri="./Component1.brs">
                    <unexpectedToo />
                </script>
            </component>
        `);
        expect(parser.diagnostics).to.be.lengthOf(2);
        expect(parser.diagnostics[0]).to.deep.include({
            ...DiagnosticMessages.xmlUnexpectedChildren('field'),
            range: Range.create(3, 9, 3, 14)
        });
        expect(parser.diagnostics[1]).to.deep.include({
            ...DiagnosticMessages.xmlUnexpectedChildren('script'),
            range: Range.create(7, 5, 7, 11)
        });
    });

    it('Adds error when whitespace appears before the prolog', () => {
        const parser = new SGParser();
        parser.parse('path/to/component/ChildScene.xml', /* not trimmed */`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="ChildScene.brs" />
            </component>`
        );
        expect(parser.diagnostics).to.be.lengthOf(2);
        expect(parser.diagnostics[0]).to.deep.include({ // expecting opening tag but got prolog
            code: DiagnosticMessages.xmlGenericParseError('').code,
            range: Range.create(1, 12, 1, 18)
        });
        expect(parser.diagnostics[1]).to.deep.include({
            ...DiagnosticMessages.xmlGenericParseError('Syntax error: whitespace found before the XML prolog'),
            range: Range.create(0, 0, 1, 12)
        });
    });
});
