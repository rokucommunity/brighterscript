import { expect } from '../../chai-config.spec';
import { Program } from '../../Program';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { tempDir, trim } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';

describe('ProgramValidator', () => {
    describe('manifest rsg_version validation', () => {
        let program: Program;

        beforeEach(() => {
            fsExtra.ensureDirSync(tempDir);
            fsExtra.emptyDirSync(tempDir);
        });
        afterEach(() => {
            program?.dispose();
            fsExtra.emptyDirSync(tempDir);
        });

        function setup(manifestContent: string, opts: { minFirmwareVersion?: string } = {}) {
            fsExtra.writeFileSync(`${tempDir}/manifest`, manifestContent);
            program = new Program({
                rootDir: tempDir,
                minFirmwareVersion: opts.minFirmwareVersion
            });
        }

        function getCodes() {
            return program.getDiagnostics().map(d => d.code);
        }

        it('flags rsg_version=1.0 as REMOVED under default firmware (15.0 >= 9.0)', () => {
            //1.0 was both deprecated (8.0) and removed (9.0); removal takes precedence
            setup(trim`
                title=t
                rsg_version=1.0
            `);
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionRemoved('1.0', '9.0.0', '1.2').code
            );
            //the deprecation diagnostic should NOT also fire (removal takes precedence)
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionDeprecated('1.0', '1.2').code
            );
        });

        it('flags rsg_version=1.0 as deprecated when firmware is in the deprecation window (8.0 <= fw < 9.0)', () => {
            setup(trim`
                title=t
                rsg_version=1.0
            `, { minFirmwareVersion: '8.5.0' });
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionDeprecated('1.0', '1.2').code
            );
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionRemoved('1.0', '9.0.0', '1.2').code
            );
        });

        it('does NOT flag rsg_version=1.0 as deprecated when minFirmwareVersion is below 8.0.0', () => {
            //pre-deprecation firmware: 1.0 was still supported, no warning needed
            setup(trim`
                title=t
                rsg_version=1.0
            `, { minFirmwareVersion: '7.0.0' });
            program.validate();
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionDeprecated('1.0', '1.2').code
            );
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionRemoved('1.0', '9.0.0', '1.2').code
            );
        });

        it('flags rsg_version=1.1 as REMOVED under default firmware (15.0 >= 14.5)', () => {
            //OS 14.5 silently substitutes rsg_version=1.1 → 1.2; manifest entry no longer honored
            setup(trim`
                title=t
                rsg_version=1.1
            `);
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionRemoved('1.1', '14.5.0', '1.2').code
            );
        });

        it('does NOT flag rsg_version=1.1 as removed when minFirmwareVersion is below 14.5.0', () => {
            setup(trim`
                title=t
                rsg_version=1.1
            `, { minFirmwareVersion: '11.0.0' });
            program.validate();
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionRemoved('1.1', '14.5.0', '1.2').code
            );
        });

        it('flags rsg_version=1.1 as requiring firmware 7.5.0 when targeting older firmware', () => {
            //pre-7.5 firmware didn't know about rsg_version=1.1 - the manifest entry would be invalid there
            setup(trim`
                title=t
                rsg_version=1.1
            `, { minFirmwareVersion: '7.0.0' });
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionRequiresMinFirmware('1.1', '7.5.0', '7.0.0').code
            );
        });

        it('flags rsg_version=1.3 with firmware below 15.0.0 as requiring 15.0.0', () => {
            //capability check: 1.3 was introduced at OS 15.0
            setup(trim`
                title=t
                rsg_version=1.3
            `, { minFirmwareVersion: '14.0.0' });
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionRequiresMinFirmware('1.3', '15.0.0', '14.0.0').code
            );
        });

        it('does NOT flag rsg_version=1.3 capability check when minFirmwareVersion is 15.0.0+', () => {
            //1.3 works at 15.0 (capability). Roku's cert policy requires 15.1.0+ for new
            //submissions but that's a separate concern not yet modeled (TODO in RokuConstants).
            setup(trim`
                title=t
                rsg_version=1.3
            `, { minFirmwareVersion: '15.0.0' });
            program.validate();
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionRequiresMinFirmware('1.3', '15.0.0', '15.0.0').code
            );
        });

        it('flags rsg_version=1.2 when minFirmwareVersion is below 9.0.0', () => {
            setup(trim`
                title=t
                rsg_version=1.2
            `, { minFirmwareVersion: '8.0.0' });
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionRequiresMinFirmware('1.2', '9.0.0', '8.0.0').code
            );
        });

        it('does NOT flag rsg_version=1.2 with default firmware (15.0.0)', () => {
            //15.0 < 15.1 (1.2's deprecation threshold), so no deprecation warning either
            setup(trim`
                title=t
                rsg_version=1.2
            `);
            program.validate();
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionRequiresMinFirmware('1.2', '9.0.0', '15.0.0').code
            );
            expect(getCodes()).to.not.include(
                DiagnosticMessages.rsgVersionDeprecated('1.2', '1.3').code
            );
        });

        it('flags rsg_version=1.2 as deprecated when minFirmwareVersion is >= 15.1.0', () => {
            //projects targeting 15.1+ can adopt 1.3, so the deprecation warning is actionable
            setup(trim`
                title=t
                rsg_version=1.2
            `, { minFirmwareVersion: '15.1.0' });
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.rsgVersionDeprecated('1.2', '1.3').code
            );
        });

        it('flags an invalid rsg_version format', () => {
            setup(trim`
                title=t
                rsg_version=banana
            `);
            program.validate();
            expect(getCodes()).to.include(
                DiagnosticMessages.invalidRsgVersionFormat('banana').code
            );
        });

        it('does NOT flag a forward-compatible-but-unknown rsg_version (1.5)', () => {
            //we don't know about 1.5, but it parses as semver - trust it.
            //no min-FW or deprecation diagnostic should fire.
            setup(trim`
                title=t
                rsg_version=1.5
            `);
            program.validate();
            const codes = getCodes();
            expect(codes).to.not.include(
                DiagnosticMessages.invalidRsgVersionFormat('1.5').code
            );
            expect(codes.some(c => c === DiagnosticMessages.rsgVersionRequiresMinFirmware('1.5', '', '').code
            )).to.equal(false);
        });

        it('does NOT flag a manifest with no rsg_version entry', () => {
            setup(trim`title=t`);
            program.validate();
            const codes = getCodes();
            expect(codes).to.not.include(
                DiagnosticMessages.invalidRsgVersionFormat('').code
            );
            expect(codes).to.not.include(
                DiagnosticMessages.rsgVersionDeprecated('', '').code
            );
        });

        it('does NOT fire any rsg_version diagnostic when no manifest exists', () => {
            //skip writing the manifest file
            program = new Program({ rootDir: tempDir });
            program.validate();
            const rsgCodes = [
                DiagnosticMessages.invalidRsgVersionFormat('').code,
                DiagnosticMessages.rsgVersionDeprecated('', '').code,
                DiagnosticMessages.rsgVersionRequiresMinFirmware('', '', '').code
            ];
            const codes = getCodes();
            for (const c of rsgCodes) {
                expect(codes).to.not.include(c);
            }
        });

        it('attaches the diagnostic range to the rsg_version line', () => {
            //pick a firmware that puts rsg_version=1.0 in its deprecation window (8.0 <= fw < 9.0)
            //so the deprecation diagnostic fires (not removal); verify the range maps to the value text.
            setup(trim`
                title=t
                rsg_version=1.0
            `, { minFirmwareVersion: '8.5.0' });
            program.validate();
            const diag = program.getDiagnostics().find(d => d.code === DiagnosticMessages.rsgVersionDeprecated('1.0', '1.2').code
            );
            expect(diag).to.exist;
            //rsg_version is on line 1 (0-indexed); the value `1.0` starts at character 12 (after `rsg_version=`)
            expect(diag!.range.start.line).to.equal(1);
            expect(diag!.range.start.character).to.equal(12);
        });
    });
});
