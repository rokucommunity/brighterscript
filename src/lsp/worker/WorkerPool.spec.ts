import { expect } from '../../chai-config.spec';
import { WorkerPool } from './WorkerPool';
import type { Worker } from 'worker_threads';
import * as sinon from 'sinon';

describe('WorkerPool', () => {
    let pool: WorkerPool;
    let workers: Array<Worker & { postMessage: sinon.SinonStub; terminate: sinon.SinonStub; once: sinon.SinonStub }> = [];

    /**
     * Simulate a worker unexpectedly exiting by invoking the `'exit'` handler that `WorkerPool` registered on it
     * via `worker.once('exit', ...)`
     */
    function emitExit(worker: { once: sinon.SinonStub }) {
        const call = worker.once.getCalls().find(c => c.args[0] === 'exit');
        call?.args[1]?.();
    }

    beforeEach(() => {
        workers = [];
        //our factory creates fake workers so we don't have to spin up real threads for these tests
        pool = new WorkerPool(() => {
            const worker = {
                postMessage: sinon.stub(),
                terminate: sinon.stub().resolves(),
                once: sinon.stub()
            } as any;
            workers.push(worker);
            return worker;
        });
        //keep tests deterministic regardless of how many CPUs the test machine has
        pool.maxWorkers = 2;
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('preload', () => {
        it('respects maxWorkers even if a larger count is requested', () => {
            expect(workers.length).to.eql(0);

            pool.preload(5);
            //maxWorkers is 2, so preload should never exceed that cap
            expect(workers.length).to.eql(2);

            pool.preload(7);
            expect(workers.length).to.eql(2);
        });

        it('does not create extra workers if enough already exist', () => {
            pool.maxWorkers = 3;
            pool.preload(3);
            expect(workers.length).to.eql(3);

            pool.preload(2);
            expect(workers.length).to.eql(3);
        });
    });

    describe('assignProject', () => {
        it('creates a new worker when below maxWorkers', () => {
            const { worker } = pool.assignProject();
            expect(worker).to.equal(workers[0]);
            expect(workers).to.be.lengthOf(1);
        });

        it('creates additional workers up to maxWorkers', () => {
            pool.assignProject();
            pool.assignProject();
            expect(workers).to.be.lengthOf(2);
        });

        it('reuses the least-loaded worker once maxWorkers is reached', () => {
            const first = pool.assignProject();
            const second = pool.assignProject();
            //maxWorkers is 2, so a third project must be attached to one of the existing workers
            const third = pool.assignProject();
            expect(workers).to.be.lengthOf(2);
            expect([first.worker, second.worker]).to.include(third.worker);
        });

        it('sends an attachProject message with a transferable port', () => {
            const { worker, port } = pool.assignProject();
            const stub = worker.postMessage as sinon.SinonStub;
            expect(stub.calledOnce).to.be.true;
            const [message, transferList] = stub.firstCall.args;
            expect(message.type).to.eql('attachProject');
            expect(transferList).to.include(message.port);
            expect(port).to.exist;
        });

        it('reuses an idle preloaded worker instead of creating a new one', () => {
            pool.preload(2);
            expect(workers.length).to.eql(2);

            const { worker } = pool.assignProject();
            //no new worker should have been created; the idle preloaded worker should have been reused
            expect(workers.length).to.eql(2);
            expect(workers).to.include(worker);
        });

        it('does not throw when maxWorkers is 0 and there are no workers yet', () => {
            pool.maxWorkers = 0;
            const { worker } = pool.assignProject();
            expect(worker).to.exist;
            expect(workers.length).to.eql(1);
        });
    });

    describe('releaseProject', () => {
        it('terminates and removes a worker once its last project is released', () => {
            const { worker } = pool.assignProject();
            pool.releaseProject(worker);
            expect((worker.terminate as sinon.SinonStub).called).to.be.true;
            expect(pool['workers']).to.be.lengthOf(0);
        });

        it('keeps a worker alive while it still has other attached projects', () => {
            pool.maxWorkers = 1;
            const { worker: workerA } = pool.assignProject();
            const { worker: workerB } = pool.assignProject();
            expect(workerA).to.equal(workerB);

            pool.releaseProject(workerA);
            expect((workerA.terminate as sinon.SinonStub).called).to.be.false;
            expect(pool['workers']).to.be.lengthOf(1);

            pool.releaseProject(workerA);
            expect((workerA.terminate as sinon.SinonStub).called).to.be.true;
            expect(pool['workers']).to.be.lengthOf(0);
        });

        it('does not crash when releasing an unknown worker', () => {
            const unknownWorker = {} as Worker;
            pool.releaseProject(unknownWorker);
        });
    });

    describe('worker crash handling', () => {
        it('removes a crashed worker from the pool so it is not selected again', () => {
            const { worker } = pool.assignProject();
            expect(pool['workers']).to.be.lengthOf(1);

            //simulate the worker crashing/exiting unexpectedly
            emitExit(worker as any);

            expect(pool['workers']).to.be.lengthOf(0);

            //a subsequent assignment should create a brand new worker instead of reusing the dead one
            const { worker: newWorker } = pool.assignProject();
            expect(newWorker).to.not.equal(worker);
            expect(pool['workers']).to.be.lengthOf(1);
        });

        it('does not double-splice or re-terminate when releaseProject already removed the entry', () => {
            const { worker } = pool.assignProject();
            pool.releaseProject(worker);
            expect(pool['workers']).to.be.lengthOf(0);

            //the worker's real 'exit' event fires after terminate() resolves; simulate that now.
            //this should be a safe no-op since releaseProject already removed the entry.
            expect(() => emitExit(worker as any)).to.not.throw();
            expect(pool['workers']).to.be.lengthOf(0);
        });
    });

    describe('dispose', () => {
        it('terminates all workers', () => {
            pool.assignProject();
            pool.assignProject();
            pool.dispose();
            for (const worker of workers) {
                expect((worker.terminate as sinon.SinonStub).called).to.be.true;
            }
            expect(pool['workers']).to.be.lengthOf(0);
        });

        it('does not crash when worker.terminate() throws', () => {
            const { worker } = pool.assignProject();
            (worker.terminate as sinon.SinonStub).throws(new Error('Test crash'));
            //should not throw error
            pool.dispose();
        });
    });
});
