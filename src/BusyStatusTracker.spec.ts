import { expect } from 'chai';
import { Deferred } from './deferred';
import { BusyStatus, BusyStatusTracker } from './BusyStatusTracker';

describe('BusyStatusTracker', () => {
    let tracker: BusyStatusTracker;

    let latestStatus: BusyStatus;

    beforeEach(() => {
        latestStatus = BusyStatus.idle;
        tracker = new BusyStatusTracker();
        tracker.on('change', (value) => {
            latestStatus = value;
        });
    });

    afterEach(() => {
        tracker?.destroy();
    });

    it('tracks a single run', () => {
        expect(latestStatus).to.eql(BusyStatus.idle);
        tracker.run(() => {
            expect(tracker.status).to.eql(BusyStatus.busy);
        });
        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('tracks a single async flow', async () => {
        const deferred = new Deferred();
        const finishedPromise = tracker.run(() => {
            return deferred.promise;
        });
        expect(latestStatus).to.eql(BusyStatus.busy);

        deferred.resolve();
        await finishedPromise;

        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('independently tracks multiple runs for same program', () => {
        tracker.run(() => {
            expect(latestStatus).to.eql(BusyStatus.busy);
        });
        tracker.run(() => {
            expect(latestStatus).to.eql(BusyStatus.busy);
        });
        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('tracks as `busy` one of the runs is still pending', async () => {
        const deferred = new Deferred();
        tracker.run(() => {
            expect(latestStatus).to.eql(BusyStatus.busy);
        });
        const finishedPromise = tracker.run(() => {
            expect(latestStatus).to.eql(BusyStatus.busy);
            return deferred.promise;
        });
        expect(latestStatus).to.eql(BusyStatus.busy);

        deferred.resolve();
        await finishedPromise;

        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('handles error during synchronous flow', () => {
        try {
            tracker.run(() => {
                throw new Error('Crash');
            });
        } catch { }
        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('handles error during async flow', async () => {
        try {
            await tracker.run(() => {
                return Promise.reject(new Error('Crash'));
            });
        } catch { }
        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('only finalizes on the first call to finalize', () => {
        try {
            tracker.run((finalize) => {
                expect(latestStatus).to.eql(BusyStatus.busy);
                finalize?.();
                expect(latestStatus).to.eql(BusyStatus.idle);
                finalize?.();
                expect(latestStatus).to.eql(BusyStatus.idle);
            });
        } catch { }
        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('supports multiple simultaneous projects', async () => {
        //run the projects out of order
        const deferred2 = new Deferred();
        const run1Promise = tracker.run(() => {
            expect(latestStatus).to.eql(BusyStatus.busy);
            return deferred2.promise;
        });

        const deferred1 = new Deferred();
        const run2Promise = tracker.run(() => {
            expect(latestStatus).to.eql(BusyStatus.busy);
            return deferred1.promise;
        });

        expect(latestStatus).to.eql(BusyStatus.busy);


        deferred1.resolve();
        await run2Promise;
        expect(latestStatus).to.eql(BusyStatus.busy);

        deferred2.resolve();
        await run1Promise;
        expect(latestStatus).to.eql(BusyStatus.idle);
    });

    it('supports unsubscribing from events', () => {
        const changes: BusyStatus[] = []; //contains every busy/idle status change
        const disconnect = tracker.on('change', (status) => changes.push(status));

        expect(changes.length).to.eql(0);

        tracker.run(() => { });
        expect(changes.length).to.eql(2);

        tracker.run(() => { });
        expect(changes.length).to.eql(4);

        disconnect();

        tracker.run(() => { });
        expect(changes.length).to.eql(4);
    });

    it('getStatus returns proper value', () => {
        expect(tracker.status).to.eql(BusyStatus.idle);
        tracker.run(() => {
            expect(tracker.status).to.eql(BusyStatus.busy);
        });
        expect(tracker.status).to.eql(BusyStatus.idle);
    });
});
