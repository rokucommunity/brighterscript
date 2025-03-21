import { expect } from './chai-config.spec';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
const sinon = createSandbox();
import { Program } from './Program';
import { ProgramBuilder } from './ProgramBuilder';
import { standardizePath as s, util } from './util';
import { LogLevel, createLogger } from './logging';
import * as diagnosticUtils from './diagnosticUtils';
import type { BscFile, BsDiagnostic } from '.';
import { Deferred, Range } from '.';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { BrsFile } from './files/BrsFile';
import { expectZeroDiagnostics } from './testHelpers.spec';
import type { BsConfig } from './BsConfig';
import { tempDir, rootDir, stagingDir } from './testHelpers.spec';

describe('ProgramBuilder', () => {

    beforeEach(() => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.emptyDirSync(tempDir);
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
    });

    let builder: ProgramBuilder;
    beforeEach(() => {
        builder = new ProgramBuilder();
        builder.options = util.normalizeAndResolveConfig({
            rootDir: rootDir
        });
        builder.program = new Program(builder.options);
        builder.logger = createLogger();
    });

    afterEach(() => {
        builder.dispose();
    });

    it('includes .program in the afterProgramCreate event', async () => {
        builder = new ProgramBuilder();
        const deferred = new Deferred<Program>();
        builder.plugins.add({
            name: 'test',
            afterProgramCreate: () => {
                deferred.resolve(builder.program);
            }
        });
        builder['createProgram']();
        expect(
            await deferred.promise
        ).to.exist;
    });

    describe('loadAllFilesAST', () => {
        it('loads .bs, .brs, .xml files', async () => {
            sinon.stub(util, 'getFilePaths').returns(Promise.resolve([{
                src: 'file1.brs',
                dest: 'file1.brs'
            }, {
                src: 'file2.bs',
                dest: 'file2.bs'
            }, {
                src: 'file3.xml',
                dest: 'file4.xml'
            }]));

            let stub = sinon.stub(builder.program, 'setFile');
            sinon.stub(builder, 'getFileContents').returns(Promise.resolve(''));
            await builder['loadAllFilesAST']();
            expect(stub.getCalls()).to.be.lengthOf(3);
        });

        it('finds and loads a manifest before all other files', async () => {
            sinon.stub(util, 'getFilePaths').returns(Promise.resolve([{
                src: 'file1.brs',
                dest: 'file1.brs'
            }, {
                src: 'file2.bs',
                dest: 'file2.bs'
            }, {
                src: 'file3.xml',
                dest: 'file4.xml'
            }, {
                src: 'manifest',
                dest: 'manifest'
            }]));

            let stubLoadManifest = sinon.stub(builder.program, 'loadManifest');
            let stubSetFile = sinon.stub(builder.program, 'setFile');
            sinon.stub(builder, 'getFileContents').returns(Promise.resolve(''));
            await builder['loadAllFilesAST']();
            expect(stubLoadManifest.calledBefore(stubSetFile)).to.be.true;
        });

        it('loads all type definitions first', async () => {
            const requestedFiles = [] as string[];
            builder['fileResolvers'].push((filePath) => {
                requestedFiles.push(s(filePath));
            });
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/main.d.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/lib.d.bs`, '');
            fsExtra.outputFileSync(s`${rootDir}/source/lib.brs`, '');
            const stub = sinon.stub(builder.program, 'setFile');
            await builder['loadAllFilesAST']();
            const srcPaths = stub.getCalls().map(x => x.args[0].src);
            //the d files should be first
            expect(srcPaths.indexOf(s`${rootDir}/source/main.d.bs`)).within(0, 1);
            expect(srcPaths.indexOf(s`${rootDir}/source/lib.d.bs`)).within(0, 1);
            //the non-d files should be last
            expect(srcPaths.indexOf(s`${rootDir}/source/main.brs`)).within(2, 3);
            expect(srcPaths.indexOf(s`${rootDir}/source/lib.brs`)).within(2, 3);
        });

        it('does not load non-existent type definition file', async () => {
            const requestedFiles = [] as string[];
            builder['fileResolvers'].push((filePath) => {
                requestedFiles.push(s(filePath));
            });
            fsExtra.outputFileSync(s`${rootDir}/source/main.brs`, '');
            await builder['loadAllFilesAST']();
            //the d file should not be requested because `loadAllFilesAST` knows it doesn't exist
            expect(requestedFiles).not.to.include(s`${rootDir}/source/main.d.bs`);
            expect(requestedFiles).to.include(s`${rootDir}/source/main.brs`);
        });
    });

    describe('run', () => {
        it('does not crash when options is undefined', async () => {
            sinon.stub(builder as any, 'runOnce').callsFake(() => { });
            await builder.run(undefined as any);
        });

        it('uses default options when the config file fails to parse', async () => {
            //supress the console log statements for the bsconfig parse errors
            sinon.stub(console, 'log').returns(undefined);
            //totally bogus config file
            fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, '{');
            await builder.run({
                project: s`${rootDir}/bsconfig.json`,
                username: 'john'
            });
            expect(builder.program.options.username).to.equal('rokudev');
        });

        //this fails on the windows travis build for some reason. skipping for now since it's not critical
        it.skip('throws an exception when run is called twice', async () => {
            await builder.run({});
            try {
                await builder.run({});
                expect(true).to.be.false('Should have thrown exception');
            } catch (e) { }
        });

        afterEach(() => {
            try {
                fsExtra.removeSync(`${rootDir}/testProject`);
            } catch (e) {
                console.error(e);
            }
        });

        it('only adds the last file with the same pkg path', async () => {
            //undo the vfs for this test
            sinon.restore();
            fsExtra.ensureDirSync(`${rootDir}/testProject/source`);
            fsExtra.writeFileSync(`${rootDir}/testProject/source/lib1.brs`, 'sub doSomething()\nprint "lib1"\nend sub');
            fsExtra.writeFileSync(`${rootDir}/testProject/source/lib2.brs`, 'sub doSomething()\nprint "lib2"\nend sub');

            await builder.run({
                rootDir: s`${rootDir}/testProject`,
                createPackage: false,
                deploy: false,
                copyToStaging: false,
                //both files should want to be the `source/lib.brs` file...but only the last one should win
                files: [{
                    src: s`${rootDir}/testProject/source/lib1.brs`,
                    dest: 'source/lib.brs'
                }, {
                    src: s`${rootDir}/testProject/source/lib2.brs`,
                    dest: 'source/lib.brs'
                }]
            });
            expectZeroDiagnostics(builder);
            expect(builder.program.getFile(s``));
        });

        it('runs initial validation by default', async () => {
            //undo the vfs for this test
            sinon.restore();
            fsExtra.outputFileSync(`${rootDir}/source/lib1.brs`, 'sub doSomething()\nprint "lib1"\nend sub');

            const stub = sinon.stub(builder as any, 'validateProject').callsFake(() => { });

            await builder.run({
                rootDir: rootDir,
                createPackage: false,
                deploy: false,
                copyToStaging: false,
                //both files should want to be the `source/lib.brs` file...but only the last one should win
                files: ['source/**/*']
            });
            expectZeroDiagnostics(builder);
            //validate was called
            expect(stub.callCount).to.eql(1);
        });

        it('skips initial validation', async () => {
            //undo the vfs for this test
            sinon.restore();
            fsExtra.outputFileSync(`${rootDir}/source/lib1.brs`, 'sub doSomething()\nprint "lib1"\nend sub');

            const stub = sinon.stub(builder as any, 'validateProject').callsFake(() => { });

            await builder.run({
                rootDir: rootDir,
                createPackage: false,
                deploy: false,
                copyToStaging: false,
                validate: false,
                //both files should want to be the `source/lib.brs` file...but only the last one should win
                files: ['source/**/*']
            });
            expectZeroDiagnostics(builder);
            //validate was not called
            expect(stub.callCount).to.eql(0);
        });
    });

    it('uses a unique logger for each builder', async () => {
        let builder1 = new ProgramBuilder();
        sinon.stub(builder1 as any, 'runOnce').returns(Promise.resolve());
        sinon.stub(builder1 as any, 'loadAllFilesAST').returns(Promise.resolve());

        let builder2 = new ProgramBuilder();
        sinon.stub(builder2 as any, 'runOnce').returns(Promise.resolve());
        sinon.stub(builder2 as any, 'loadAllFilesAST').returns(Promise.resolve());

        expect(builder1.logger).not.to.equal(builder2.logger);

        await Promise.all([
            builder1.run({
                logLevel: LogLevel.info,
                rootDir: rootDir,
                stagingDir: stagingDir,
                watch: false
            }),
            builder2.run({
                logLevel: LogLevel.error,
                rootDir: rootDir,
                stagingDir: stagingDir,
                watch: false
            })
        ]);

        //the loggers should have different log levels
        expect(builder1.logger.logLevel).to.equal(LogLevel.info);
        expect(builder2.logger.logLevel).to.equal(LogLevel.error);
    });

    it('does not error when loading stagingDir from bsconfig.json', async () => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.writeFileSync(`${rootDir}/bsconfig.json`, `{
            "stagingDir": "./out"
        }`);
        let builder = new ProgramBuilder();
        await builder.run({
            cwd: rootDir,
            createPackage: false
        });
    });

    it('forwards program events', async () => {
        const beforeProgramValidate = sinon.spy();
        const afterProgramValidate = sinon.spy();
        builder.plugins.add({
            name: 'forwards program events',
            beforeProgramValidate: beforeProgramValidate,
            afterProgramValidate: afterProgramValidate
        });
        await builder.run({
            createPackage: false
        });
        expect(beforeProgramValidate.callCount).to.equal(1);
        expect(afterProgramValidate.callCount).to.equal(1);
    });


    describe('printDiagnostics', () => {

        it('does not crash when a diagnostic is missing range informtaion', () => {
            const file = builder.program.setFile('source/main.brs', ``);
            file.addDiagnostics([{
                message: 'message 1',
                code: 'test1',
                file: file
            }, {
                message: 'message 2',
                code: 'test1',
                file: file
            }] as any);
            const stub = sinon.stub(diagnosticUtils, 'printDiagnostic').callsFake(() => { });
            //if this doesn't crash, then the test passes
            builder['printDiagnostics']();
            expect(stub.getCalls().map(x => x.args[4].message)).to.eql([
                'message 1',
                'message 2'
            ]);
        });

        it('prints no diagnostics when showDiagnosticsInConsole is false', () => {
            builder.options.showDiagnosticsInConsole = false;

            let stub = sinon.stub(builder, 'getDiagnostics').returns([]);
            expect(stub.called).to.be.false;
            builder['printDiagnostics']();
        });

        it('prints nothing when there are no diagnostics', () => {
            builder.options.showDiagnosticsInConsole = true;

            sinon.stub(builder, 'getDiagnostics').returns([]);
            let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

            builder['printDiagnostics']();

            expect(printStub.called).to.be.false;
        });

        it('prints diagnostic, when file is present in project', () => {
            builder.options.showDiagnosticsInConsole = true;

            let diagnostics = createBsDiagnostic('p1', ['m1']);
            let f1 = diagnostics[0].file as BrsFile;
            f1.fileContents = `l1\nl2\nl3`;
            sinon.stub(builder, 'getDiagnostics').returns(diagnostics);

            sinon.stub(builder.program, 'getFile').returns(f1);

            let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

            builder['printDiagnostics']();

            expect(printStub.called).to.be.true;
        });
    });

    it('prints diagnostic, when file has no lines', () => {
        builder.options.showDiagnosticsInConsole = true;

        let diagnostics = createBsDiagnostic('p1', ['m1']);
        let f1 = diagnostics[0].file as BrsFile;
        (f1.fileContents as any) = null;
        sinon.stub(builder, 'getDiagnostics').returns(diagnostics);

        sinon.stub(builder.program, 'getFile').returns(f1);

        let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

        builder['printDiagnostics']();

        expect(printStub.called).to.be.true;
    });

    it('prints diagnostic, when no file present', () => {
        builder.options.showDiagnosticsInConsole = true;

        let diagnostics = createBsDiagnostic('p1', ['m1']);
        sinon.stub(builder, 'getDiagnostics').returns(diagnostics);

        sinon.stub(builder.program, 'getFile').returns(null as any);

        let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

        builder['printDiagnostics']();

        expect(printStub.called).to.be.true;
    });

    describe('require', () => {
        it('loads relative and absolute items', async () => {
            const workingDir = s`${tempDir}/require-test`;
            const relativeOutputPath = `${tempDir}/relative.txt`.replace(/\\+/g, '/');
            const moduleOutputPath = `${tempDir}/brighterscript-require-test.txt`.replace(/\\+/g, '/');

            //create roku project files
            fsExtra.outputFileSync(s`${workingDir}/src/manifest`, '');

            //create "modules"
            fsExtra.outputFileSync(s`${workingDir}/relative.js`, `
                var fs = require('fs');
                fs.writeFileSync('${relativeOutputPath}', '');
            `);
            fsExtra.outputJsonSync(s`${workingDir}/node_modules/brighterscript-require-test/package.json`, {
                name: 'brighterscript-require-test',
                version: '1.0.0',
                main: 'index.js'
            });
            fsExtra.outputFileSync(s`${workingDir}/node_modules/brighterscript-require-test/index.js`, `
                var fs = require('fs');
                fs.writeFileSync('${moduleOutputPath}', '');
            `);

            //create the bsconfig file
            fsExtra.outputJsonSync(s`${workingDir}/bsconfig.json`, {
                rootDir: 'src',
                require: [
                    //relative script
                    './relative.js',
                    //script from node_modules
                    'brighterscript-require-test'
                ]
            } as BsConfig);

            builder = new ProgramBuilder();
            await builder.run({
                cwd: workingDir
            });
            expect(
                fsExtra.pathExistsSync(relativeOutputPath)
            ).to.be.true;
            expect(
                fsExtra.pathExistsSync(moduleOutputPath)
            ).to.be.true;
        });
    });
});

function createBsDiagnostic(filePath: string, messages: string[]): BsDiagnostic[] {
    let file = new BrsFile(filePath, filePath, null as any);
    let diagnostics: BsDiagnostic[] = [];
    for (let message of messages) {
        let d = createDiagnostic(file, 1, message);
        d.file = file;
        diagnostics.push(d);
    }
    return diagnostics;
}
function createDiagnostic(
    bscFile: BscFile,
    code: number,
    message: string,
    startLine = 0,
    startCol = 99999,
    endLine = 0,
    endCol = 99999,
    severity: DiagnosticSeverity = DiagnosticSeverity.Error
) {
    const diagnostic = {
        code: code,
        message: message,
        range: Range.create(startLine, startCol, endLine, endCol),
        file: bscFile,
        severity: severity
    };
    return diagnostic;
}
