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

    it(`transpiles '?.[`, () => {
        testTranspile(`
            sub main()
                print m?["value"]
            end sub
        `);
    });

    it('transpiles various use cases', () => {
        testTranspile(`
            print arr?.["0"]
            print arr?.value
            print assocArray?.[0]
            print assocArray?.getName()?.first?.second
            print createObject("roByteArray")?.value
            print createObject("roByteArray")?["0"]
            print createObject("roList")?.value
            print createObject("roList")?["0"]
            print createObject("roXmlList")?["0"]
            print createObject("roDateTime")?.value
            print createObject("roDateTime")?.GetTimeZoneOffset
            print createObject("roSGNode", "Node")?[0]
            print pi?.first?.second
            print success?.first?.second
        `);
    });
});
