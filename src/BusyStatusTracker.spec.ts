import { expect } from 'chai';
import { Deferred } from './deferred';
import { BusyStatus, BusyStatusTracker } from './BusyStatusTracker';
import { createSandbox } from 'sinon';
const sinon = createSandbox();

describe('BusyStatusTracker', () => {
    let tracker: BusyStatusTracker;

    let latestStatus: BusyStatus;

    beforeEach(() => {
        sinon.restore();
        latestStatus = BusyStatus.idle;
        tracker = new BusyStatusTracker();
        tracker.on('change', (value) => {
            latestStatus = value;
        });
    });

    afterEach(() => {
        sinon.restore();
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

    describe('scopedTracking', () => {
        const scope1 = {};

        it('supports scoped tracking', async () => {
            let onStatus = tracker.once('change');
            tracker.beginScopedRun(scope1, 'run1');
            expect(
                await onStatus
            ).to.eql(BusyStatus.busy);

            tracker.beginScopedRun(scope1, 'run2');
            expect(latestStatus).to.eql(BusyStatus.busy);

            await tracker.endScopedRun(scope1, 'run1');
            expect(latestStatus).to.eql(BusyStatus.busy);

            onStatus = tracker.once('change');
            await tracker.endScopedRun(scope1, 'run2');
            expect(
                await onStatus
            ).to.eql(BusyStatus.idle);
        });

        it('clears runs for scope', async () => {
            let onChange = tracker.once('change');
            tracker.beginScopedRun(scope1, 'run1');
            tracker.beginScopedRun(scope1, 'run1');
            tracker.beginScopedRun(scope1, 'run1');

            expect(
                await onChange
            ).to.eql(BusyStatus.busy);

            onChange = tracker.once('change');

            tracker.endAllRunsForScope(scope1);
            expect(
                await onChange
            ).to.eql(BusyStatus.idle);
        });

        it('emits an active-runs-change event when any run changes', async () => {
            let count = 0;
            tracker.on('active-runs-change', () => {
                count++;
            });
            tracker.run(() => { }, 'run1');
            tracker.run(() => { }, 'run2');
            await tracker.run(() => Promise.resolve(true), 'run3');

            tracker.beginScopedRun(this, 'run4');
            tracker.beginScopedRun(this, 'run4');
            await tracker.endScopedRun(this, 'run4');
            await tracker.endScopedRun(this, 'run4');

            //we should have 10 total events (5 starts, 5 ends)
            expect(count).to.eql(10);
        });

        it.only('emits active-runs-change with the correct list of remaining active runs', () => {
            const spy = sinon.spy();
            tracker.on('active-runs-change', spy);
            tracker.run(() => {
                expect(tracker.status).to.eql(BusyStatus.busy);
            }, 'test');
            //small timeout to allow all the events to show up
            expect(spy.callCount).to.eql(2);
            expect(
                spy.getCall(0).args[0].activeRuns.map(x => ({ label: x.label }))
            ).to.eql([
                { label: 'test' }
            ]);
            expect(
                spy.getCall(1).args[0].activeRuns
            ).to.eql([]);
        });

        it('removes the entry for the scope when the last run is cleared', async () => {
            expect(tracker['activeRuns']).to.be.empty;

            tracker.beginScopedRun(scope1, 'run1');

            expect(tracker['activeRuns'].find(x => x.scope === scope1 && x.label === 'run1')).to.exist;

            await tracker.endScopedRun(scope1, 'run1');

            expect(tracker['activeRuns']).to.be.empty;
        });
    });
});
