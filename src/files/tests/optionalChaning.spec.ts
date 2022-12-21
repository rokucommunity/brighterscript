import * as sinonImport from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { getTestTranspile } from '../../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../../testHelpers.spec';

let sinon = sinonImport.createSandbox();

describe('optional chaining', () => {
    let program: Program;
    const testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            stagingDir: stagingDir
        });
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
        program.dispose();
    });

    it('transpiles ?. properly', async () => {
        await testTranspile(`
            sub main()
                print m?.value
            end sub
        `);
    });

    it('transpiles ?[ properly', async () => {
        await testTranspile(`
            sub main()
                print m?["value"]
            end sub
        `);
    });

    it(`transpiles '?.[`, async () => {
        await testTranspile(`
            sub main()
                print m?["value"]
            end sub
        `);
    });

    it(`transpiles '?@`, async () => {
        await testTranspile(`
            sub main()
                someXml = invalid
                print someXml?@someAttr
            end sub
        `);
    });

    it(`transpiles '?(`, async () => {
        await testTranspile(`
            sub main()
                localFunc = sub()
                end sub
                print localFunc?()
                print m.someFunc?()
            end sub
        `);
    });

    it('transpiles various use cases', async () => {
        await testTranspile(`
            sub main()
                obj = {}
                arr = []
                print arr?.["0"]
                print arr?.value
                print obj?.[0]
                print obj?.getName()?.first?.second
                print createObject("roByteArray")?.value
                print createObject("roByteArray")?["0"]
                print createObject("roList")?.value
                print createObject("roList")?["0"]
                print createObject("roXmlList")?["0"]
                print createObject("roDateTime")?.value
                print createObject("roDateTime")?.GetTimeZoneOffset
                print createObject("roSGNode", "Node")?[0]
                print obj?.first?.second
                print obj?.first?.second
                print obj.b.xmlThing?@someAttr
                print obj.b.localFunc?()
            end sub
        `);
    });
});
