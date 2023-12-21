import { expect } from 'chai';
import { ProjectManager } from './ProjectManager';
import { tempDir, rootDir } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../util';

describe.only('ProjectManager', () => {
    let manager: ProjectManager;

    beforeEach(() => {
        manager = new ProjectManager();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
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
                manager.projects.map(x => x.projectPath)
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
    });
});
