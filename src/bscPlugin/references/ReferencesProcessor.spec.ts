import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { util } from '../../util';
import { createSandbox } from 'sinon';
import { rootDir } from '../../testHelpers.spec';
let sinon = createSandbox();

describe('ReferencesProcessor', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({ rootDir: rootDir, sourceMap: true });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('provides references', () => {
        const file = program.setFile('source/main.bs', `
            sub main()
                hello = 1
                print hello
            end sub
        `);
        const references = program.getReferences({
            srcPath: file.srcPath,
            position: util.createPosition(3, 25)
        });
        expect(
            references
        ).to.eql([{
            srcPath: file.srcPath,
            range: util.createRange(2, 16, 2, 21)
        }, {
            srcPath: file.srcPath,
            range: util.createRange(3, 22, 3, 27)
        }]);
    });
});
