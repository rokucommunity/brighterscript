import { Cache } from './Cache';
import { expect } from 'chai';

describe('Cache', () => {
    let cache: Cache;
    beforeEach(() => {
        cache = new Cache();
    });
    it('instantiates a new internal cache on construct', () => {
        let cache = new Cache();
        expect((cache as any).cache).to.exist;
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
