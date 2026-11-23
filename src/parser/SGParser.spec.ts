import { expect } from '../chai-config.spec';
import { Range } from 'vscode-languageserver';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { expectDiagnostics, getTestTranspile, trim } from '../testHelpers.spec';
import SGParser from './SGParser';
import { createSandbox } from 'sinon';
import { Program } from '../Program';
import type { XmlFile } from '../files/XmlFile';
import { rootDir } from '../testHelpers.spec';

let sinon = createSandbox();
describe('SGParser', () => {

    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: false });
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('Parses well formed SG component', async () => {
        program.setFile('components/Component1.brs', `
            sub load()
            end sub
        `);
        const { file } = await testTranspile<XmlFile>(trim`
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
            </component>
        `, trim`
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
        `, undefined, 'components/file.xml');

        const { ast } = file.parser;
        expect(ast.prologElement).to.exist;
        expect(ast.componentElement).to.exist;
        expect(ast.rootElement).to.equal(ast.componentElement);
    });

    it('does not crash when missing tag name', () => {
        const parser = new SGParser();
        parser.parse(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
            <!-- a standalone less-than symbol used to cause issues -->
            <
            </component>
        `);
        //the test passes if the parser doesn't throw a runtime exception.
    });


    it('Adds error when an unexpected tag is found in xml', () => {
        const parser = new SGParser();
        parser.parse(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <interface>
                    <unexpected />
                </interface>
                <unexpectedToo />
            </component>
        `);
        expect(parser.diagnostics).to.be.lengthOf(2);
        expectDiagnostics(parser, [{
            ...DiagnosticMessages.xmlUnexpectedTag('unexpected'),
            location: { range: Range.create(3, 9, 3, 19) }
        }, {
            ...DiagnosticMessages.xmlUnexpectedTag('unexpectedToo'),
            location: { range: Range.create(5, 5, 5, 18) }
        }]);
    });

    it('Adds error when a leaf tag is found to have children', () => {
        const parser = new SGParser();
        parser.parse(trim`
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
        expectDiagnostics(parser, [{
            ...DiagnosticMessages.xmlUnexpectedChildren('field'),
            location: { range: Range.create(3, 9, 3, 14) }
        }, {
            ...DiagnosticMessages.xmlUnexpectedChildren('script'),
            location: { range: Range.create(7, 5, 7, 11) }
        }]);
    });

    it('Adds error when whitespace appears before the prolog', () => {
        const parser = new SGParser();
        parser.parse(/* not trimmed */`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <script type="text/brightscript" uri="ChildScene.brs" />
            </component>`
        );
        expect(parser.diagnostics).to.be.lengthOf(2);
        expectDiagnostics(parser, [{ // expecting opening tag but got prolog
            code: DiagnosticMessages.syntaxError('Expecting token of type --> OPEN <-- but found --> \'<?xml \' <--').code,
            location: { range: Range.create(1, 12, 1, 18) }
        }, {
            ...DiagnosticMessages.syntaxError('Syntax error: whitespace found before the XML prolog'),
            location: { range: Range.create(0, 0, 1, 12) }
        }]);
    });

    it('captures the closing tag name on the AST when it mismatches', () => {
        const parser = new SGParser();
        parser.parse(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <children>
                    <Group id="myGroup">
                    </LayoutGroup>
                </children>
            </component>
        `);
        //parsing does not emit the mismatch diagnostic; that happens at validation time
        expect(parser.diagnostics).to.be.lengthOf(0);
        //but the parser should capture the (mismatched) closing tag so validation can inspect it
        const group = parser.ast.componentElement.childrenElement.elements[0];
        expect(group.tokens.startTagName.text).to.equal('Group');
        expect(group.tokens.endTagName?.text).to.equal('LayoutGroup');
        expect(group.tokens.endTagName?.location?.range).to.eql(Range.create(4, 10, 4, 21));
    });

    it('leaves endTagName undefined for self-closing tags', () => {
        const parser = new SGParser();
        parser.parse(trim`
            <?xml version="1.0" encoding="utf-8" ?>
            <component name="ChildScene" extends="ParentScene">
                <children>
                    <Group id="myGroup" />
                </children>
            </component>
        `);
        expect(parser.diagnostics).to.be.lengthOf(0);
        const group = parser.ast.componentElement.childrenElement.elements[0];
        expect(group.tokens.startTagName.text).to.equal('Group');
        expect(group.tokens.endTagName).to.be.undefined;
    });
});
