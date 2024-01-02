import { tempDir, rootDir, expectDiagnosticsAsync } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { WorkerThreadProject, workerPool } from './WorkerThreadProject';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { expect } from 'chai';

export async function wakeWorkerThread() {
    console.log('waking up a worker thread');
    const project = new WorkerThreadProject();
    try {
        await project.activate({
            projectPath: rootDir,
            projectNumber: 1
        });
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
        this.timeout(20_000);
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
                projectPath: rootDir,
                projectNumber: 1
            });
            const diagnostics = await project.getDiagnostics();
            expect(diagnostics).lengthOf(1);
            await expectDiagnosticsAsync(diagnostics, [
                DiagnosticMessages.cannotFindName('varNotThere').message
            ]);
        });
    });
});
