import * as sinonImport from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { standardizePath as s } from '../../util';
import { getTestTranspile } from '../../testHelpers.spec';

let sinon = sinonImport.createSandbox();
let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;
let stagingFolderPath = s`${tmpPath}/staging`;

describe('optional chaining', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
        program = new Program({
            rootDir: rootDir,
            stagingFolderPath: stagingFolderPath
        });
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
        program.dispose();
    });

    it('transpiles ?. properly', () => {
        testTranspile(`
            sub main()
                print m?.value
            end sub
        `);
    });

    it('transpiles ?[ properly', () => {
        testTranspile(`
            sub main()
                print m?["value"]
            end sub
        `);
    });
});
