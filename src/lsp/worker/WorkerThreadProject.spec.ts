import { expect } from 'chai';
import { tempDir, rootDir, expectDiagnosticsAsync } from '../../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
import { standardizePath as s } from '../../util';
import { WorkerThreadProject } from './WorkerThreadProject';
import { DiagnosticMessages } from '../../DiagnosticMessages';

const sinon = createSandbox();

describe.only('WorkerThreadProject', () => {
    let project: WorkerThreadProject;

    beforeEach(() => {
        project?.dispose();
        project = new WorkerThreadProject();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        project?.dispose();
    });

    describe.only('activate', () => {
        it('finds bsconfig.json at root', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            await project.activate({
                projectPath: rootDir
            });
            expect(project.configFilePath).to.eql(s`${rootDir}/bsconfig.json`);
        });

        it.only('shows diagnostics after running', async () => {
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
