import { expect } from 'chai';
import { util, standardizePath as s } from '../util';
import type { DocumentAction, SetDocumentAction } from './DocumentManager';
import { DocumentManager } from './DocumentManager';
import { rootDir } from '../testHelpers.spec';

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

    it('does not lose newly added that arrives during a flush operation', async () => {
        const srcPath = s`${rootDir}/source/main.bs`;

        let contentsQueue = [
            'two',
            'three',
            'four'
        ];
        manager = new DocumentManager({
            delay: 5,
            flushHandler: (event) => {
                //once the flush happens, add NEW data to the queue. this is the data we need to ensure we don't lose
                if (contentsQueue.length > 0) {
                    manager.set({ srcPath: srcPath, fileContents: contentsQueue.shift() });
                }

                //store the actions
                results.push(...event.actions);
            }
        });
        manager.set({ srcPath: srcPath, fileContents: 'one' });
        await manager.onIdle();
        expect(results.map(x => (x as SetDocumentAction).fileContents)).to.eql([
            'one',
            'two',
            'three',
            'four'
        ]);
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
