import { expect } from 'chai';
import { trim } from '../testHelpers.spec';
import SGParser from './SGParser';
import { SGTranspileState } from './SGTranspileState';

describe('SGParser', () => {
    it('Parses well formed SG component', () => {
        const parser = new SGParser();
        parser.parse(
            'pkg:/components/ParentScene.xml',
            `<?xml version="1.0" encoding="utf-8" ?>
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
        const { ast, diagnostics } = parser;
        expect(ast.prolog).to.exist;
        expect(ast.component).to.exist;
        expect(ast.root).to.equal(ast.component);
        expect(diagnostics.length).to.equal(0);
        const output = ast.component.transpile(new SGTranspileState('pkg:/components/ParentScene.xml')).toStringWithSourceMap();
        expect(output.code).to.equal(trim`
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
                <children>
                    <Label id="loadingIndicator" text="Loading..." font="font:MediumBoldSystemFont" />
                </children>
            </component>
        `);
    });
});
