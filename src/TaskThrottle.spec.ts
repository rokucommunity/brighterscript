import { expect } from 'chai';
import { TaskThrottler } from './TaskThrottler';

describe('TaskThrottler', () => {
    let throttler: TaskThrottler;
    let runs: number;
    let isRunning: boolean;

    beforeEach(() => {
        throttler = new TaskThrottler(() => {
            return new Promise(resolve => {
                if (isRunning) {
                    throw new Error('Another job is running');
                }
                isRunning = true;
                setTimeout(() => {
                    isRunning = false;
                    runs++;
                    resolve();
                }, 10);
            });
        });
        isRunning = false;
        runs = 0;
    });
    it('calling run once results in one run', done => {
        throttler.onIdle = () => {
            expect(runs).to.equal(1);
            done();
        };
        throttler.run();
    });
    it('calling run many times results in two successive runs', done => {
        throttler.onIdle = () => {
            expect(runs).to.equal(2);
            done();
        };
        throttler.run();
        throttler.run();
        throttler.run();
        throttler.run();
    });
});
