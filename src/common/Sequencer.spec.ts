import { CancellationTokenSource } from 'vscode-languageserver-protocol';
import { Sequencer } from './Sequencer';
import { expect } from '../chai-config.spec';

describe('Sequencer', () => {
    it('cancels when asked', () => {
        const cancellationTokenSource = new CancellationTokenSource();
        const values = [];
        void new Sequencer({
            name: 'test',
            cancellationToken: cancellationTokenSource.token,
            minSyncDuration: 100
        }).forEach([1, 2, 3], (i) => {
            values.push(i);
            if (i === 2) {
                cancellationTokenSource.cancel();
            }
        }).run();

        expect(values).to.eql([1, 2]);
    });

    it('throws when returning a promise from runSync', () => {
        let error;
        try {
            void new Sequencer({
                name: 'test',
                minSyncDuration: 100
            }).once(() => {
                return Promise.resolve();
            }).run();
        } catch (e) {
            error = e;
        }
        expect(error.message).to.eql(`Action returned a promise which is unsupported when running 'runSync'`);
    });

    it('waits for async actions to complete', async () => {
        const values = [];
        await new Sequencer({
            name: 'test',
            async: true,
            minSyncDuration: 100
        }).forEach([1, 2, 3], async (i) => {
            await new Promise((resolve) => {
                setTimeout(resolve, 10);
            });
            values.push(i);
        }).run();

        expect(values).to.eql([1, 2, 3]);
    });
});
