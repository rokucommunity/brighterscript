import { expect } from 'chai';
import { ProjectManager } from './ProjectManager';
import { tempDir, rootDir, expectDiagnostics } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../util';
import { Deferred } from '../deferred';
import { createSandbox } from 'sinon';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { ProgramBuilder } from '..';
const sinon = createSandbox();

describe.only('ProjectManager', () => {
    let manager: ProjectManager;

    beforeEach(() => {
        manager = new ProjectManager();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
    });

    describe('addFileResolver', () => {
        it('runs added resolvers', async () => {
            const mock = sinon.mock();
            manager.addFileResolver(mock);
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, '');

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(mock.called).to.be.true;
        });
    });

    describe('events', () => {
        it('emits flush-diagnostics after validate finishes', async () => {
            const deferred = new Deferred<boolean>();
            const disable = manager.on('flush-diagnostics', () => {
                deferred.resolve(true);
            });
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                await deferred.promise
            ).to.eql(true);

            //disable future events
            disable();
        });
    });

    describe('syncProjects', () => {
        it('does not crash on zero projects', async () => {
            await manager.syncProjects([]);
        });

        it('finds bsconfig in a folder', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(manager.projects[0].projectPath).to.eql(s`${rootDir}`);
        });

        it('finds bsconfig at root and also in subfolder', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            fsExtra.outputFileSync(`${rootDir}/subdir/bsconfig.json`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${rootDir}`,
                s`${rootDir}/subdir`
            ]);
        });

        it('skips excluded bsconfig bsconfig in a folder', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            fsExtra.outputFileSync(`${rootDir}/subdir/bsconfig.json`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir,
                excludePatterns: ['subdir/**/*']
            }]);
            expect(
                manager.projects.map(x => x.projectPath)
            ).to.eql([
                s`${rootDir}`
            ]);
        });

        it('uses rootDir when manifest found but no brightscript file', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir/manifest`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath)
            ).to.eql([
                s`${rootDir}`
            ]);
        });

        it('uses subdir when manifest and brightscript file found', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir/manifest`, '');
            fsExtra.outputFileSync(`${rootDir}/subdir/source/main.brs`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath)
            ).to.eql([
                s`${rootDir}/subdir`
            ]);
        });

        it('removes stale projects', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir1/bsconfig.json`, '');
            fsExtra.outputFileSync(`${rootDir}/subdir2/bsconfig.json`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${rootDir}/subdir1`,
                s`${rootDir}/subdir2`
            ]);
            fsExtra.removeSync(`${rootDir}/subdir1/bsconfig.json`);

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${rootDir}/subdir2`
            ]);
        });

        it('keeps existing projects on subsequent sync calls', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir1/bsconfig.json`, '');
            fsExtra.outputFileSync(`${rootDir}/subdir2/bsconfig.json`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${rootDir}/subdir1`,
                s`${rootDir}/subdir2`
            ]);

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager.projects.map(x => x.projectPath).sort()
            ).to.eql([
                s`${rootDir}/subdir1`,
                s`${rootDir}/subdir2`
            ]);
        });
    });

    describe('createProject', () => {
        it('skips creating project if we already have it', async () => {
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            await manager['createProject']({
                projectPath: rootDir
            } as any);
            expect(manager.projects).to.be.length(1);
        });

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
            expectDiagnostics(project.builder, [
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
                bsconfigPath: s`${rootDir}/bsconfig.json`,
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
            await manager['getBsconfigPath'](undefined)
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
