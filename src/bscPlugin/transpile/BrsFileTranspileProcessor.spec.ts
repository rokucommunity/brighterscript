import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir } from '../../testHelpers.spec';
import { expect } from 'chai';
import { Parser } from '../../parser/Parser';
import { isFunctionStatement } from '../../astUtils/reflection';
import type { FunctionStatement } from '../../parser/Statement';
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
        await program.build({ stagingDir: s`${tempDir}/out` });
    });

    it('properly prefixes functions from bslib', async () => {
        program.options.stagingDir = s`${tempDir}/staging`;
        program.setFile('source/main.bs', `
            sub main()
                print true ? true : false
            end sub
        `);
        program.validate();
        await program.build();
        expect(
            fsExtra.readFileSync(`${program.options.stagingDir}/source/bslib.brs`).toString()
        ).to.include('bslib_toString');
    });

    it('properly prefixes functions from bslib when found in roku_modules as `bslib`', async () => {
        program.options.stagingDir = s`${tempDir}/staging`;
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
            fsExtra.readFileSync(s`${program.options.stagingDir}/source/roku_modules/bslib/bslib.brs`).toString()
        );
        expect(
            parser.ast.findChildren<FunctionStatement>(isFunctionStatement).map(x => x.tokens.name.text)
        ).to.include('bslib_toString');
    });

    it('properly prefixes functions from bslib when found in roku_modules as `rokucommunity_bslib`', async () => {
        program.options.stagingDir = s`${tempDir}/staging`;
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
            fsExtra.readFileSync(s`${program.options.stagingDir}/source/roku_modules/rokucommunity_bslib/bslib.brs`).toString()
        );
        expect(
            parser.ast.findChildren<FunctionStatement>(isFunctionStatement).map(x => x.tokens.name.text)
        ).to.include('rokucommunity_bslib_toString');
    });
});
