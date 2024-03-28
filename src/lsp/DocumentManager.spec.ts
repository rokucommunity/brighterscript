import { expect } from 'chai';
import util from '../util';
import { DocumentManager } from './DocumentManager';

describe('DocumentManager', () => {
    let manager: DocumentManager;
    beforeEach(() => {
        manager = new DocumentManager({
            delay: 5
        });
    });

    it('throttles multiple events', async () => {
        const actionsPromise = manager.once('flush');
        manager.set('alpha', 'one');
        await util.sleep(1);
        manager.set('alpha', 'two');
        await util.sleep(1);
        manager.set('alpha', 'three');
        expect(
            await actionsPromise
        ).to.eql({
            actions: [
                {
                    type: 'set',
                    srcPath: 'alpha',
                    fileContents: 'three',
                    allowStandaloneProject: false
                }
            ]
        });
    });

    it('any file change delays the first one', async () => {
        const actionsPromise = manager.once('flush');

        manager.set('alpha', 'one');
        await util.sleep(1);

        manager.set('beta', 'two');
        await util.sleep(1);

        manager.set('alpha', 'three');
        await util.sleep(1);

        manager.set('beta', 'four');
        await util.sleep(1);

        expect(
            await actionsPromise
        ).to.eql({
            actions: [
                {
                    type: 'set',
                    srcPath: 'alpha',
                    fileContents: 'three',
                    allowStandaloneProject: false
                }, {
                    type: 'set',
                    srcPath: 'beta',
                    fileContents: 'four',
                    allowStandaloneProject: false
                }
            ]
        });
    });

    it('keeps the last-in change', async () => {
        manager.set('alpha', 'one');
        manager.delete('alpha');
        expect(
            await manager.once('flush')
        ).to.eql({
            actions: [
                {
                    type: 'delete',
                    srcPath: 'alpha'
                }
            ]
        });

        manager.set('alpha', 'two');
        manager.delete('alpha');
        manager.set('alpha', 'three');
        expect(
            await manager.once('flush')
        ).to.eql({
            actions: [
                {
                    type: 'set',
                    srcPath: 'alpha',
                    fileContents: 'three',
                    allowStandaloneProject: false
                }
            ]
        });
    });
});
