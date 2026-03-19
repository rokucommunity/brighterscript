import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s, util } from '../../util';
let rootDir = s`${process.cwd()}/rootDir`;
import { createSandbox } from 'sinon';
import { DefinitionProvider } from './DefinitionProvider';
import { URI } from 'vscode-uri';
import { tempDir } from '../../testHelpers.spec';
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

    it('handles import statements with src;dest remapped paths', () => {
        //map all of these files from arbitrary locations into the pkg
        program.setFile({
            src: s`${tempDir}/flavor1/flavorSource/utils.brs`,
            dest: 'source/utils.brs'
        }, `
            function helper()
            end function
        `);
        const utils2 = program.setFile({
            src: s`${tempDir}/flavor2/flavorSource/sub/utils2.brs`,
            dest: 'source/subfolder/utils2.brs'
        }, `
            import "../utils.brs"
            function helper2()
                helper()
            end function
        `);
        const main = program.setFile({
            src: s`${tempDir}/mainApp/src/source1/main.brs`,
            dest: 'source/main.brs'
        }, `
            import "utils.brs"
            import "pkg:/source/subfolder/utils2.brs"
            sub main()
                helper()
                helper2()
            end sub
        `);

        //main.brs
        // import "u|tils.brs"
        expect(
            program.getDefinition(main.srcPath, util.createPosition(1, 21))
        ).to.eql([{
            uri: URI.file(s`${tempDir}/flavor1/flavorSource/utils.brs`).toString(),
            range: util.createRange(1, 0, 1, 0)
        }]);

        //main.brs
        // import "pkg:/subfolder/ut|ils2.brs"
        expect(
            program.getDefinition(main.srcPath, util.createPosition(2, 44))
        ).to.eql([{
            uri: URI.file(s`${tempDir}/flavor2/flavorSource/sub/utils2.brs`).toString(),
            range: util.createRange(1, 0, 1, 0)
        }]);

        //utils2.brs
        // import "../u|tils.brs"
        expect(
            program.getDefinition(utils2.srcPath, util.createPosition(1, 21))
        ).to.eql([{
            uri: URI.file(s`${tempDir}/flavor1/flavorSource/utils.brs`).toString(),
            range: util.createRange(1, 0, 1, 0)
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

    it('handles script tag uri go-to-definition', () => {
        const brsFile = program.setFile('components/MainScene.brs', `
            sub main()
            end sub
        `);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/MainScene.brs" />
            </component>
        `);
        // Line 2 (0-indexed): `                <script type="text/brightscript" uri="pkg:/components/MainScene.brs" />`
        // The uri value range starts at the opening `"` for `pkg:/components/MainScene.brs`
        const result = program.getDefinition(xmlFile.srcPath, util.createPosition(2, 60));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(brsFile.srcPath).toString()
        });
        // originSelectionRange should cover the full URI value (the entire filePathRange)
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles script tag uri go-to-definition with relative path', () => {
        const brsFile = program.setFile('components/MainScene.brs', `
            sub main()
            end sub
        `);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="MainScene.brs" />
            </component>
        `);
        // Line 2 (0-indexed): `                <script type="text/brightscript" uri="MainScene.brs" />`
        // The uri value range starts at the opening `"` for `MainScene.brs`
        const result = program.getDefinition(xmlFile.srcPath, util.createPosition(2, 54));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(brsFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('returns empty array when script tag uri file is not found', () => {
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/NotFound.brs" />
            </component>
        `);
        // click within "pkg:/components/NotFound.brs" uri value
        expect(
            program.getDefinition(xmlFile.srcPath, util.createPosition(2, 60))
        ).to.eql([]);
    });
});
