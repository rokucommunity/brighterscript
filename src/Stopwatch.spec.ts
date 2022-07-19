import { expect } from 'chai';
import { Stopwatch } from './Stopwatch';
import { util } from './util';

describe('Stopwatch', () => {
    let stopwatch: Stopwatch;
    beforeEach(() => {
        stopwatch = new Stopwatch();
    });

    it('constructs', () => {
        stopwatch = new Stopwatch();
    });

    it('starts', () => {
        expect(stopwatch['startTime']).to.not.exist;
        stopwatch.start();
        expect(stopwatch['startTime']).to.exist;
    });

    it('resets', () => {
        stopwatch.start();
        expect(stopwatch['startTime']).to.exist;
        stopwatch.reset();
        expect(stopwatch['startTime']).to.not.exist;
    });

    it('stops', async () => {
        stopwatch.start();
        expect(stopwatch['startTime']).to.exist;
        await util.sleep(3);
        stopwatch.stop();
        expect(stopwatch['startTime']).to.not.exist;
        expect(stopwatch['totalMilliseconds']).to.be.gte(2);
    });

    it('stop multiple times has no effect', () => {
        stopwatch.start();
        stopwatch.stop();
        stopwatch.stop();
    });

    it('breaks out hours, minutes, and seconds', () => {
        stopwatch['totalMilliseconds'] = (17 * 60 * 1000) + (43 * 1000) + 30;
        expect(stopwatch.getDurationText()).to.eql('17m43s30.0ms');
    });

    it('returns only seconds and milliseconds', () => {
        stopwatch['totalMilliseconds'] = (43 * 1000) + 30;
        expect(stopwatch.getDurationText()).to.eql('43s30.0ms');
    });

    it('returns only  milliseconds', () => {
        stopwatch['totalMilliseconds'] = 30;
        expect(stopwatch.getDurationText()).to.eql('30.0ms');
    });

    it('works for single run', async () => {
        let stopwatch = new Stopwatch();
        stopwatch.start();
        await new Promise((resolve) => {
            setTimeout(resolve, 2);
        });
        stopwatch.stop();
        expect(stopwatch.totalMilliseconds).to.be.greaterThan(1);
    });

    it('works for multiple start/stop', async () => {
        let stopwatch = new Stopwatch();
        stopwatch.start();
        stopwatch.stop();
        stopwatch.totalMilliseconds = 3;
        stopwatch.start();
        await new Promise((resolve) => {
            setTimeout(resolve, 4);
        });
        stopwatch.stop();
        expect(stopwatch.totalMilliseconds).to.be.at.least(6);
    });

    it('pretty prints', () => {
        let stopwatch = new Stopwatch();
        stopwatch.totalMilliseconds = 45;
        expect(stopwatch.getDurationText()).to.equal('45.0ms');
        stopwatch.totalMilliseconds = 2000 + 45;
        expect(stopwatch.getDurationText()).to.equal('2s45.0ms');
        stopwatch.totalMilliseconds = 180000 + 2000 + 45;
        expect(stopwatch.getDurationText()).to.equal('3m2s45.0ms');
    });
});
