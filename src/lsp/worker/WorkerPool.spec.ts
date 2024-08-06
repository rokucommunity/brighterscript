import { expect } from 'chai';
import { WorkerPool } from './WorkerPool';
import type { Worker } from 'worker_threads';

describe('WorkerPool', () => {
    let pool: WorkerPool;
    let workers: Worker[] = [] as any;

    beforeEach(() => {
        workers = [];
        //our factory will create empty objects. This prevents us from having to actually run threads.
        pool = new WorkerPool(() => {
            const worker = {} as Worker;
            workers.push(worker);
            return worker;
        });
    });

    describe('preload', () => {
        it('ensures enough free workers have been created', () => {
            expect(workers.length).to.eql(0);

            pool.preload(5);
            expect(workers.length).to.eql(5);

            pool.preload(7);
            expect(workers.length).to.eql(7);
        });
    });

    describe('releaseWorker', () => {
        it('releases a worker back to the pool', () => {
            const worker = pool.getWorker();
            expect(pool['freeWorkers']).lengthOf(0);

            pool.releaseWorker(worker);
            expect(pool['freeWorkers']).lengthOf(1);

            //doesn't crash if we do the same thing again
            pool.releaseWorker(worker);
            expect(pool['freeWorkers']).lengthOf(1);
        });
    });

    describe('getWorker', () => {
        it('creates a new worker when none exist', () => {
            expect(pool['allWorkers']).to.be.empty;
            expect(pool['freeWorkers']).to.be.empty;
            const worker = pool.getWorker();
            expect(worker).to.eql(workers[0]);
            expect(pool['allWorkers']).to.be.lengthOf(1);
            //should be same instance
            expect(pool['allWorkers'][0]).equals(workers[0]);
        });
    });

    describe('dispose', () => {
        it('does not crash when worker.terminate() fails', () => {
            const worker = pool.getWorker();
            worker['terminate'] = () => {
                throw new Error('Test crash');
            };
            //should not throw error
            pool.dispose();
        });
    });
});
