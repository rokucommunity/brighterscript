/* eslint-disable @typescript-eslint/no-floating-promises */
import { expect } from 'chai';
import { Throttler } from './TaskThrottler';
import { createSandbox, fake } from 'sinon';

let sinon = createSandbox();

describe('Throttler', () => {
    let throttler: Throttler;
    beforeEach(() => {
        throttler = new Throttler(0);
    });
    afterEach(() => {
        sinon.restore();
    });
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
});
