import { expect } from 'chai';
import { tempDir, rootDir, expectDiagnosticsAsync } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from '../util';
import { Deferred } from '../deferred';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { Project } from './Project';
import { createSandbox } from 'sinon';
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

    describe('setFile', () => {
        it('skips setting the file if the contents have not changed', async () => {
            await project.activate({ projectPath: rootDir } as any);
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
    });

    describe('activate', () => {
        it('finds bsconfig.json at root', async () => {
            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');
            await project.activate({
                projectPath: rootDir
            } as any);
            expect(project.bsconfigPath).to.eql(s`${rootDir}/bsconfig.json`);
        });

        it('produces diagnostics after running', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.brs`, `
                sub main()
                    print varNotThere
                end sub
            `);

            await project.activate({
                projectPath: rootDir
            } as any);

            await expectDiagnosticsAsync(project, [
                DiagnosticMessages.cannotFindName('varNotThere').message
            ]);
        });
    });

    describe('createProject', () => {
        it('uses given projectNumber', async () => {
            await project.activate({
                projectPath: rootDir,
                projectNumber: 123
            } as any);
            expect(project.projectNumber).to.eql(123);
        });

        it('warns about deprecated brsconfig.json', async () => {
            fsExtra.outputFileSync(`${rootDir}/subdir1/brsconfig.json`, '');
            await project.activate({
                projectPath: rootDir,
                workspaceFolder: rootDir,
                configFilePath: 'subdir1/brsconfig.json'
            } as any);
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
                projectPath: rootDir,
                configFilePath: s`${rootDir}/bsconfig.json`
            });
            expect(
                (await deferred.promise).startsWith('Cannot find config file')
            ).to.be.true;
        });

        it('finds brsconfig.json', async () => {
            fsExtra.outputFileSync(`${rootDir}/brsconfig.json`, '');
            expect(
                await project['getConfigFilePath']({
                    projectPath: rootDir
                })
            ).to.eql(s`${rootDir}/brsconfig.json`);
        });

        it('does not crash on undefined', async () => {
            await project['getConfigFilePath'](undefined);
        });
    });
});
