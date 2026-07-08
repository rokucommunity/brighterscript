import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { tempDir, rootDir } from '../../testHelpers.spec';
import { BslibManager } from './BslibManager';
import { expect } from 'chai';
const sinon = createSandbox();

describe('BslibInjector', () => {

    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    describe('isBslibPkgPath', () => {
        it('works for valid paths', () => {
            expect(
                BslibManager.isBslibPkgPath('source/bslib.brs')
            ).to.be.true;
            expect(
                BslibManager.isBslibPkgPath('source/roku_modules/bslib/bslib.brs')
            ).to.be.true;
            expect(
                BslibManager.isBslibPkgPath('source/roku_modules/rokucommunity_bslib/bslib.brs')
            ).to.be.true;
        });

        it('works for invalid paths', () => {
            expect(
                BslibManager.isBslibPkgPath('source/bslib2.brs')
            ).to.be.false;
            expect(
                BslibManager.isBslibPkgPath('source/roku_modules/1bslib/bslib.brs')
            ).to.be.false;
            expect(
                BslibManager.isBslibPkgPath('source/roku_modules/rokucommunity_bslib/3bslib.brs')
            ).to.be.false;
        });
    });
});
