import { ActionPipeline } from './ActionPipeline';
import { expect } from './chai-config.spec';
import util from './util';

describe('ActionPipeline', () => {
    let pipeline: ActionPipeline;
    beforeEach(() => {
        pipeline = new ActionPipeline();
    });

    it('returns the action result', async () => {
        expect(
            await pipeline.run(() => 'hello')
        ).to.eql('hello');
    });

    it('supports actions that return a promise', async () => {
        expect(
            await pipeline.run(async () => {
                await util.sleep(1);
                return 'world';
            })
        ).to.eql('world');
    });

    it('rejects when a synchronous action throws', async () => {
        let error: Error;
        try {
            await pipeline.run(() => {
                throw new Error('sync boom');
            });
        } catch (e) {
            error = e as Error;
        }
        expect(error?.message).to.eql('sync boom');
    });

    it('rejects when an async action throws', async () => {
        let error: Error;
        try {
            await pipeline.run(async () => {
                await util.sleep(1);
                throw new Error('async boom');
            });
        } catch (e) {
            error = e as Error;
        }
        expect(error?.message).to.eql('async boom');
    });

    it('runs a single async action at a time', async () => {
        const events: string[] = [];
        const action = (name: string, delay: number) => {
            return pipeline.run(async () => {
                events.push(`${name}-start`);
                await util.sleep(delay);
                events.push(`${name}-end`);
            });
        };
        //the first action takes the longest, so without serialization the others would finish first
        await Promise.all([
            action('a', 20),
            action('b', 5),
            action('c', 1)
        ]);
        expect(events).to.eql([
            'a-start', 'a-end',
            'b-start', 'b-end',
            'c-start', 'c-end'
        ]);
    });

    it('keeps processing subsequent actions after one rejects', async () => {
        const events: string[] = [];
        const failure = pipeline.run(async () => {
            await util.sleep(5);
            throw new Error('first failed');
        });
        const success = pipeline.run(() => {
            events.push('second ran');
            return 'second';
        });

        let error: Error;
        try {
            await failure;
        } catch (e) {
            error = e as Error;
        }
        expect(error?.message).to.eql('first failed');
        expect(await success).to.eql('second');
        expect(events).to.eql(['second ran']);
    });

    it('runs work enqueued while the queue is idle', async () => {
        expect(await pipeline.run(() => 1)).to.eql(1);
        //the queue has fully drained. make sure a later action still gets processed
        expect(await pipeline.run(() => 2)).to.eql(2);
    });

    it('runs work enqueued from within a running action after that action finishes', async () => {
        const events: string[] = [];
        //don't await the inner action from inside the outer one; a serial queue can't satisfy that
        let inner: Promise<void>;
        await pipeline.run(async () => {
            events.push('outer-start');
            inner = pipeline.run(() => {
                events.push('inner');
            });
            await util.sleep(5);
            events.push('outer-end');
        });
        await inner;
        expect(events).to.eql(['outer-start', 'outer-end', 'inner']);
    });
});
