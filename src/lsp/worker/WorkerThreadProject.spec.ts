import { tempDir, rootDir, expectDiagnosticsAsync } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { WorkerThreadProject, workerPool } from './WorkerThreadProject';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expect } from '../../chai-config.spec';
import util from '../../util';

/**
 * Ensure at least `count` workers exist in the shared `workerPool`, and wait until any newly-created ones have
 * actually finished booting (loaded ts-node/register and registered their message listener - see `run.ts`'s
 * `{ type: 'ready' }` postMessage) before resolving. `WorkerPool.preload()` itself returns as soon as the
 * underlying `Worker` object is constructed, which is NOT the same as the worker being able to do anything yet:
 * spinning up a real OS thread + ts-node bootstrap can take anywhere from milliseconds locally to 15+ seconds on
 * slower CI hardware. Without this wait, a "preloaded" worker handed to the next test via `assignProject()`'s
 * idle-worker-reuse can still be mid-boot, and that test's own timeout can expire before the worker ever responds.
 */
export async function preloadAndWaitUntilReady(count: number) {
    const before = workerPool['workers'].length;
    workerPool.preload(count);
    const newEntries = workerPool['workers'].slice(before);
    await Promise.all(newEntries.map(entry => new Promise<void>((resolve) => {
        entry.worker.on('message', function onMessage(message: { type: string }) {
            if (message?.type === 'ready') {
                entry.worker.off('message', onMessage);
                resolve();
            }
        });
    })));
}

export async function wakeWorkerThread() {
    console.log('waking up a worker thread');
    const project = new WorkerThreadProject();
    try {
        await project.activate({
            projectPath: rootDir,
            projectNumber: 1
        } as any);
    } finally {
        project.dispose();
        //keep a spare worker warm and ready so subsequent real-worker-thread tests in this run don't each pay
        //the cost of a cold worker-thread + ts-node/register bootstrap (which can take 15+ seconds on slower CI hardware)
        await preloadAndWaitUntilReady(1);
    }
}

let wakeWorkerThreadPromise1: Promise<any>;
export function getWakeWorkerThreadPromise() {
    if (wakeWorkerThreadPromise1 === undefined) {
        wakeWorkerThreadPromise1 = wakeWorkerThread();
    }
    return wakeWorkerThreadPromise1;
}

after(() => {
    workerPool.dispose();
});

