import { standardizePath as s } from './util';
import { Program } from './Program';
import { expectDiagnostics, expectZeroDiagnostics } from './testHelpers.spec';
import { DiagnosticMessages } from './DiagnosticMessages';

let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;
let stagingFolderPath = s`${tmpPath}/staging`;

describe('globalCallables', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir,
            stagingFolderPath: stagingFolderPath
        });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('Roku_ads', () => {
        it('exists', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                    adIface = Roku_Ads()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    it('isOptional defaults to false', () => {
        program.addOrReplaceFile('source/main.brs', `
            sub main()
                thing = createObject()
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.mismatchArgumentCount('1-6', 0)
        ]);
    });

    describe('bslCore', () => {
        it('exists', () => {
            program.addOrReplaceFile('source/main.brs', `
                Library "v30/bslCore.brs"

                sub main()
                    print bslBrightScriptErrorCodes()
                    print bslUniversalControlEventCodes()
                    print HexToAscii(AsciiToHex("Hi"))
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('val', () => {
        it('allows single parameter', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print val("1001")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows both parameters', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print val("1001", 10)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('StrI', () => {
        it('allows single parameter', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print StrI(2)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows both parameters', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print StrI(2, 10)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('parseJson', () => {
        it('allows single parameter', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                    print ParseJson("{}")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows 2 parameters', () => {
            program.addOrReplaceFile('source/main.brs', `
                sub main()
                print ParseJson("{}", "i")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });
});
