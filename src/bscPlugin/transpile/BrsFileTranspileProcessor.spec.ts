import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir, trim } from '../../testHelpers.spec';
import { expect } from 'chai';
import { Parser } from '../../files/brs/parser/Parser';
import { isFunctionStatement } from '../../astUtils/reflection';
import type { FunctionStatement } from '../../files/brs/parser/Statement';
import { DiagnosticMessages } from '../../DiagnosticMessages';
const sinon = createSandbox();

describe('BrsFileTranspileProcessor', () => {

    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('does not crash when operating on a file not included by any scope', async () => {
        program.setFile('components/lib.brs', `
            sub doSomething()
                a = { b: "c"}
                print a.b
            end sub
        `);
        await program.build({ outDir: s`${tempDir}/out` });
    });

    it('transpiles ternaries to if statements in every conditional compile branch', async () => {
        fsExtra.outputFileSync(`${rootDir}/manifest`, 'title=test\nbs_const=DEBUG=true\n');
        program.dispose();
        program = new Program({ rootDir: rootDir });
        const file = program.setFile('source/main.bs', `
            #const LOGGING = true
            sub main(x)
            #if DEBUG
                a = x = 1 ? "one" : "other"
            #end if
            #if LOGGING
                b = x = 1 ? "one" : "other"
            #end if
            #if true
                c = x = 1 ? "one" : "other"
            #end if
            #if false
                d = x = 1 ? "one" : "other"
            #end if
            end sub
        `);
        program.validate();
        const { code } = await program.getTranspiledFileContents(file.srcPath);
        expect(code).not.to.include('bslib_ternary');
        expect(code.match(/if x = 1 then/g)).to.have.lengthOf(4);
    });

    it('properly prefixes functions from bslib', async () => {
        program.options.outDir = s`${tempDir}/staging`;
        program.setFile('source/main.bs', `
            sub main()
                print true ? true : false
            end sub
        `);
        program.validate();
        await program.build();
        expect(
            fsExtra.readFileSync(`${program.options.outDir}/source/bslib.brs`).toString()
        ).to.include('bslib_toString');
    });

    it('properly prefixes functions from bslib when found in roku_modules as `bslib`', async () => {
        program.options.outDir = s`${tempDir}/staging`;
        program.setFile('source/main.bs', `
            sub main()
                print true ? true : false
            end sub
        `);
        program.setFile('source/roku_modules/bslib/bslib.brs', `
            function bslib_toString()
            end function
        `);
        program.validate();
        await program.build();

        const parser = Parser.parse(
            fsExtra.readFileSync(s`${program.options.outDir}/source/roku_modules/bslib/bslib.brs`).toString()
        );
        expect(
            parser.ast.findChildren<FunctionStatement>(isFunctionStatement).map(x => x.tokens.name.text)
        ).to.include('bslib_toString');
    });

    it('properly prefixes functions from bslib when found in roku_modules as `rokucommunity_bslib`', async () => {
        program.options.outDir = s`${tempDir}/staging`;
        program.setFile('source/main.bs', `
            sub main()
                print true ? true : false
            end sub
        `);
        program.setFile('source/roku_modules/rokucommunity_bslib/bslib.brs', `
            function rokucommunity_bslib_toString()
            end function
        `);
        program.validate();
        await program.build();

        const parser = Parser.parse(
            fsExtra.readFileSync(s`${program.options.outDir}/source/roku_modules/rokucommunity_bslib/bslib.brs`).toString()
        );
        expect(
            parser.ast.findChildren<FunctionStatement>(isFunctionStatement).map(x => x.tokens.name.text)
        ).to.include('rokucommunity_bslib_toString');
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
        await program.build({ outDir: outputDir });

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

        expect(program.getDiagnostics().map(diagnostic => diagnostic.code)).to.include(DiagnosticMessages.circularReferenceDetected().code);
    });
});
