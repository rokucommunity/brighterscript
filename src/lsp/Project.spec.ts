import { expect } from 'chai';
import { tempDir, rootDir, expectDiagnosticsAsync, expectDiagnostics } from '../testHelpers.spec';
import * as fsExtra from 'fs-extra';
import util, { standardizePath as s } from '../util';
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

            //explicitly trigger and wait for the first validation
            await project.validate();

            let validationCount = 0;
            let maxValidationCount = 0;
            //force validation cycles to yield very frequently
            project['builder'].program['validationMinSyncDuration'] = 0.001;

            project['builder'].program.plugins.add({
                name: 'Test',
                beforeValidateProgram: () => {
                    validationCount++;
                    maxValidationCount = Math.max(maxValidationCount, validationCount);
                },
                afterValidateProgram: () => {
                    validationCount--;
                }
            });

            //very small threshold so every validation step will yield
            project['builder'].program['validationMinSyncDuration'] = 0.001;
            sinon.stub(Scope.prototype, 'validate').callsFake(() => {
                //each of these needs to take about 1ms to complete
                const startTime = Date.now();
                while (Date.now() - startTime < 2) { }
                return true;
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

    describe('dispose', () => {
        it('cancels in-flight validation on dispose', async () => {
            await project.activate({
                projectKey: rootDir,
                projectDir: rootDir,
                bsconfigPath: undefined,
                workspaceFolder: rootDir,
                enableThreading: false
            });

            const cancelSpy = sinon.spy(project, 'cancelValidate');

            //start a validation (don't await it)
            const validatePromise = project.validate();

            //dispose mid-validation
            project.dispose();

            expect(cancelSpy.called).to.be.true;

            //the validate promise should still resolve (not hang)
            await validatePromise;
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

            await project.validate();

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

    describe('getFileRenameEdits', () => {
        async function activateBareProject() {
            await project.activate({
                projectDir: rootDir,
                projectKey: undefined,
                workspaceFolder: undefined,
                bsconfigPath: undefined
            });
        }

        it('rewrites a pkg:/ import that points at the renamed file', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/lib.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `import "pkg:/source/lib.bs"`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/lib.bs`,
                newSrcPath: s`${rootDir}/source/lib2.bs`
            });

            expect(edits).to.have.lengthOf(1);
            expect(edits[0].uri).to.eql(util.pathToUri(s`${rootDir}/source/main.bs`));
            expect(edits[0].newText).to.eql('pkg:/source/lib2.bs');
        });

        it('rewrites a relative import to a same-folder rename', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/lib.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `import "lib.bs"`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/lib.bs`,
                newSrcPath: s`${rootDir}/source/lib2.bs`
            });

            expect(edits).to.have.lengthOf(1);
            expect(edits[0].newText).to.eql('lib2.bs');
        });

        it('rewrites a relative import that crosses folders', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/lib.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/components/main.bs`, `import "../source/lib.bs"`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/lib.bs`,
                newSrcPath: s`${rootDir}/utils/lib.bs`
            });

            expect(edits).to.have.lengthOf(1);
            expect(edits[0].newText).to.eql('../utils/lib.bs');
        });

        it('returns no edits when no file imports the renamed file', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/lib.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `sub main():end sub`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/lib.bs`,
                newSrcPath: s`${rootDir}/source/lib2.bs`
            });

            expect(edits).to.be.empty;
        });

        it('returns no edits when the renamed file is not in this project', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `import "pkg:/source/lib.bs"`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/notInProject.bs`,
                newSrcPath: s`${rootDir}/source/notInProject2.bs`
            });

            expect(edits).to.be.empty;
        });

        it('produces an edit range that excludes the surrounding quotes', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/lib.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `import "lib.bs"`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/lib.bs`,
                newSrcPath: s`${rootDir}/source/lib2.bs`
            });

            expect(edits).to.have.lengthOf(1);
            //the file content is exactly: import "lib.bs"
            //the path token starts at character 8 (the `l`) and ends at character 14 (after the `s` of `bs`)
            expect(edits[0].range.start.character).to.eql(8);
            expect(edits[0].range.end.character).to.eql(14);
        });

        it('rewrites a relative <script uri> tag in an xml file', async () => {
            fsExtra.outputFileSync(s`${rootDir}/components/widget.brs`, '');
            fsExtra.outputFileSync(s`${rootDir}/components/widget.xml`, `<?xml version="1.0" encoding="utf-8"?>
                <component name="Widget" extends="Group">
                    <script type="text/brightscript" uri="widget.brs" />
                </component>`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/components/widget.brs`,
                newSrcPath: s`${rootDir}/components/widget2.brs`
            });

            expect(edits).to.have.lengthOf(1);
            expect(edits[0].uri).to.eql(util.pathToUri(s`${rootDir}/components/widget.xml`));
            expect(edits[0].newText).to.eql('widget2.brs');
        });

        it('rewrites a pkg:/ <script uri> tag in an xml file', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/util.brs`, '');
            fsExtra.outputFileSync(s`${rootDir}/components/widget.xml`, `<?xml version="1.0" encoding="utf-8"?>
                <component name="Widget" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/util.brs" />
                </component>`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/util.brs`,
                newSrcPath: s`${rootDir}/source/utility.brs`
            });

            expect(edits).to.have.lengthOf(1);
            expect(edits[0].newText).to.eql('pkg:/source/utility.brs');
        });

        it('emits both the import-statement edit and the xml script-tag edit when both reference the renamed file', async () => {
            fsExtra.outputFileSync(s`${rootDir}/source/lib.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.bs`, `import "pkg:/source/lib.bs"`);
            fsExtra.outputFileSync(s`${rootDir}/components/widget.xml`, `<?xml version="1.0" encoding="utf-8"?>
                <component name="Widget" extends="Group">
                    <script type="text/brightscript" uri="pkg:/source/lib.bs" />
                </component>`);
            await activateBareProject();

            const edits = await project.getFileRenameEdits({
                oldSrcPath: s`${rootDir}/source/lib.bs`,
                newSrcPath: s`${rootDir}/source/lib2.bs`
            });

            expect(edits).to.have.lengthOf(2);
            const editsByUri = new Map(edits.map(e => [e.uri, e.newText]));
            expect(editsByUri.get(util.pathToUri(s`${rootDir}/source/main.bs`))).to.eql('pkg:/source/lib2.bs');
            expect(editsByUri.get(util.pathToUri(s`${rootDir}/components/widget.xml`))).to.eql('pkg:/source/lib2.bs');
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

            await project.validate();

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

    describe('getDiagnostics', () => {
        it('does not crash when diagnostic is missing location', async () => {
            await project.activate({
                projectPath: rootDir
            } as any);
            await project.validate();

            //register a diagnostic with no location
            project['builder'].diagnostics.register({
                message: 'test diagnostic',
                location: undefined
            });

            //this should not throw
            project.getDiagnostics();
        });
    });
});
