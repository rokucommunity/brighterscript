import { expect } from './chai-config.spec';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
const sinon = createSandbox();
import { Program } from './Program';
import { ProgramBuilder } from './ProgramBuilder';
import { standardizePath as s, util } from './util';
import { Logger, LogLevel } from './Logger';
import * as diagnosticUtils from './diagnosticUtils';
import { DiagnosticSeverity, Range } from 'vscode-languageserver';
import { BrsFile } from './files/BrsFile';
import { expectZeroDiagnostics } from './testHelpers.spec';
import type { BsConfig } from './BsConfig';
import type { File } from './files/File';
import type { BsDiagnostic } from './interfaces';
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
        builder.logger = new Logger();
    });

    afterEach(() => {
        builder.dispose();
    });

    it('does not corrupt binary files', async () => {
        //transparent PNG
        const data = Buffer.from(
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 9, 112, 72, 89, 115, 0, 0, 11, 19, 0, 0, 11, 19, 1, 0, 154, 156, 24, 0, 0, 0, 13, 73, 68, 65, 84, 8, 153, 99, 248, 255, 255, 63, 3, 0, 8, 252, 2, 254, 133, 205, 171, 52, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
        );
        fsExtra.outputFileSync(`${rootDir}/assets/image.png`, data);
        fsExtra.outputFileSync(`${rootDir}/manifest`, '');
        await builder.run({
            ...builder.options,
            stagingDir: stagingDir,
            retainStagingDir: true,
            files: ['**/*']
        });
        const newData = fsExtra.readFileSync(s`${stagingDir}/assets/image.png`);
        expect(
            data.compare(newData)
        ).to.eql(0);
    });

    describe('loadFiles', () => {
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
            await builder['loadFiles']();
            expect(stub.getCalls()).to.be.lengthOf(3);
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
            await builder['loadFiles']();
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
            await builder['loadFiles']();
            //the d file should not be requested because `loadFiles` knows it doesn't exist
            expect(requestedFiles).not.to.include(s`${rootDir}/source/main.d.bs`);
            expect(requestedFiles).to.include(s`${rootDir}/source/main.brs`);
        });
    });

    describe('run', () => {
        afterEach(() => {
            try {
                fsExtra.removeSync(`${rootDir}/testProject`);
            } catch (e) {
                console.error(e);
            }
        });

        it('includes non-code files', async () => {
            fsExtra.outputFileSync(`${rootDir}/source/main.bs`, '');
            fsExtra.outputFileSync(`${rootDir}/manifest`, '');
            fsExtra.outputFileSync(`${rootDir}/assets/images/logo.png`, '');
            fsExtra.outputFileSync(`${rootDir}/locale/en_US/translations.xml`, '');

            await builder.run({
                ...builder.options,
                stagingDir: stagingDir,
                retainStagingDir: true,
                files: [
                    '**/*'
                ]
            });

            expect(fsExtra.pathExistsSync(`${stagingDir}/source/main.brs`)).to.be.true;
            expect(fsExtra.pathExistsSync(`${stagingDir}/manifest`)).to.be.true;
            expect(fsExtra.pathExistsSync(`${stagingDir}/assets/images/logo.png`)).to.be.true;
            expect(fsExtra.pathExistsSync(`${stagingDir}/locale/en_US/translations.xml`)).to.be.true;
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
    });

    it('uses a unique logger for each builder', async () => {
        let builder1 = new ProgramBuilder();
        sinon.stub(builder1 as any, 'runOnce').returns(Promise.resolve());
        sinon.stub(builder1 as any, 'loadFiles').returns(Promise.resolve());

        let builder2 = new ProgramBuilder();
        sinon.stub(builder2 as any, 'runOnce').returns(Promise.resolve());
        sinon.stub(builder2 as any, 'loadFiles').returns(Promise.resolve());

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
        f1.fileContents = null;
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

        sinon.stub(builder.program, 'getFile').returns(null);

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
                cwd: workingDir,
                createPackage: false
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
    let file = new BrsFile(filePath, filePath, null);
    let diagnostics = [];
    for (let message of messages) {
        let d = createDiagnostic(file, 1, message);
        d.file = file;
        diagnostics.push(d);
    }
    return diagnostics;
}
function createDiagnostic(
    file: File,
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
        file: file,
        severity: severity
    };
    return diagnostic;
}
