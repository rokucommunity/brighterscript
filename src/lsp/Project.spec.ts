import { expect } from 'chai';
import { tempDir, rootDir, expectDiagnosticsAsync, expectDiagnostics, once } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../util';
import { Deferred } from '../deferred';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { Project } from './Project';
import { createSandbox } from 'sinon';
import { Scope } from '../Scope';
const sinon = createSandbox();

describe('Project', () => {
    let project: Project;

    beforeEach(() => {
        sinon.restore();
        project = new Project();
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        sinon.restore();
        fsExtra.emptyDirSync(tempDir);
        project.dispose();
    });

    describe('on', () => {
        it('emits events', async () => {
            const stub = sinon.stub();
            const off = project.on('diagnostics', stub);
            await project['emit']('diagnostics', { diagnostics: [] });
            expect(stub.callCount).to.eql(1);

            await project['emit']('diagnostics', { diagnostics: [] });
            expect(stub.callCount).to.eql(2);

            off();

            await project['emit']('diagnostics', { diagnostics: [] });
            expect(stub.callCount).to.eql(2);
        });
    });

    describe('validate', () => {
        it('prevents multiple valiations from running at the same time', async () => {
            //create 10 scopes, which should each take at least 1ms to validate
            for (let i = 0; i < 20; i++) {
                fsExtra.outputFileSync(`${rootDir}/components/component${i}.xml`, `<component name="component${i}"></component>`);
            }
            await project.activate({
                projectKey: rootDir,
                projectDir: rootDir,
                bsconfigPath: undefined,
                workspaceFolder: rootDir,
                enableThreading: false
            });

            //wait for the first validate to finish
            await new Promise<void>((resolve) => {
                const off = project.on('validate-end', () => {
                    off();
                    resolve();
                });
            });

            let validationCount = 0;
            let maxValidationCount = 0;
            //force validation cycles to yield very frequently
            project['builder'].program['validationMinSyncDuration'] = 0.001;

            project['builder'].program.plugins.add({
                name: 'Test',
                beforeProgramValidate: () => {
                    validationCount++;
                    maxValidationCount = Math.max(maxValidationCount, validationCount);
                },
                afterProgramValidate: () => {
                    validationCount--;
                }
            });

            //very small threshold so every validation step will yield
            project['builder'].program['validationMinSyncDuration'] = 0.001;
            sinon.stub(Scope.prototype, 'validate').callsFake(() => {
                //each of these needs to take about 1ms to complete
                const startTime = Date.now();
                while (Date.now() - startTime < 2) { }
            });

            //validate 3 times in quick succession
            await Promise.all([
                project.validate(),
                project.validate(),
                project.validate()
            ]);
            expect(validationCount).to.eql(0);
            expect(maxValidationCount).to.eql(1);
        });
    });

    describe('activate', () => {
        it('uses `files` from bsconfig.json', async () => {
            fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
                rootDir: rootDir,
                files: [{
                    src: s`${tempDir}/lib1.brs`,
                    dest: 'source/lib1.brs'
                }]
            });
            fsExtra.outputFileSync(`${tempDir}/lib1.brs`, `
                sub main()
                    print alpha 'this var doesn't exist
                end sub
            `);
            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });

            await once(project, 'diagnostics');

            expectDiagnostics(project, [
                DiagnosticMessages.cannotFindName('alpha').message
            ]);
        });

        it('prevents creating package on first run', async () => {
            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });
            expect(project['builder'].program.options.noEmit).to.be.true;
        });
    });

    describe('applyFileChanges', () => {
        it('skips setting the file if the contents have not changed', async () => {
            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });
            //initial set should be true
            expect(
                (await project.applyFileChanges([{
                    fileContents: 'sub main:end sub',
                    srcPath: s`${rootDir}/source/main.brs`,
                    type: 'set'
                }]))[0].status
            ).to.eql('accepted');

            //contents haven't changed, this should be false
            expect(
                (await project.applyFileChanges([{
                    fileContents: 'sub main:end sub',
                    srcPath: s`${rootDir}/source/main.brs`,
                    type: 'set'
                }]))[0].status
            ).to.eql('accepted');

            //contents changed again, should be true
            expect(
                (await project.applyFileChanges([{
                    fileContents: 'sub main2:end sub',
                    srcPath: s`${rootDir}/source/main.brs`,
                    type: 'set'
                }]))[0].status
            ).to.eql('accepted');
        });

        it('always includes a status', async () => {
            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });

            project['builder'].options.files = [
                'source/**/*',
                '!source/**/*.spec.bs'
            ];

            //set file that maches files array
            expect((await project['applyFileChanges']([{
                fileContents: '',
                srcPath: s`${rootDir}/source/main.bs`,
                type: 'set'
            }]))[0].status).to.eql('accepted');

            //delete this file that matches a file in the program
            expect((await project['applyFileChanges']([{
                srcPath: s`${rootDir}/source/main.bs`,
                type: 'delete'
            }]))[0].status).to.eql('accepted');

            //set file that does not match files array files array
            expect((await project['applyFileChanges']([{
                fileContents: '',
                srcPath: s`${rootDir}/source/main.spec.bs`,
                type: 'set'
            }]))[0].status).to.eql('rejected');

            //delete directory is "reject" because those should be unraveled into individual files on the outside
            expect((await project['applyFileChanges']([{
                srcPath: s`${rootDir}/source`,
                type: 'delete'
            }]))[0].status).to.eql('rejected');
        });
    });

    describe('activate', () => {
        it('finds bsconfig.json at root', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });
            expect(project.bsconfigPath).to.eql(s`${rootDir}/bsconfig.json`);
        });

        it('produces diagnostics after running', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });

            await once(project, 'diagnostics');

            await expectDiagnosticsAsync(project, [
                DiagnosticMessages.cannotFindName('varNotThere').message
            ]);
        });
    });

    describe('createProject', () => {
        it('uses given projectNumber', async () => {
            await project.activate({
                projectDir: rootDir,
                projectNumber: 123,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });
            expect(project.projectNumber).to.eql(123);
        });

        it('warns about deprecated brsconfig.json', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir1/brsconfig.json`, '');
            await project.activate({
                bsconfigPath: 'subdir1/brsconfig.json',
                projectDir: rootDir,
                workspaceFolder: rootDir,
                projectKey: undefined
            });
            await expectDiagnosticsAsync(project, [
                DiagnosticMessages.brsConfigJsonIsDeprecated()
            ]);
        });
    });

    describe('getConfigPath', () => {
        it('emits critical failure for missing file', async () => {
            const deferred = new Deferred<string>();
            project.on('critical-failure', (event) => {
                deferred.resolve(event.message);
            });
            await project['getConfigFilePath']({
                projectDir: rootDir,
                bsconfigPath: s`${rootDir}/bsconfig.json`
            });
            expect(
                (await deferred.promise).startsWith('Cannot find config file')
            ).to.be.true;
        });

        it('finds brsconfig.json', async () => {
            fsExtra.outputFileSync(`${rootDir}/brsconfig.json`, '');
            expect(
                await project['getConfigFilePath']({
                    projectDir: rootDir,
                    bsconfigPath: undefined
                })
            ).to.eql(s`${rootDir}/brsconfig.json`);
        });

        it('does not crash on undefined', async () => {
            await project['getConfigFilePath'](undefined);
        });
    });
});