describe('WorkerThreadProject', () => {
    let project: WorkerThreadProject;
    before(async function workerThreadWarmup() {
        this.timeout(60_000);
        await getWakeWorkerThreadPromise();
    });

    beforeEach(() => {
        project?.dispose();
        project = new WorkerThreadProject();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(async function keepWorkerPoolWarm() {
        this.timeout(15_000);
        fsExtra.emptyDirSync(tempDir);
        project?.dispose();
        //keep a spare worker warm for the next test (see preloadAndWaitUntilReady() for why)
        await preloadAndWaitUntilReady(1);
    });

    describe('activate', () => {
        it('shows diagnostics after running', async function () {
            this.timeout(15_000);
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            await project.activate({
                projectKey: undefined,
                projectDir: rootDir,
                workspaceFolder: rootDir,
                bsconfigPath: undefined,
                projectNumber: 1
            });
            await project.validate();
            const diagnostics = await project.getDiagnostics();
            expect(diagnostics).lengthOf(1);
            await expectDiagnosticsAsync(diagnostics, [
                DiagnosticMessages.cannotFindName('varNotThere').message
            ]);
        });
    });

    describe('handleWorkerExit', () => {
        it('emits critical-failure when the worker exits unexpectedly', async () => {
            const failures: Array<{ message: string }> = [];
            project.on('critical-failure', (data) => failures.push(data));

            project['handleWorkerExit'](1);
            //emit() fires on next tick
            await util.sleep(0);

            expect(failures).to.be.lengthOf(1);
            expect(failures[0].message).to.include('crashed unexpectedly');
        });

        it('does not emit critical-failure once the project has been disposed', async () => {
            const failures: Array<{ message: string }> = [];
            project.on('critical-failure', (data) => failures.push(data));

            project['isDisposed'] = true;
            project['handleWorkerExit'](1);
            await util.sleep(0);

            expect(failures).to.be.lengthOf(0);
        });
    });

    describe('worker sharing', () => {
        let originalMaxWorkers: number;

        beforeEach(() => {
            originalMaxWorkers = workerPool.maxWorkers;
        });

        afterEach(() => {
            workerPool.maxWorkers = originalMaxWorkers;
        });

        it('allows multiple projects to share a single worker thread when capped', async function () {
            this.timeout(15_000);
            workerPool.maxWorkers = 1;

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print "project A"
                end sub
            `);
            const rootDirB = `${tempDir}/projectB`;
            fsExtra.outputFileSync(`${rootDirB}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            const projectB = new WorkerThreadProject();
            try {
                await project.activate({
                    projectKey: undefined,
                    projectDir: rootDir,
                    workspaceFolder: rootDir,
                    bsconfigPath: undefined,
                    projectNumber: 1
                });
                await projectB.activate({
                    projectKey: undefined,
                    projectDir: rootDirB,
                    workspaceFolder: rootDirB,
                    bsconfigPath: undefined,
                    projectNumber: 2
                });

                //both projects should be sharing the same (single) worker thread
                expect(workerPool['workers']).to.be.lengthOf(1);

                await project.validate();
                await projectB.validate();

                expect(await project.getDiagnostics()).to.be.lengthOf(0);
                const diagnosticsB = await projectB.getDiagnostics();
                expect(diagnosticsB).to.be.lengthOf(1);
                await expectDiagnosticsAsync(diagnosticsB, [
                    DiagnosticMessages.cannotFindName('varNotThere').message
                ]);
            } finally {
                projectB.dispose();
            }
        });

        it('leaves the surviving co-tenant project functional after the other one is disposed', async function () {
            this.timeout(15_000);
            workerPool.maxWorkers = 1;

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print "project A"
                end sub
            `);
            const rootDirB = `${tempDir}/projectB`;
            fsExtra.outputFileSync(`${rootDirB}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            const projectB = new WorkerThreadProject();
            try {
                await project.activate({
                    projectKey: undefined,
                    projectDir: rootDir,
                    workspaceFolder: rootDir,
                    bsconfigPath: undefined,
                    projectNumber: 1
                });
                await projectB.activate({
                    projectKey: undefined,
                    projectDir: rootDirB,
                    workspaceFolder: rootDirB,
                    bsconfigPath: undefined,
                    projectNumber: 2
                });

                //both projects should be sharing the same (single) worker thread
                expect(workerPool['workers']).to.be.lengthOf(1);

                //dispose project A only. project B (and the shared worker) should keep working.
                project.dispose();

                await projectB.validate();
                const diagnosticsB = await projectB.getDiagnostics();
                expect(diagnosticsB).to.be.lengthOf(1);
                await expectDiagnosticsAsync(diagnosticsB, [
                    DiagnosticMessages.cannotFindName('varNotThere').message
                ]);
            } finally {
                projectB.dispose();
            }
        });

        it('leaves the surviving co-tenant project functional even if the other one is disposed twice', async function () {
            this.timeout(15_000);
            workerPool.maxWorkers = 1;

            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print "project A"
                end sub
            `);
            const rootDirB = `${tempDir}/projectB`;
            fsExtra.outputFileSync(`${rootDirB}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            const projectB = new WorkerThreadProject();
            try {
                await project.activate({
                    projectKey: undefined,
                    projectDir: rootDir,
                    workspaceFolder: rootDir,
                    bsconfigPath: undefined,
                    projectNumber: 1
                });
                await projectB.activate({
                    projectKey: undefined,
                    projectDir: rootDirB,
                    workspaceFolder: rootDirB,
                    bsconfigPath: undefined,
                    projectNumber: 2
                });

                //both projects should be sharing the same (single) worker thread
                expect(workerPool['workers']).to.be.lengthOf(1);

                //simulate the double-dispose pattern used by this file's beforeEach/afterEach hooks
                project.dispose();
                project.dispose();

                //project B (and the shared worker) should still be alive and functional
                await projectB.validate();
                const diagnosticsB = await projectB.getDiagnostics();
                expect(diagnosticsB).to.be.lengthOf(1);
                await expectDiagnosticsAsync(diagnosticsB, [
                    DiagnosticMessages.cannotFindName('varNotThere').message
                ]);
            } finally {
                projectB.dispose();
            }
        });
    });
});
