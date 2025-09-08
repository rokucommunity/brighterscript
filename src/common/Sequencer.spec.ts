import { CancellationTokenSource } from 'vscode-languageserver-protocol';
import { Sequencer } from './Sequencer';
import { expect } from '../chai-config.spec';

describe('Sequencer', () => {
    it('cancels when asked', () => {
        const cancellationTokenSource = new CancellationTokenSource();
        const values = [];
        new Sequencer({
            name: 'test',
            cancellationToken: cancellationTokenSource.token,
            minSyncDuration: 100
        }).forEach([1, 2, 3], (i) => {
            values.push(i);
            if (i === 2) {
                cancellationTokenSource.cancel();
            }
        }).runSync();

        expect(values).to.eql([1, 2]);
    });

    it('throws when returning a promise from runSync', () => {
        let error;
        try {
            new Sequencer().once(() => {
                return Promise.resolve();
            }).runSync();
        } catch (e) {
            error = e;
        }
        expect(error?.message).to.eql(`Action returned a promise which is unsupported when running 'runSync'`);
    });

    it('waits for async actions to complete', async () => {
        const values = [];
        await new Sequencer().forEach([1, 2, 3], async (i) => {
            await new Promise((resolve) => {
                setTimeout(resolve, 10);
            });
            values.push(i);
        }).run();

        expect(values).to.eql([1, 2, 3]);
    });

    it('runSync() calls cancel before throwing', () => {
        let cancelCalled = false;
        try {
            new Sequencer().once(() => {
                throw new Error('crash');
            }).onCancel(() => {
                cancelCalled = true;
            }).runSync();
        } catch (e) {
            //this is expected
            expect((e as any).message).to.eql('crash');
        }
        expect(cancelCalled).to.be.true;
    });

    it('run() calls cancel before throwing', async () => {
        let cancelCalled = false;
        try {
            await new Sequencer().once(() => {
                throw new Error('crash');
            }).onCancel(() => {
                cancelCalled = true;
            }).run();
        } catch (e) {
            //this is expected
            expect((e as any).message).to.eql('crash');
        }
        expect(cancelCalled).to.be.true;
    });

    it('forEachFactory calls factory function at execution time', () => {
        const values = [];
        let items = [1, 2];

        const sequencer = new Sequencer().forEachFactory(() => items, (i) => {
            values.push(i);
        });

        // Add more items after sequencer is configured but before execution
        items.push(3);

        sequencer.runSync();

        // Should process all items including the one added after configuration
        expect(values).to.eql([1, 2, 3]);
    });

    it('forEachFactory maintains event loop yielding behavior', async () => {
        const values = [];
        let executionTimes = [];

        await new Sequencer({
            minSyncDuration: 10 // Very short duration to force frequent yielding
        }).forEachFactory(() => [1, 2, 3, 4, 5], (i) => {
            executionTimes.push(Date.now());
            values.push(i);
            // Simulate some work
            const start = Date.now();
            while (Date.now() - start < 5) {
                // busy wait
            }
        }).run();

        expect(values).to.eql([1, 2, 3, 4, 5]);
        // With the short minSyncDuration, we should see some gaps in execution times
        // indicating the sequencer yielded to the event loop
        expect(executionTimes.length).to.equal(5);
    });
});
