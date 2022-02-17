
import { standardizePath as s } from '../../../util';
import { Program } from '../../../Program';
import { createSandbox } from 'sinon';
import { getTestTranspile } from '../../../testHelpers.spec';

const sinon = createSandbox();

describe('ForStatement', () => {
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
            sub main()
                for i = 0 to 10
                    print i
                end for
            end sub
        `);
    });

    it('transpiles with a for loop with a step value', () => {
        testTranspile(`
            sub main()
                for i = 0 to 10 step 2
                    print i
                end for
            end sub
        `);
    });

    it('adds newline to end of empty loop declaration', () => {
        testTranspile(`
            sub main()
                for i = 0 to 10
                end for
            end sub
        `);
    });

});
