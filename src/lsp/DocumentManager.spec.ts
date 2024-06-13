import { expect } from 'chai';
import util from '../util';
import type { DocumentAction } from './DocumentManager';
import { DocumentManager } from './DocumentManager';

describe('DocumentManager', () => {
    let manager: DocumentManager;
    let results: DocumentAction[] = [];

    beforeEach(() => {
        results = [];
        manager = new DocumentManager({
            delay: 5,
            flushHandler: (event) => {
                results.push(...event.actions);
            }
        });
    });

    it('throttles multiple events', async () => {
        manager.set({ srcPath: 'alpha', fileContents: 'one' });
        await util.sleep(1);
        manager.set({ srcPath: 'alpha', fileContents: 'two' });
        await util.sleep(1);
        manager.set({ srcPath: 'alpha', fileContents: 'three' });

        await manager.onIdle();

        expect(
            results
        ).to.eql([{
            type: 'set',
            srcPath: 'alpha',
            fileContents: 'three',
            allowStandaloneProject: false
        }]);
    });

    it('any file change delays the first one', async () => {
        manager.set({ srcPath: 'alpha', fileContents: 'one' });
        await util.sleep(1);

        manager.set({ srcPath: 'beta', fileContents: 'two' });
        await util.sleep(1);

        manager.set({ srcPath: 'alpha', fileContents: 'three' });
        await util.sleep(1);

        manager.set({ srcPath: 'beta', fileContents: 'four' });
        await util.sleep(1);

        await manager.onIdle();

        expect(results).to.eql([{
            type: 'set',
            srcPath: 'alpha',
            fileContents: 'three',
            allowStandaloneProject: false
        }, {
            type: 'set',
            srcPath: 'beta',
            fileContents: 'four',
            allowStandaloneProject: false
        }]);
    });

    it('keeps the last-in change', async () => {
        manager.set({ srcPath: 'alpha', fileContents: 'one' });
        manager.delete('alpha');

        await manager.onIdle();

        expect(results).to.eql([{
            type: 'delete',
            srcPath: 'alpha'
        }]);

        results = [];

        manager.set({ srcPath: 'alpha', fileContents: 'two' });
        manager.delete('alpha');
        manager.set({ srcPath: 'alpha', fileContents: 'three' });

        await manager.onIdle();

        expect(results).to.eql([{
            type: 'set',
            srcPath: 'alpha',
            fileContents: 'three',
            allowStandaloneProject: false
        }]);
    });
});
