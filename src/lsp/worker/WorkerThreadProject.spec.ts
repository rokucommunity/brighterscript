import { tempDir, rootDir, expectDiagnosticsAsync } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { WorkerThreadProject, workerPool } from './WorkerThreadProject';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expect } from 'chai';
import util from '../../util';

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

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        project?.dispose();
    });

    describe('activate', () => {
        it('shows diagnostics after running', async () => {
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

        it('allows multiple projects to share a single worker thread when capped', async () => {
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
    });
});
