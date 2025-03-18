import { expect } from 'chai';
import { ProjectManager } from './ProjectManager';
import { tempDir, rootDir, expectZeroDiagnostics, expectDiagnostics, expectCompletionsIncludes } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import util, { standardizePath as s } from '../util';
import type { SinonStub } from 'sinon';
import { createSandbox } from 'sinon';
import { Project } from './Project';
import { WorkerThreadProject } from './worker/WorkerThreadProject';
import { getWakeWorkerThreadPromise } from './worker/WorkerThreadProject.spec';
import type { LspDiagnostic } from './LspProject';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { FileChangeType } from 'vscode-languageserver-protocol';
import { PathFilterer } from './PathFilterer';
import { Deferred } from '../deferred';
import type { DocumentActionWithStatus } from './DocumentManager';
import * as net from 'net';
import type { Program } from '../Program';
import * as getPort from 'get-port';


const sinon = createSandbox();

describe('ProjectManager', () => {
    let manager: ProjectManager;
    let pathFilterer: PathFilterer;

    beforeEach(() => {
        pathFilterer = new PathFilterer();
        manager = new ProjectManager({
            pathFilterer: pathFilterer
        });
        fsExtra.emptyDirSync(tempDir);
        sinon.restore();
        diagnosticsListeners = [];
        diagnosticsResponses = [];
        manager.on('diagnostics', (event) => {
            if (diagnosticsListeners.length > 0) {
                diagnosticsListeners.shift()?.(event.diagnostics);
            } else {
                diagnosticsResponses.push(event.diagnostics);
            }
        });
    });

    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        sinon.restore();
        manager.dispose();
    });
    let diagnosticsListeners: Array<(diagnostics: LspDiagnostic[]) => void> = [];
    let diagnosticsResponses: Array<LspDiagnostic[]> = [];

    /**
     * Get a promise that resolves when the next diagnostics event is emitted (or pop the earliest unhandled diagnostics list if some are already here)
     */
    function onNextDiagnostics() {
        if (diagnosticsResponses.length > 0) {
            return Promise.resolve(diagnosticsResponses.shift());
        } else {
            return new Promise<LspDiagnostic[]>((resolve) => {
                diagnosticsListeners.push(resolve);
            });
        }
    }

    async function setFile(srcPath: string, contents: string) {
        //set the namespace first
        await manager.handleFileChanges([{
            srcPath: srcPath,
            type: FileChangeType.Changed,
            fileContents: contents,
            allowStandaloneProject: false
        }]);
    }

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

    describe('validation tracking', () => {
        it('tracks validation state', async () => {
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            const project = manager.projects[0] as unknown as Project;

            //force validation to take a while
            sinon.stub(project['builder'].program, 'validate').callsFake(async () => {
                await util.sleep(100);
            });

            expect(manager.busyStatusTracker.status).to.eql('idle');

            //run several validations (which cancel the previous)
            void project.validate();
            await util.sleep(10);

            void project.validate();
            await util.sleep(10);

            void project.validate();
            await util.sleep(10);

            //busy status should be active
            expect(manager.busyStatusTracker.status).to.eql('busy');
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

        it('gets diagnostics from plugins added in afterProgramValidate', async () => {
            fsExtra.outputFileSync(`${rootDir}/plugin.js`, `
                module.exports = function () {
                    return {
                        afterProgramValidate: function(program) {
                            var file = program.getFile('source/main.brs');
                            //add a diagnostic from a plugin
                            file.addDiagnostic({
                                message: 'Test diagnostic',
                                code: 'test-123',
                                severity: 1
                            });
                        }
                    }
                }
            `);

            fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
                plugins: [
                    './plugin.js'
                ]
            });
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub test()
                    print nameNotDefined
                end sub
            `);
            fsExtra.outputFileSync(`${rootDir}/manifest`, '');
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            expectDiagnostics(await onNextDiagnostics(), [
                DiagnosticMessages.cannotFindName('nameNotDefined').message,
                'Test diagnostic'
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

    describe('getCompletions', () => {
        it('works for quick file changes', async () => {
            //set up the project
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            //add the namespace first
            await setFile(s`${rootDir}/source/alpha.bs`, `
                namespace alpha
                    enum Direction
                        up
                    end enum
                end namespace
            `);
            //add the baseline file
            await setFile(s`${rootDir}/source/main.bs`, `
                sub test()
                    thing = alpha.Directio
                end sub
            `);
            await manager.onIdle();

            //now for the test. type a char, request completions, type a char, request completions (just like how vscode does it)
            void setFile(s`${rootDir}/source/main.bs`, `
                sub test()
                    thing = alpha.Direction
                end sub
            `);
            // const completionsPromise1 = manager.getCompletions({
            //     srcPath: s`${rootDir}/source/main.bs`,
            //     position: util.createPosition(2, 43)
            // });
            //request completions
            void setFile(s`${rootDir}/source/main.bs`, `
                sub test()
                    thing = alpha.Direction.
                end sub
            `);
            const completionsPromise2 = manager.getCompletions({
                srcPath: s`${rootDir}/source/main.bs`,
                position: util.createPosition(2, 44)
            });

            // //the first set of completions should only have the `alpha.Direction` enum
            // expectCompletionsIncludes(await completionsPromise1, [{
            //     label: 'Direction'
            // }]);

            //the next set of completions should only have the alpha.Direction.up enum member
            expectCompletionsIncludes(await completionsPromise2, [{
                label: 'up'
            }]);
        });
    });

    describe('flushDocumentChanges', () => {
        it('does not crash when getting undefined back from projects', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, ``);
            fsExtra.outputJsonSync(`${rootDir}/project1/bsconfig.json`, {
                rootDir: rootDir
            });
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            sinon.stub(manager.projects[0], 'applyFileChanges').returns(Promise.resolve([
                //return an undefined item, which used to cause a specific crash
                undefined
            ]));

            await manager['flushDocumentChanges']({
                actions: [{
                    srcPath: s`${rootDir}/source/main.brs`,
                    type: 'set',
                    fileContents: 'sub main():end sub',
                    allowStandaloneProject: true
                }]
            });
        });
    });

    describe('handleFileChanges', () => {
        it('only sends files to the project that match the include patterns for that project', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/lib1/a.brs`, ``);
            fsExtra.outputFileSync(`${rootDir}/source/lib2/a.brs`, ``);

            fsExtra.outputFileSync(`${rootDir}/source/lib1/b.brs`, ``);
            fsExtra.outputFileSync(`${rootDir}/source/lib2/b.brs`, ``);

            fsExtra.outputJsonSync(`${rootDir}/project1/bsconfig.json`, {
                rootDir: rootDir,
                files: [
                    'source/**/a.brs'
                ]
            });
            fsExtra.outputJsonSync(`${rootDir}/project2/bsconfig.json`, {
                rootDir: rootDir,
                files: [
                    'source/**/b.brs'
                ]
            });

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            let deferred1 = new Deferred();
            let deferred2 = new Deferred();
            const project1 = manager.projects.find(x => x.bsconfigPath.includes('project1')) as unknown as Project;
            const project2 = manager.projects.find(x => x.bsconfigPath.includes('project2')) as unknown as Project;

            const project1Stub: SinonStub = sinon.stub(project1, 'applyFileChanges').callsFake(async (...args) => {
                const result = await project1Stub.wrappedMethod.apply(project1, args);
                deferred1.resolve();
                return result;
            });
            const project2Stub: SinonStub = sinon.stub(project2, 'applyFileChanges').callsFake(async (...args) => {
                const result = await project2Stub.wrappedMethod.apply(project1, args);
                deferred2.resolve();
                return result;
            });

            await manager.handleFileChanges([
                { srcPath: `${rootDir}/source/lib1/a.brs`, type: FileChangeType.Changed },
                { srcPath: `${rootDir}/source/lib2/a.brs`, type: FileChangeType.Changed },
                { srcPath: `${rootDir}/source/lib1/b.brs`, type: FileChangeType.Changed },
                { srcPath: `${rootDir}/source/lib2/b.brs`, type: FileChangeType.Changed }
            ]);

            //wait for the functions to finish being called
            await Promise.all([
                deferred1.promise,
                deferred2.promise
            ]);

            //project1 should only receive a.brs files
            expect(project1Stub.getCall(0).args[0].map(x => x.srcPath)).to.eql([
                s`${rootDir}/source/lib1/a.brs`,
                s`${rootDir}/source/lib2/a.brs`
            ]);

            //project2 should only receive b.brs files
            expect(project2Stub.getCall(0).args[0].map(x => x.srcPath)).to.eql([
                s`${rootDir}/source/lib1/b.brs`,
                s`${rootDir}/source/lib2/b.brs`
            ]);
        });

        it('excludes files based on global exclude patterns', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/file1.md`, ``);
            fsExtra.outputFileSync(`${rootDir}/source/file2.brs`, ``);

            fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
                files: [
                    'source/**/*.brs'
                ]
            });

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            const stub = sinon.stub(manager as any, 'handleFileChange').callThrough();

            //register an exclusion filter
            pathFilterer.registerExcludeList(rootDir, [
                '**/*.md'
            ]);
            //make sure the .md file is ignored
            await manager.handleFileChanges([
                { srcPath: s`${rootDir}/source/file1.md`, type: FileChangeType.Created },
                { srcPath: s`${rootDir}/source/file2.brs`, type: FileChangeType.Created }
            ]);
            await manager.onIdle();
            expect(
                stub.getCalls().map(x => x.args[0]).map(x => x.srcPath)
            ).to.eql([
                s`${rootDir}/source/file2.brs`
            ]);
            stub.reset();

            //remove all filters, make sure the markdown file is included
            pathFilterer.clear();
            await manager.handleFileChanges([
                { srcPath: s`${rootDir}/source/file1.md`, type: FileChangeType.Created },
                { srcPath: s`${rootDir}/source/file2.brs`, type: FileChangeType.Created }
            ]);

            await manager.onIdle();
            expect(
                stub.getCalls().flatMap(x => x.args[0]).map(x => x.srcPath)
            ).to.eql([
                s`${rootDir}/source/file1.md`,
                s`${rootDir}/source/file2.brs`
            ]);
        });

        it('keeps files from bsconfig.json even if the path matches an exclude list', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/file1.md`, ``);
            fsExtra.outputFileSync(`${rootDir}/source/file2.brs`, ``);

            fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
                files: ['source/**/*']
            });

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            const stub = sinon.stub(manager['projects'][0], 'applyFileChanges').callThrough();

            //register an exclusion filter
            pathFilterer.registerExcludeList(rootDir, [
                '**/*.md'
            ]);
            //make sure the .md file is included because of its project's files array
            await manager.handleFileChanges([
                { srcPath: `${rootDir}/source/file1.md`, type: FileChangeType.Created },
                { srcPath: `${rootDir}/source/file2.brs`, type: FileChangeType.Created }
            ]);
            await manager.onIdle();
            expect(
                stub.getCalls().flatMap(x => x.args[0]).map(x => x.srcPath)
            ).to.eql([
                s`${rootDir}/source/file1.md`,
                s`${rootDir}/source/file2.brs`
            ]);
        });

        it('does not create a standalone project for files that exist in a known project', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, `sub main() : end sub`);

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            await onNextDiagnostics();

            await manager.handleFileChanges([
                { srcPath: s`${rootDir}/source/main.brs`, type: FileChangeType.Changed, fileContents: `'test`, allowStandaloneProject: true }
            ]);

            await onNextDiagnostics();

            //there should NOT be a standalone project
            expect(manager['standaloneProjects'].size).to.eql(0);
        });

        it('converts a missing file to a delete', async () => {
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);
            await onNextDiagnostics();

            let applyFileChangesDeferred = new Deferred<DocumentActionWithStatus[]>();
            const project1 = manager.projects[0] as unknown as Project;

            const project1Stub = sinon.stub(project1, 'applyFileChanges').callsFake(async (...args) => {
                const result = await project1Stub.wrappedMethod.apply(project1, args);
                applyFileChangesDeferred.resolve(result);
                return result;
            });

            //emit created and changed events for files that don't exist. These turn into delete events
            await manager.handleFileChanges([
                { srcPath: `${rootDir}/source/missing1.brs`, type: FileChangeType.Created },
                { srcPath: `${rootDir}/source/missing2.brs`, type: FileChangeType.Changed }
            ]);

            //wait for the next set of diagnostics to arrive (signifying the files have been applied)
            const result = await applyFileChangesDeferred.promise;

            //make sure the project has these files
            expect(
                result.map(x => {
                    return { type: x.type, srcPath: x.srcPath };
                })
            ).to.eql([{
                srcPath: s`${rootDir}/source/missing1.brs`,
                type: 'set'
            }, {
                srcPath: s`${rootDir}/source/missing2.brs`,
                type: 'set'
            }, {
                srcPath: s`${rootDir}/source/missing1.brs`,
                type: 'delete'
            }, {
                srcPath: s`${rootDir}/source/missing2.brs`,
                type: 'delete'
            }]);
        });

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

        it('removes all files in a folder', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `sub main():print "main":end sub`);
            fsExtra.outputFileSync(`${rootDir}/source/libs/alpha/beta.brs`, `sub beta(): print one: end sub`);
            fsExtra.outputFileSync(`${rootDir}/source/libs/alpha/charlie/delta.brs`, `sub delta():print two:end sub`);
            fsExtra.outputFileSync(`${rootDir}/source/libs/echo/foxtrot.brs`, `sub foxtrot():print three:end sub`);

            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            expectDiagnostics(await onNextDiagnostics(), [
                DiagnosticMessages.cannotFindName('one').message,
                DiagnosticMessages.cannotFindName('two').message,
                DiagnosticMessages.cannotFindName('three').message
            ]);

            await manager.handleFileChanges([
                //register the entire folder as an "add"
                { srcPath: `${rootDir}/source/libs`, type: FileChangeType.Deleted }
            ]);

            expectZeroDiagnostics(await onNextDiagnostics());
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
                enableThreading: true
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

    describe('createAndActivateProject', () => {
        it('skips creating project if we already have it', async () => {
            await manager.syncProjects([{
                workspaceFolder: rootDir
            }]);

            await manager['createAndActivateProject']({
                projectPath: rootDir
            } as any);
            expect(manager.projects).to.be.length(1);
        });

        it('uses given projectNumber', async () => {
            await manager['createAndActivateProject']({
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
                await manager['createAndActivateProject']({
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

    describe('standalone projects', () => {
        it('creates a standalone project for files not found in a project', async () => {
            await manager.syncProjects([]);
            await manager.handleFileChanges([{
                srcPath: `${rootDir}/source/main.brs`,
                type: FileChangeType.Created,
                fileContents: `sub main():print "main":end sub`,
                allowStandaloneProject: true
            }]);
            await onNextDiagnostics();
            expect(
                [...manager['standaloneProjects'].values()][0]?.srcPath
            ).to.eql(s`${rootDir}/source/main.brs`);

            //it deletes the standalone project when the file is closed
            await manager.handleFileClose({
                srcPath: `${rootDir}/source/main.brs`
            });
            expect(manager['standaloneProjects'].size).to.eql(0);
        });
    });

    it('completes promise when project is disposed in the middle of a flow', async function () {
        this.timeout(20_000);
        //small plugin to communicate over a socket inside the worker thread.
        //This transpiles from tsc use `require()` for all imports and don't reference external vars
        class Plugin {
            public server: net.Server;

            private deferred = this.defer();

            constructor(port: number, host: string) {
                // eslint-disable-next-line
                const net = require('net');
                console.log('Starting server');
                this.server = net.createServer((socket) => {
                    console.log('Client connected');
                    socket.on('data', (data: Buffer) => {
                        let text = data.toString();
                        console.log('message received', JSON.stringify(text));
                        //when we get the event to resolve, do it
                        if (text === 'resolve') {
                            console.log('Resolving promise');
                            this.deferred.resolve();
                            this.server.close();
                        }
                    });
                });
                this.server.listen(port, host);
            }

            afterProgramCreate(program: Program) {
                // hijack the function to get workspace symbols, return a promise that resolves in the future
                program.getWorkspaceSymbols = () => {
                    return this.deferred.promise as any;
                };
            }

            private defer() {
                let resolve;
                let reject;
                let promise = new Promise((res, rej) => {
                    resolve = res;
                    reject = rej;
                });
                return {
                    resolve: resolve,
                    reject: reject,
                    promise: promise
                };
            }
        }

        const port = await getPort();
        const host = '127.0.0.1';

        //write a small brighterscript plugin to allow this test to communicate with the thread
        fsExtra.outputFileSync(`${rootDir}/plugin.js`, `
            ${Plugin.toString()};
            exports.default = function() {
                return new Plugin(${port}, "${host}");
            };
        `);
        //write a bsconfig that will load this plugin
        fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
            plugins: [
                `${rootDir}/plugin.js`
            ]
        });

        //wait for the projects to finish syncing/loading
        await manager.syncProjects([{
            workspaceFolder: rootDir,
            enableThreading: true
        }]);

        //establish the connection with the plugin
        const connection = net.createConnection({
            host: host,
            port: port
        });

        //do the request to fetch symbols (this will be stalled on purpose by our test plugin)
        let managerGetWorkspaceSymbolPromise = manager.getWorkspaceSymbol();

        //small sleep to let things settle
        await util.sleep(20);

        //now dispose the project (which should destroy all of the listeners)
        manager['removeProject'](manager.projects[0]);

        //settle again
        await util.sleep(20);

        console.log('Asking the client to resolve');

        //resolve the request
        connection.write('resolve');

        //now wait to see if we ever get the response back
        let result = await managerGetWorkspaceSymbolPromise;

        //the result should be an empty array, since the only project was rejected in the middle of the request
        expect(result).to.eql([]);

        //test passes if the promise resolves
    });

    it('properly handles reloading when bsconfig.json contents change', async () => {
        fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
            files: [
                'one'
            ]
        });

        //wait for the projects to finish syncing/loading
        await manager.syncProjects([{
            workspaceFolder: rootDir,
            enableThreading: false
        }]);

        const stub = sinon.stub(manager as any, 'reloadProject').callThrough();

        //change the file to new contents
        fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
            files: [
                'two'
            ]
        });
        await manager.handleFileChanges([{
            srcPath: `${rootDir}/bsconfig.json`,
            type: FileChangeType.Changed
        }]);

        //the project was reloaded
        expect(stub.callCount).to.eql(1);

        //change the file to the same contents
        fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
            files: [
                'two'
            ]
        });
        await manager.handleFileChanges([{
            srcPath: `${rootDir}/bsconfig.json`,
            type: FileChangeType.Changed
        }]);
        //the project was not reloaded this time
        expect(stub.callCount).to.eql(1);
    });
});
