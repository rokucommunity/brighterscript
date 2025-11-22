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
            definitions: []
        }).process();
        expect(result).to.eql([]);
    });

    it('handles callfuncs', () => {
        const customButtonXml = program.setFile('components/CustomButton.xml', `
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
        const brsFile = program.setFile('source/main.brs', `
            sub main()
                m.customButton@.clickCustomButton()
            end sub
        `);
        //   m.customButton@.click|CustomButon()
        expect(
            program.getDefinition(brsFile.srcPath, util.createPosition(2, 37))
        ).to.eql([{
            uri: URI.file(customButtonXml.srcPath).toString(),
            range: util.createRange(4, 21, 4, 57)
        }, {
            uri: URI.file(customButtonBrs.srcPath).toString(),
            range: util.createRange(1, 21, 1, 38)
        }]);
    });

    it('handles callfuncs for xml file having no interface', () => {
        program.setFile('components/CustomButton.xml', `
            <component name="CustomButton" extends="Group">
            </component>
        `);
        const main = program.setFile('source/main.brs', `
            sub main()
                m.customButton@.clickCustomButton()
            end sub
        `);
        //   m.customButton@.click|CustomButon()
        expect(
            program.getDefinition(main.srcPath, util.createPosition(2, 37))
        ).to.eql([]);
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

    it('handles import statements', () => {
        const utils = program.setFile('source/utils.brs', `
            function helper()
            end function
        `);
        const utils2 = program.setFile('source/subfolder/utils2.brs', `
            import "../utils.brs"
            function helper2()
                helper()
            end function
        `);
        const main = program.setFile('source/main.brs', `
            import "utils.brs"
            import "pkg:/source/subfolder/utils2.brs"
            sub main()
                helper()
                helper2()
            end sub
        `);
        // import "u|tils.brs"
        expect(
            program.getDefinition(main.srcPath, util.createPosition(1, 21))
        ).to.eql([{
            uri: URI.file(utils.srcPath).toString(),
            range: util.createRange(1, 0, 1, 0)
        }]);
        // import "pkg:/subfolder/ut|ils2.brs"
        expect(
            program.getDefinition(main.srcPath, util.createPosition(2, 44))
        ).to.eql([{
            uri: URI.file(utils2.srcPath).toString(),
            range: util.createRange(1, 0, 1, 0)
        }]);
        // import "../u|tils.brs"
        expect(
            program.getDefinition(utils2.srcPath, util.createPosition(1, 21))
        ).to.eql([{
            uri: URI.file(utils.srcPath).toString(),
            range: util.createRange(1, 0, 1, 0)
        }]);
    });
});
