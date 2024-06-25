import * as sinonImport from 'sinon';
import * as fsExtra from 'fs-extra';
import { Program } from '../../Program';
import { expectDiagnostics, getTestTranspile } from '../../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../../testHelpers.spec';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import util from '../../util';

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
                print createObject("roByteArray")?.Count
                print createObject("roByteArray")?["0"]
                print createObject("roList")?.Count
                print createObject("roList")?["0"]
                print createObject("roXmlList")?["0"]
                print createObject("roDateTime")?.GetYear
                print createObject("roDateTime")?.GetTimeZoneOffset
                print createObject("roSGNode", "Node")?[0]
                print obj?.first?.second
                print obj?.first?.second
                print obj.b.xmlThing?@someAttr
                print obj.b.localFunc?()
            end sub
        `);
    });

    it('includes final operator in chain', async () => {
        await testTranspile(`
            sub main()
                if m.cardFolderStack <> invalid then
                    m?.cardFolderStack?.visible?.ither = false
                end if
            end sub
        `, undefined, undefined, undefined, false);
    });

    describe('disallows optional chaining on left-hand-side of assignments', () => {
        it('catches simple dotted set', () => {
            program.setFile('source/main.bs', `
                sub main()
                    m?.a = true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                range: util.createRange(2, 20, 2, 24)
            }]);
        });

        it('catches complex dotted set', () => {
            program.setFile('source/main.bs', `
                sub main()
                    m?.a.b?.c = true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                range: util.createRange(2, 20, 2, 29)
            }]);
        });

        it('catches simple indexed set', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = []
                    arr?[1] = true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                range: util.createRange(3, 20, 3, 27)
            }]);
        });

        it('catches complex indexed set', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = []
                    arr[2]?[3] = true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                range: util.createRange(3, 20, 3, 30)
            }]);
        });

        it('catches very complex dotted and indexed sets', () => {
            program.setFile('source/main.bs', `
                sub main()
                    arr = []
                    arr[5][6][7]?.thing = true
                    m.a.b.c.d?[8] = true
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                range: util.createRange(3, 20, 3, 39)
            }, {
                ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                range: util.createRange(4, 20, 4, 33)
            }]);
        });
    });
});
