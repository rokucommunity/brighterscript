
import { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { createSandbox } from 'sinon';
import { getTestTranspile } from '../../../testHelpers.spec';

const sinon = createSandbox();

describe('ForEachStatement', () => {
    let rootDir = s`${process.cwd()}/.tmp/rootDir`;
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
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
