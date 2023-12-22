import { expect } from 'chai';
import { tempDir, rootDir, expectDiagnosticsAsync } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../util';
import { Deferred } from '../deferred';
import { createSandbox } from 'sinon';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { ProgramBuilder } from '..';
import { Project } from './Project';
const sinon = createSandbox();

describe('ProjectManager', () => {
    let project: Project;

    beforeEach(() => {
        project = new Project();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        project.dispose();
    });

    describe('activate', () => {
        it('finds bsconfig.json at root', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            await project.activate({
                projectPath: rootDir
            });
            expect(project.configFilePath).to.eql(s`${rootDir}/bsconfig.json`);
        });

        it('shows diagnostics after running', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            await project.activate({
                projectPath: rootDir
            });

            await expectDiagnosticsAsync(project, [
                DiagnosticMessages.cannotFindName('varNotThere').message
            ]);
        });
    });

    describe('createProject', () => {
        it('uses given projectNumber', async () => {
            await manager['createProject']({
                projectPath: rootDir,
                workspaceFolder: rootDir,
                projectNumber: 3
            });
            expect(manager.projects[0].projectNumber).to.eql(3);
        });

        it('warns about deprecated brsconfig.json', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir1/brsconfig.json`, '');
            const project = await manager['createProject']({
                projectPath: rootDir,
                workspaceFolder: rootDir,
                bsconfigPath: 'subdir1/brsconfig.json'
            });
            await expectDiagnosticsAsync(project, [
                DiagnosticMessages.brsConfigJsonIsDeprecated()
            ]);
        });

        it('properly tracks a failed run', async () => {
            //force a total crash
            sinon.stub(ProgramBuilder.prototype, 'run').returns(
                Promise.reject(new Error('Critical failure'))
            );
            const project = await manager['createProject']({
                projectPath: rootDir,
                workspaceFolder: rootDir,
                bsconfigPath: 'subdir1/brsconfig.json'
            });
            expect(project.isFirstRunComplete).to.be.true;
            expect(project.isFirstRunSuccessful).to.be.false;
        });
    });

    describe('getBsconfigPath', () => {
        it('emits critical failure for missing file', async () => {
            const deferred = new Deferred<string>();
            manager.on('critical-failure', (event) => {
                deferred.resolve(event.message);
            });
            await manager['getBsconfigPath']({
                projectPath: rootDir,
                workspaceFolder: rootDir,
                bsconfigPath: s`${rootDir}/bsconfig.json`
            });
            expect(
                (await deferred.promise).startsWith('Cannot find config file')
            ).to.be.true;
        });

        it('finds brsconfig.json', async () => {
            fsExtra.outputFileSync(`${rootDir}/brsconfig.json`, '');
            expect(
                await manager['getBsconfigPath']({
                    projectPath: rootDir,
                    workspaceFolder: rootDir
                })
            ).to.eql(s`${rootDir}/brsconfig.json`);
        });


        it('does not crash on undefined', async () => {
            await manager['getBsconfigPath'](undefined);
        });
    });

    describe('removeProject', () => {
        it('handles undefined', async () => {
            manager['removeProject'](undefined);
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            manager['removeProject'](undefined);
        });

        it('does not crash when removing project that is not there', () => {
            manager['removeProject']({
                projectPath: rootDir,
                dispose: () => { }
            } as any);
        });
    });
});
