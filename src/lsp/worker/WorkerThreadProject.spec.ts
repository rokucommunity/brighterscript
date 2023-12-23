import { tempDir, rootDir, expectDiagnosticsAsync } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { WorkerThreadProject, workerPool } from './WorkerThreadProject';
import { DiagnosticMessages } from '../../DiagnosticMessages';

describe.only('WorkerThreadProject', () => {
    let project: WorkerThreadProject;
    before(() => {
        workerPool.preload(1);
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

    after(() => {
        //shut down all the worker threads after we're finished with all the tests
        workerPool.dispose();
    });

    it('wake up the worker thread', async function test() {
        this.timeout(20_000);
        await project.activate({
            projectPath: rootDir,
            projectNumber: 1
        });
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

            await expectDiagnosticsAsync(project, [
                DiagnosticMessages.cannotFindName('varNotThere').message
            ]);
        });
    });
});
