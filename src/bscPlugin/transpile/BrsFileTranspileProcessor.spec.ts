import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { tempDir, rootDir } from '../../testHelpers.spec';
import { expect } from 'chai';
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
});
