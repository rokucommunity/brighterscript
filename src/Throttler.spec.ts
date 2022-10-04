/* eslint-disable @typescript-eslint/no-floating-promises */
import { expect } from './chai-config.spec';
import { Throttler } from './Throttler';
import { createSandbox, fake } from 'sinon';
import { Deferred } from './deferred';

let sinon = createSandbox();

describe('Throttler', () => {
    let throttler: Throttler;
    beforeEach(() => {
        throttler = new Throttler(0);
    });
    afterEach(() => {
        sinon.restore();
    });

    describe('run', () => {
        it('runs a job', async () => {
            const job = fake();
            await throttler.run(job);
            expect(job.callCount).to.equal(1);
        });

        it('runs a second job after the first one finishes', async () => {
            const job1 = fake();
            const job2 = fake();
            throttler.run(job1);
            throttler.run(job2);
            await throttler.onIdleOnce();
            expect(job1.callCount).to.equal(1);
            expect(job2.callCount).to.equal(1);
        });

        it('skips the middle job when a third job is registered', async () => {
            const job1 = fake();
            const job2 = fake();
            const job3 = fake();
            throttler.run(job1);
            throttler.run(job2);
            throttler.run(job3);
            await throttler.onIdleOnce();
            expect(job1.callCount).to.equal(1);
            expect(job2.callCount).to.equal(0);
            expect(job3.callCount).to.equal(1);
        });

        it('runs another job after settled', async () => {
            const job1 = fake();
            throttler.run(job1);
            await throttler.onIdleOnce();
            const job2 = fake();
            throttler.run(job2);
            await throttler.onIdleOnce();

            expect(job1.called).to.be.true;
            expect(job2.called).to.be.true;
        });

        it('logs error to console but continues', async () => {
            const stub = sinon.stub(console, 'error').callsFake(() => { });
            await throttler.run(() => {
                throw new Error('fail!');
            });
            expect(stub.callCount).to.equal(1);
            expect(stub.getCalls()[0]?.args[0]?.message).to.eql('fail!');
        });
    });

    describe('onIdle', () => {
        it('fires every time the throttler idles', async () => {
            const onIdle = fake();
            throttler.onIdle(onIdle);
            await throttler.run(() => { });
            await throttler.run(() => { });
            await throttler.run(() => { });
            expect(onIdle.callCount).to.equal(3);
        });

        it('disconnects when called', async () => {
            const onIdle1 = fake();
            const off1 = throttler.onIdle(onIdle1);

            const onIdle2 = fake();
            throttler.onIdle(onIdle2);

            await throttler.run(() => { });

            //turn off onIdle1 listener
            off1();

            await throttler.run(() => { });

            expect(onIdle1.callCount).to.equal(1);
            expect(onIdle2.callCount).to.equal(2);
        });
    });

    describe('onIdleOnce', () => {
        it('resolves immediately if idle', async () => {
            await throttler.onIdleOnce(true);
            //we resolved instead of waiting...this is a pass
        });

        it('waits until the next resolve when resolveImmediately is false', async () => {
            const deferred = new Deferred();
            const promise = throttler.onIdleOnce(false);
            throttler.run(() => {
                return deferred.promise;
            });
            deferred.resolve();
            await promise;
            //we resolved, this test passes
        });
    });
});
