import { expect } from 'chai';
import { parse } from './XmlParser';

describe('XmlParser', () => {
    it('Parses well formed SG component', () => {
        const ast = parse(
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
        expect(ast.prolog).to.exist;
        expect(ast.root).to.exist;
        expect(ast.diagnostics.length).to.equal(0);
    });
});
