import { KeyedThrottler } from './KeyedThrottler';
import { expect } from './chai-config.spec';

describe('KeyedThrottler', () => {
    let throttler: KeyedThrottler;
    beforeEach(() => {
        throttler = new KeyedThrottler(0);
    });

    it('returns the correct value for each resolved promise', async () => {
        let results = [null, null, null, null, null];

        //should only run index 0 and index 4
        let promises = [0, 1, 2, 3, 4].map(x => {
            return throttler.run('same-key', () => {
                results[x] = x;
            });
        });
        await Promise.all(promises);
        expect(
            results
        ).to.eql([0, null, null, null, 4]);
    });
});
