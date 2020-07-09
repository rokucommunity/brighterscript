import { Stopwatch } from './Stopwatch';
import { expect } from 'chai';

describe('Stopwatch', () => {
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
