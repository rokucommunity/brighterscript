import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s, util } from '../../util';
let rootDir = s`${process.cwd()}/rootDir`;
import { createSandbox } from 'sinon';
import { DefinitionProvider } from './DefinitionProvider';
import { URI } from 'vscode-uri';
import { tempDir } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import * as path from 'path';
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

    it('handles pkg:/ string literal in brs assignment (e.g. poster.uri)', () => {
        const targetFile = program.setFile('source/assets.brs', `
            function getAsset()
            end function
        `);
        const main = program.setFile('source/main.brs', `
            sub main()
                poster = CreateObject("roSGNode", "Poster")
                poster.uri = "pkg:/source/assets.brs"
            end sub
        `);
        // Line 3 (0-indexed): `                poster.uri = "pkg:/source/assets.brs"`
        // "pkg:/source/assets.brs" starts at col 29 (opening ") + content at col 30
        const result = program.getDefinition(main.srcPath, util.createPosition(3, 35));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles relative (./) string literal in brs assignment', () => {
        const targetFile = program.setFile('source/utils.brs', `
            function helper()
            end function
        `);
        const main = program.setFile('source/main.brs', `
            sub main()
                m.uri = "./utils.brs"
            end sub
        `);
        // Line 2 (0-indexed): `                m.uri = "./utils.brs"`
        // "./utils.brs" starts at col 24 (opening ") + content at col 25
        const result = program.getDefinition(main.srcPath, util.createPosition(2, 27));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles relative (../) string literal in brs assignment', () => {
        const targetFile = program.setFile('source/shared.brs', `
            function shared()
            end function
        `);
        const main = program.setFile('source/sub/main.brs', `
            sub main()
                m.uri = "../shared.brs"
            end sub
        `);
        // Line 2 (0-indexed): `                m.uri = "../shared.brs"`
        // "../shared.brs" starts at col 24 (opening ") + content at col 25
        const result = program.getDefinition(main.srcPath, util.createPosition(2, 27));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('does not navigate to non-existent files for arbitrary brs string literals', () => {
        const main = program.setFile('source/main.brs', `
            sub main()
                print "hello world"
            end sub
        `);
        // "hello world" does not match any file in the program
        // Line 2: `                print "hello world"`
        // "hello world" starts at col 22 (opening ") + content at col 23
        const result = program.getDefinition(main.srcPath, util.createPosition(2, 25));
        expect(result).to.eql([]);
    });

    it('handles xml child node uri attribute go-to-definition', () => {
        const targetFile = program.setFile('components/utils.brs', `
            function helper()
            end function
        `);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <children>
                    <Poster uri="pkg:/components/utils.brs" />
                </children>
            </component>
        `);
        // Line 3 (0-indexed): `                    <Poster uri="pkg:/components/utils.brs" />`
        // Attribute value "pkg:/components/utils.brs" starts (after opening ") at col 33
        const result = program.getDefinition(xmlFile.srcPath, util.createPosition(3, 36));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles xml child node backgroundURI attribute go-to-definition', () => {
        const targetFile = program.setFile('components/bg.brs', `
            function getBg()
            end function
        `);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <children>
                    <Scene backgroundURI="pkg:/components/bg.brs" />
                </children>
            </component>
        `);
        // Line 3 (0-indexed): `                    <Scene backgroundURI="pkg:/components/bg.brs" />`
        // backgroundURI value starts (after opening ") at col 42
        const result = program.getDefinition(xmlFile.srcPath, util.createPosition(3, 45));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles xml child node relative uri attribute go-to-definition', () => {
        const targetFile = program.setFile('components/utils.brs', `
            function helper()
            end function
        `);
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <children>
                    <Poster uri="./utils.brs" />
                </children>
            </component>
        `);
        // Line 3 (0-indexed): `                    <Poster uri="./utils.brs" />`
        // Attribute value "./utils.brs" starts (after opening ") at col 33
        const result = program.getDefinition(xmlFile.srcPath, util.createPosition(3, 35));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles bare filename (no prefix) string literal in brs assignment', () => {
        const targetFile = program.setFile('source/utils.brs', `
            function helper()
            end function
        `);
        const main = program.setFile('source/main.brs', `
            sub main()
                m.uri = "utils.brs"
            end sub
        `);
        // "utils.brs" is a bare name that resolves relative to current file's directory
        // Line 2 (0-indexed): `                m.uri = "utils.brs"`
        // "utils.brs" starts at col 24 (opening ") + content at col 25
        const result = program.getDefinition(main.srcPath, util.createPosition(2, 27));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles bare filename with extension in brs assignment', () => {
        const targetFile = program.setFile('source/myAsset.brs', `
            function helper()
            end function
        `);
        const main = program.setFile('source/main.brs', `
            sub main()
                m.uri = "myAsset.brs"
            end sub
        `);
        // "myAsset.brs" is a bare name that resolves relative to current file's directory
        // Line 2 (0-indexed): `                m.uri = "myAsset.brs"`
        // "myAsset.brs" starts at col 24 (opening ") + content at col 25
        const result = program.getDefinition(main.srcPath, util.createPosition(2, 27));
        expect(result).to.be.lengthOf(1);
        expect(result[0]).to.include({
            targetUri: URI.file(targetFile.srcPath).toString()
        });
        expect((result[0] as any).originSelectionRange).to.exist;
    });

    it('handles mangled AST without throwing', () => {
        // Set up a file and corrupt its parser's AST to simulate a mangled parse result
        const main = program.setFile('source/main.brs', `
            sub main()
                print "hello"
            end sub
        `);
        const parserRef = (main as any)._parser;
        const originalAst = parserRef?.ast;
        // Corrupt the parser's AST so AST walks throw
        if (parserRef) {
            parserRef.ast = null;
        }
        let result: any[];
        expect(() => {
            result = program.getDefinition(main.srcPath, util.createPosition(2, 25));
        }).not.to.throw();
        expect(result).to.eql([]);
        // Restore
        if (parserRef) {
            parserRef.ast = originalAst;
        }
    });

    it('handles mangled XML AST without throwing', () => {
        const xmlFile = program.setFile('components/MainScene.xml', `
            <component name="MainScene" extends="Scene">
                <script type="text/brightscript" uri="pkg:/components/MainScene.brs" />
            </component>
        `);
        // Corrupt the XML parser's AST to simulate a mangled parse result
        const parserRef = (xmlFile as any).parser;
        const originalAst = parserRef?.ast;
        if (parserRef) {
            parserRef.ast = null;
        }
        let result: any[];
        expect(() => {
            result = program.getDefinition(xmlFile.srcPath, util.createPosition(2, 60));
        }).not.to.throw();
        expect(result).to.eql([]);
        // Restore
        if (parserRef) {
            parserRef.ast = originalAst;
        }
    });

    describe('disk-based file lookup for non-program files', () => {
        let diskProgram: Program;
        const diskRootDir = s`${tempDir}/definitionProviderDiskTest`;

        beforeEach(() => {
            fsExtra.emptyDirSync(diskRootDir);
            diskProgram = new Program({
                rootDir: diskRootDir,
                // Use default files array so images match
                files: ['**/*']
            });
        });

        afterEach(() => {
            diskProgram.dispose();
            fsExtra.removeSync(diskRootDir);
        });

        it('navigates to an image asset that exists on disk and matches the files array', () => {
            // Create a real image file on disk
            const imgRelPath = path.join('images', 'hero.png');
            const imgSrcPath = s`${diskRootDir}/${imgRelPath}`;
            fsExtra.outputFileSync(imgSrcPath, 'PNG_DUMMY');

            const main = diskProgram.setFile('source/main.brs', `
                sub main()
                    m.uri = "pkg:/images/hero.png"
                end sub
            `);
            // Line 2 (0-indexed): `                    m.uri = "pkg:/images/hero.png"`
            const result = diskProgram.getDefinition(main.srcPath, util.createPosition(2, 32));
            expect(result).to.be.lengthOf(1);
            expect(result[0]).to.include({
                targetUri: URI.file(imgSrcPath).toString()
            });
            expect((result[0] as any).originSelectionRange).to.exist;
        });

        it('does not navigate to an image asset that does not exist on disk', () => {
            const main = diskProgram.setFile('source/main.brs', `
                sub main()
                    m.uri = "pkg:/images/missing.png"
                end sub
            `);
            const result = diskProgram.getDefinition(main.srcPath, util.createPosition(2, 32));
            expect(result).to.eql([]);
        });

        it('navigates to an image asset via XML attribute that exists on disk', () => {
            // Create a real image file on disk
            const imgRelPath = path.join('images', 'poster.png');
            const imgSrcPath = s`${diskRootDir}/${imgRelPath}`;
            fsExtra.outputFileSync(imgSrcPath, 'PNG_DUMMY');

            const xmlFile = diskProgram.setFile('components/MainScene.xml', `
                <component name="MainScene" extends="Scene">
                    <children>
                        <Poster uri="pkg:/images/poster.png" />
                    </children>
                </component>
            `);
            // Line 3 (0-indexed): `                        <Poster uri="pkg:/images/poster.png" />`
            // uri value starts after opening " at col ~37
            const result = diskProgram.getDefinition(xmlFile.srcPath, util.createPosition(3, 40));
            expect(result).to.be.lengthOf(1);
            expect(result[0]).to.include({
                targetUri: URI.file(imgSrcPath).toString()
            });
            expect((result[0] as any).originSelectionRange).to.exist;
        });

        it('does not navigate to an image asset via XML attribute when file is not on disk', () => {
            const xmlFile = diskProgram.setFile('components/MainScene.xml', `
                <component name="MainScene" extends="Scene">
                    <children>
                        <Poster uri="pkg:/images/nonexistent.png" />
                    </children>
                </component>
            `);
            const result = diskProgram.getDefinition(xmlFile.srcPath, util.createPosition(3, 40));
            expect(result).to.eql([]);
        });
    });
});
