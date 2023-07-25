import { util } from './util';
import { Program } from './Program';
import { expectDiagnostics, expectZeroDiagnostics, rootDir, stagingDir } from './testHelpers.spec';
import { DiagnosticMessages } from './DiagnosticMessages';
import { expect } from './chai-config.spec';

describe('globalCallables', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir,
            stagingDir: stagingDir
        });
    });
    afterEach(() => {
        program.dispose();
    });

    describe('Roku_ads', () => {
        it('exists', () => {
            program.setFile('source/main.brs', `
                sub main()
                    adIface = Roku_Ads()
                    print adIface
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('Roku_Event_Dispatcher', () => {
        it('exists', () => {
            program.setFile('source/main.brs', `
                sub main()
                    red = Roku_Event_Dispatcher()
                    print red
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    it('isOptional defaults to false', () => {
        program.setFile('source/main.brs', `
            sub main()
                thing = createObject()
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.mismatchArgumentCount('1-6', 0)
        ]);
    });

    it('handles optional params properly', () => {
        program.setFile('source/main.brs', `
            sub main()
                print Mid("value1", 1) 'third param is optional
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('hover shows correct for optional params', () => {
        const file = program.setFile('source/main.brs', `
            sub main()
                print Mid("value1", 1)
            end sub
        `);
        program.validate();
        const hover = program.getHover(file.srcPath, util.createPosition(2, 25));
        expect(
            hover[0].contents.toString().replace('\r\n', '\n')
        ).to.eql([
            '```brightscript',
            'function Mid(s as string, p as integer, n? as integer) as string',
            '```'
        ].join('\n'));
    });

    describe('bslCore', () => {
        it('exists', () => {
            program.setFile('source/main.brs', `
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
            program.setFile('source/main.brs', `
                sub main()
                    print val("1001")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows both parameters', () => {
            program.setFile('source/main.brs', `
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
            program.setFile('source/main.brs', `
                sub main()
                    print StrI(2)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows both parameters', () => {
            program.setFile('source/main.brs', `
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
            program.setFile('source/main.brs', `
                sub main()
                    print ParseJson("{}")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows 2 parameters', () => {
            program.setFile('source/main.brs', `
                sub main()
                print ParseJson("{}", "i")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });
});
