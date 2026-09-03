import { tempDir, rootDir, expectDiagnosticsAsync } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { WorkerThreadProject, workerPool } from './WorkerThreadProject';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expect } from '../../chai-config.spec';
import util from '../../util';
import * as sinon from 'sinon';

/**
 * Ensure at least `count` workers exist in `workerPool`, waiting for any newly-created ones to signal readiness
 * (see `run.ts`'s `{ type: 'ready' }` message) - `WorkerPool.preload()` alone returns before the worker can do anything.
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
        //keep a spare worker warm so subsequent real-worker-thread tests skip the cold-boot cost
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

    //holds a permanent tenant slot on the shared worker so it never hits zero tenants (and gets terminated) between tests
    let keepAliveProject: WorkerThreadProject;

    before(async function workerThreadWarmup() {
        this.timeout(60_000);
        await getWakeWorkerThreadPromise();

        workerPool.maxWorkers = 1;
        keepAliveProject = new WorkerThreadProject();
        await keepAliveProject.activate({
            projectPath: rootDir,
            projectNumber: 0
        } as any);
    });

    after(() => {
        //dispose explicitly to avoid a spurious "worker crashed" log when workerPool.dispose() tears it down instead
        keepAliveProject?.dispose();
    });

    beforeEach(() => {
        project?.dispose();
        project = new WorkerThreadProject();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(async function keepWorkerPoolWarm() {
        //defensive fallback in case keepAliveProject didn't prevent the pool from emptying; give it a cold-boot-sized budget
        this.timeout(60_000);
        fsExtra.emptyDirSync(tempDir);
        project?.dispose();
        sinon.restore();
        await preloadAndWaitUntilReady(1);
    });

    describe('activate', () => {
        it('shows diagnostics after running', async function () {
            this.timeout(60_000);
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

        it('marks the project disposed so it is not treated as still alive', async () => {
            expect(project['isDisposed']).to.be.false;

            project['handleWorkerExit'](1);
            await util.sleep(0);

            //the worker is gone, so the project can never serve another request
            expect(project['isDisposed']).to.be.true;
        });

        /**
         * Give `project` a real slot on a pooled worker without paying for a full `activate()`. This is the
         * bit of `activate()` that the crash/dispose release path actually depends on.
         */
        function attachToPooledWorker() {
            const assignment = workerPool.assignProject();
            project['worker'] = assignment.worker;
            project['port'] = assignment.port;
        }

        it('releases its slot on the crashed worker so co-tenant accounting stays correct', async () => {
            attachToPooledWorker();
            //spy (rather than stub) so the slot is still genuinely released and doesn't leak onto the shared worker
            const releaseProject = sinon.spy(workerPool, 'releaseProject');
            const worker = project['worker'];

            project['handleWorkerExit'](1);
            await util.sleep(0);

            expect(releaseProject.callCount).to.eql(1);
            expect(releaseProject.firstCall.args[0]).to.equal(worker);
        });

        it('does not double-release when dispose() runs after a crash', async () => {
            attachToPooledWorker();
            const releaseProject = sinon.spy(workerPool, 'releaseProject');

            project['handleWorkerExit'](1);
            await util.sleep(0);
            project.dispose();

            //dispose() must short-circuit on the isDisposed flag the crash handler set
            expect(releaseProject.callCount).to.eql(1);
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
            this.timeout(60_000);
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
            this.timeout(60_000);
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
            this.timeout(60_000);
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
