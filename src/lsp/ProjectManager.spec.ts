import { expect } from 'chai';
import { ProjectManager } from './ProjectManager';
import { tempDir, rootDir, expectZeroDiagnostics, expectDiagnostics } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import util, { standardizePath as s } from '../util';
import { createSandbox } from 'sinon';
import { Project } from './Project';
import { WorkerThreadProject } from './worker/WorkerThreadProject';
import { getWakeWorkerThreadPromise } from './worker/WorkerThreadProject.spec';
import type { LspDiagnostic } from './LspProject';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { FileChangeType } from 'vscode-languageserver-protocol';
const sinon = createSandbox();

describe('ProjectManager', () => {
    let manager: ProjectManager;

    beforeEach(() => {
        manager = new ProjectManager();
        fsExtra.emptyDirSync(tempDir);
        sinon.restore();
        diagnosticsListeners = [];
        diagnostics = [];
        manager.on('diagnostics', (event) => {
            diagnostics.push(event.diagnostics);
            diagnosticsListeners.pop()?.(event.diagnostics);
        });
    });

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        sinon.restore();
        manager.dispose();
    });

    /**
     * Get a promise that resolves when the next diagnostics event is emitted
     */
    function onNextDiagnostics() {
        return new Promise<LspDiagnostic[]>((resolve) => {
            diagnosticsListeners.push(resolve);
        });
    }
    let diagnosticsListeners: Array<(diagnostics: LspDiagnostic[]) => void> = [];
    let diagnostics: Array<LspDiagnostic[]> = [];


    describe('on', () => {
        it('emits events', async () => {
            const stub = sinon.stub();
            const off = manager.on('diagnostics', stub);
            await manager['emit']('diagnostics', { project: undefined, diagnostics: [] });
            expect(stub.callCount).to.eql(1);

            await manager['emit']('diagnostics', { project: undefined, diagnostics: [] });
            expect(stub.callCount).to.eql(2);

            off();

            await manager['emit']('diagnostics', { project: undefined, diagnostics: [] });
            expect(stub.callCount).to.eql(2);
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

    describe('handleFileChanges', () => {
        it('properly syncs changes', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/lib1.brs`, `sub test1():print "alpha":end sub`);
            fsExtra.outputFileSync(`${rootDir}/source/lib2.brs`, `sub test2():print "beta":end sub`);
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expectZeroDiagnostics(await onNextDiagnostics());

            await manager.handleFileChanges([
                { srcPath: `${rootDir}/source/lib1.brs`, fileContents: `sub test1():print alpha:end sub`, type: FileChangeType.Changed },
                { srcPath: `${rootDir}/source/lib2.brs`, fileContents: `sub test2()::print beta:end sub`, type: FileChangeType.Changed }
            ]);

            expectDiagnostics(await onNextDiagnostics(), [
                DiagnosticMessages.cannotFindName('alpha').message,
                DiagnosticMessages.cannotFindName('beta').message
            ]);

            await manager.handleFileChanges([
                { srcPath: `${rootDir}/source/lib1.brs`, fileContents: `sub test1():print "alpha":end sub`, type: FileChangeType.Changed },
                { srcPath: `${rootDir}/source/lib2.brs`, fileContents: `sub test2()::print "beta":end sub`, type: FileChangeType.Changed }
            ]);

            expectZeroDiagnostics(await onNextDiagnostics());
        });

        it('adds all new files in a folder', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `sub main():print "main":end sub`);

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expectZeroDiagnostics(await onNextDiagnostics());

            //add a few files to a folder, then register that folder as an "add"
            fsExtra.outputFileSync(`${rootDir}/source/libs/alpha/beta.brs`, `sub beta(): print one: end sub`);
            fsExtra.outputFileSync(`${rootDir}/source/libs/alpha/charlie/delta.brs`, `sub delta():print two:end sub`);
            fsExtra.outputFileSync(`${rootDir}/source/libs/echo/foxtrot.brs`, `sub foxtrot():print three:end sub`);

            await manager.handleFileChanges([
                //register the entire folder as an "add"
                { srcPath: `${rootDir}/source/libs`, type: FileChangeType.Created }
            ]);

            expectDiagnostics(await onNextDiagnostics(), [
                DiagnosticMessages.cannotFindName('one').message,
                DiagnosticMessages.cannotFindName('two').message,
                DiagnosticMessages.cannotFindName('three').message
            ]);
        });
    });

    describe('threading', () => {
        before(async function workerThreadWarmup() {
            this.timeout(20_000);
            await getWakeWorkerThreadPromise();
        });

        it('spawns a worker thread when threading is enabled', async () => {
            await manager.syncProjects([{
                workspaceFolder: rootDir,
                threadingEnabled: true
            }]);
            expect(manager.projects[0]).instanceof(WorkerThreadProject);
        });
    });

    describe('getProject', () => {
        it('uses .projectPath if param is not a string', async () => {
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expect(
                manager['getProject']({
                    projectPath: rootDir
                })
            ).to.include({
                projectPath: rootDir
            });
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

        it('properly tracks a failed run', async () => {
            //force a total crash
            sinon.stub(Project.prototype, 'activate').returns(
                Promise.reject(new Error('Critical failure'))
            );
            let error;
            try {
                await manager['createProject']({
                    projectPath: rootDir,
                    workspaceFolder: rootDir,
                    bsconfigPath: 'subdir1/brsconfig.json'
                });
            } catch (e) {
                error = e;
            }
            expect(error).to.include({ message: 'Critical failure' });
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

    describe('getSemanticTokens', () => {
        it('waits until the project is ready', () => {

        });
    });

    describe('raceUntil', () => {
        beforeEach(() => {
        });

        async function doTest(expectedIndex: number, ...values: any[]) {
            manager.projects = [{ index: 0 }, { index: 1 }, { index: 2 }] as any;

            let idx = 0;
            expect(
                await manager['findFirstMatchingProject']((project) => {
                    return values[idx++];
                })
            ).to.equal(manager.projects[expectedIndex]);
        }

        async function sleepResolve(timeout: number, value: boolean) {
            await util.sleep(timeout);
            return value;
        }


        async function sleepReject(timeout: number, reason: string) {
            await util.sleep(timeout);
            throw new Error(reason);
        }

        it('resolves sync values', async () => {
            //return the first true value encountered. These are sync, so should resolve immediately
            await doTest(0, true, false, false);
            await doTest(1, false, true, false);
            await doTest(2, false, false, true);
        });

        it('resolves async values', async () => {
            //return the first true value encountered
            await doTest(0, Promise.resolve(true), Promise.resolve(false), Promise.resolve(false));
            await doTest(1, Promise.resolve(false), Promise.resolve(true), Promise.resolve(false));
            await doTest(2, Promise.resolve(false), Promise.resolve(false), Promise.resolve(true));
        });

        it('resolves async values in proper timing order', async () => {
            //return the first true value encountered
            await doTest(0, sleepResolve(0, true), sleepResolve(10, false), sleepResolve(20, false));
            await doTest(1, sleepResolve(0, false), sleepResolve(10, true), sleepResolve(20, false));
            await doTest(2, sleepResolve(0, false), sleepResolve(10, false), sleepResolve(20, true));
        });

        it('resolves async values in proper timing order when all are true', async () => {
            //return the first true value encountered
            await doTest(0, sleepResolve(0, true), sleepResolve(10, true), sleepResolve(20, true));
            await doTest(1, sleepResolve(20, true), sleepResolve(0, true), sleepResolve(10, true));
            await doTest(2, sleepResolve(10, true), sleepResolve(20, true), sleepResolve(0, true));
        });

        it('fails gracefully when an error occurs', async () => {
            //return the first true value encountered
            await doTest(0, sleepResolve(10, true), sleepReject(0, 'crash'), sleepResolve(20, true));
            await doTest(1, sleepResolve(20, true), sleepResolve(10, true), sleepReject(0, 'crash'));
            await doTest(2, sleepReject(0, 'crash'), sleepResolve(20, true), sleepResolve(10, true));
        });

        it('returns undefined when all promises return false', async () => {
            await doTest(undefined, false, false, false);
            await doTest(undefined, sleepResolve(0, false), sleepResolve(10, false), sleepResolve(20, false));
            await doTest(undefined, sleepReject(0, 'crash'), sleepReject(10, 'crash'), sleepReject(20, 'crash'));
        });
    });
});
