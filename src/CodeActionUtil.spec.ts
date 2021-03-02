import { expect } from 'chai';
import { codeActionUtil } from './CodeActionUtil';
import util from './util';

describe('CodeActionUtil', () => {
    describe('dedupe', () => {
        it('removes duplicate code actions', () => {
            const changes = [{
                type: 'insert',
                filePath: 'file1',
                newText: 'step 1',
                position: util.createPosition(1, 1)
            }] as any;
            const deduped = codeActionUtil.dedupe([
                codeActionUtil.createCodeAction({
                    title: 'Step 1',
                    changes: changes
                }),
                codeActionUtil.createCodeAction({
                    title: 'Step 2',
                    changes: changes
                }),
                codeActionUtil.createCodeAction({
                    title: 'Step 1',
                    changes: changes
                })
            ]);
            //the duplicate step2 should have been removed
            expect(deduped.map(x => x.title).sort()).to.eql([
                'Step 1',
                'Step 2'
            ]);
        });
    });
});
