import { Cache } from './Cache';
import { expect } from './chai-config.spec';

describe('Cache', () => {
    let cache: Cache;
    beforeEach(() => {
        cache = new Cache();
    });

    describe('getOrAdd', () => {
        it('adds items to the cache', () => {
            cache.getOrAdd('bool', () => {
                return true;
            });
            expect(cache.getOrAdd('bool', () => false)).to.be.true;
        });
    });

    describe('clear', () => {
        it('works', () => {
            cache.getOrAdd('bool', () => {
                return true;
            });
            expect(cache.getOrAdd('bool', () => false)).to.be.true;
            cache.clear();
            expect(cache.getOrAdd('bool', () => false)).to.be.false;
        });
    });
});
