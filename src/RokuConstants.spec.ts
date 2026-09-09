import { expect } from './chai-config.spec';
import { getFirmwareCapabilities } from './RokuConstants';

describe('RokuConstants', () => {
    describe('getFirmwareCapabilities', () => {
        it('enables everything for a modern firmware version', () => {
            expect(getFirmwareCapabilities('15.3.0')).to.eql({
                optionalChaining: true,
                continueStatement: true,
                lineContinuation: true
            });
        });

        it('disables everything for a firmware version older than any gated feature', () => {
            expect(getFirmwareCapabilities('10.0.0')).to.eql({
                optionalChaining: false,
                continueStatement: false,
                lineContinuation: false
            });
        });

        it('gates each feature at its own threshold', () => {
            //optional chaining landed in 11.0, continue in 11.5, line continuation in 15.3
            expect(getFirmwareCapabilities('11.0.0')).to.include({
                optionalChaining: true,
                continueStatement: false
            });
            expect(getFirmwareCapabilities('11.5.0')).to.include({
                optionalChaining: true,
                continueStatement: true,
                lineContinuation: false
            });
        });

        it('coerces partial versions', () => {
            expect(getFirmwareCapabilities('11.5').continueStatement).to.be.true;
            expect(getFirmwareCapabilities('11.4').continueStatement).to.be.false;
        });

        it('falls back to the default version when unset or unparseable', () => {
            //DEFAULT_MIN_FIRMWARE_VERSION is 15.0.0, which is above the continue/optional-chaining
            //thresholds but below the 15.3 line-continuation threshold
            for (const value of [undefined, '', 'not-a-version']) {
                expect(getFirmwareCapabilities(value)).to.eql({
                    optionalChaining: true,
                    continueStatement: true,
                    lineContinuation: false
                }, `failed for ${JSON.stringify(value)}`);
            }
        });
    });
});
