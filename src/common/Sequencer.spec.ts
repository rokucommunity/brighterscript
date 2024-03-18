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
});
