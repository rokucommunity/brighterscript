
import { rootDir } from '../../../testHelpers.spec';
import { Program } from '../../../Program';
import { createSandbox } from 'sinon';
import { getTestTranspile } from '../../../testHelpers.spec';
import util from '../../../util';

const sinon = createSandbox();

describe('ForEachStatement', () => {
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program(util.normalizeConfig({ rootDir: rootDir, sourceMap: true }));
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('transpiles a simple loop', () => {
        testTranspile(`
            sub doLoop(data)
                for each i in data
                    print i
                end for
            end sub
        `);
    });

    it('adds newline to end of empty loop declaration', () => {
        testTranspile(`
            sub doLoop(data)
                for each i in data
                end for
            end sub
        `);
    });

});
