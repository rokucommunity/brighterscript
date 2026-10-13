import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir, trim } from '../../testHelpers.spec';
import { LogLevel, createLogger } from '../../logging';
import PluginInterface from '../../PluginInterface';
const sinon = createSandbox();

describe('BrsFile', () => {

    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        const logger = createLogger({
            logLevel: LogLevel.warn
        });
        program = new Program({ rootDir: rootDir, sourceMap: true }, logger, new PluginInterface([], {
            logger: logger,
            suppressErrors: false
        }));
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('BrsFilePreTranspileProcessor', () => {
        it('does not crash when operating on a file not included by any scope', async () => {
            program.setFile('components/lib.brs', `
                enum Direction
                    up
                    down
                    left
                    right
                end enum
                sub doSomething()
                    a = { b: "c"}
                    print a.b
                    print Direction.up
                end sub
            `);
            await program.transpile([], s`${tempDir}/out`);
        });

        it('resolves const aliases in the namespace where each const is declared', async () => {
            program.setFile('source/color.bs', `
                namespace Theming
                    enum Color
                        WHITE = "#FFFFFF"
                    end enum
                    const PRIMARY_TEXT = Color.WHITE
                end namespace
            `);
            program.setFile('source/metadata.bs', `
                namespace Theming.Metadata
                    const TEXT_COLOR = Theming.PRIMARY_TEXT
                end namespace
            `);
            program.setFile('components/StyleComponent.xml', trim`
                <component name="StyleComponent" extends="Group">
                    <script uri="pkg:/source/color.bs" />
                    <script uri="pkg:/source/metadata.bs" />
                    <script uri="pkg:/components/StyleComponent.bs" />
                </component>
            `);
            program.setFile('components/StyleComponent.bs', `
                namespace Theming.Styles
                    function buildStyle() as object
                        return {
                            color: Theming.Metadata.TEXT_COLOR
                            directColor: Theming.Color.WHITE
                        }
                    end function
                end namespace
            `);

            const outputDir = s`${tempDir}/out`;
            await program.transpile([], outputDir);

            const output = fsExtra.readFileSync(s`${outputDir}/components/StyleComponent.brs`, 'utf8');
            expect(output).to.include('color: "#FFFFFF"');
            expect(output).to.include('directColor: "#FFFFFF"');
            expect(output).not.to.include('Color.WHITE');
        });

        it('keeps reporting circular const references', () => {
            program.setFile('source/circular.bs', `
                namespace Circular
                    const FIRST = SECOND
                    const SECOND = FIRST
                end namespace
            `);
            program.validate();

            expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.include(1132);
        });
    });
});
