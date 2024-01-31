import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s, util } from '../../util';
let rootDir = s`${process.cwd()}/rootDir`;
import { createSandbox } from 'sinon';
import { DefinitionProvider } from './DefinitionProvider';
import { URI } from 'vscode-uri';
const sinon = createSandbox();

describe('DefinitionProvider', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        sinon.restore();
    });

    afterEach(() => {
        program.dispose();
        sinon.restore();
    });

    it('handles unknown file type', () => {
        const result = new DefinitionProvider({
            program: program,
            file: undefined,
            position: util.createPosition(1, 2),
            result: []
        }).process();
        expect(result).to.eql([]);
    });

    it('handles callfuncs', () => {
        program.setFile('components/CustomButton.xml', `
            <component name="CustomButton" extends="Group">
                <script uri="CustomButton.brs" />
                <interface>
                    <function name="clickCustomButton" />
                </interface>
            </component>
        `);
        const customButtonBrs = program.setFile('components/CustomButton.brs', `
            function clickCustomButton()
            end function
        `);
        const main = program.setFile('source/main.brs', `
            sub main()
                m.customButton@.clickCustomButton()
            end sub
        `);
        //   m.customButton@.click|CustomButon()
        expect(
            program.getDefinition(main.srcPath, util.createPosition(2, 37))
        ).to.eql([{
            uri: URI.file(customButtonBrs.srcPath).toString(),
            range: util.createRange(1, 21, 1, 38)
        }]);
    });

    it('handles goto', () => {
        const main = program.setFile('source/main.brs', `
            sub main()
                label1:
                print "label1"
                goto label1
            end sub
        `);
        // goto lab|el1
        expect(
            program.getDefinition(main.srcPath, util.createPosition(4, 24))
        ).to.eql([{
            uri: URI.file(main.srcPath).toString(),
            range: util.createRange(2, 16, 2, 22)
        }]);
    });
});
