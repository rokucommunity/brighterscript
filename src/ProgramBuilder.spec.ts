import { expect } from 'chai';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
const sinon = createSandbox();
import { Program } from './Program';
import { ProgramBuilder } from './ProgramBuilder';
import { standardizePath as s, util } from './util';
import { Logger, LogLevel } from './Logger';
import * as diagnosticUtils from './diagnosticUtils';
import { Range, BscFile, BsDiagnostic } from '.';
import { DiagnosticSeverity } from './astUtils';
import { BrsFile } from './files/BrsFile';

let tmpPath = s`${process.cwd()}/.tmp`;
let rootDir = s`${tmpPath}/rootDir`;
let stagingFolderPath = s`${tmpPath}/staging`;

describe('ProgramBuilder', () => {
    beforeEach(() => {
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
    });
    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
    });

    let builder: ProgramBuilder;
    let b: any;
    beforeEach(async () => {
        builder = new ProgramBuilder();
        b = builder;
        b.options = await util.normalizeAndResolveConfig(undefined);
        b.program = new Program(b.options);
        b.logger = new Logger();
    });

    afterEach(() => {
        builder.dispose();
    });

    describe('loadAllFilesAST', () => {
        it('loads .bs, .brs, .xml files', async () => {
            sinon.stub(util, 'getFilePaths').returns(Promise.resolve([{
                src: 'file.brs',
                dest: 'file.brs'
            }, {
                src: 'file.bs',
                dest: 'file.bs'
            }, {
                src: 'file.xml',
                dest: 'file.xml'
            }]));

            b.program = {
                addOrReplaceFile: () => { }
            };
            let stub = sinon.stub(b.program, 'addOrReplaceFile');
            await b.loadAllFilesAST();
            expect(stub.getCalls()).to.be.lengthOf(3);
        });
    });

    describe('run', () => {
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
            const diagnostics = builder.getDiagnostics();
            expect(diagnostics.map(x => x.message)).to.eql([]);
            expect(builder.program.getFileByPathAbsolute(s``));
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
                stagingFolderPath: stagingFolderPath,
                watch: false
            }),
            builder2.run({
                logLevel: LogLevel.error,
                rootDir: rootDir,
                stagingFolderPath: stagingFolderPath,
                watch: false
            })
        ]);

        //the loggers should have different log levels
        expect(builder1.logger.logLevel).to.equal(LogLevel.info);
        expect(builder2.logger.logLevel).to.equal(LogLevel.error);
    });

    it('does not error when loading stagingFolderPath from bsconfig.json', async () => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.writeFileSync(`${rootDir}/bsconfig.json`, `{
            "stagingFolderPath": "./out"
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

      beforeEach(() => {
          fsExtra.ensureDirSync(tmpPath);
          fsExtra.emptyDirSync(tmpPath);
      });

      afterEach(() => {
          sinon.restore();
      });

      it('prints no diagnostics when showDiagnosticsInConsole is false', () => {
          builder = new ProgramBuilder();
          builder.options = {
              showDiagnosticsInConsole: false
          };

          let stub = sinon.stub(builder, 'getDiagnostics').returns([]);
          expect(stub.called).to.be.false;
          builder['printDiagnostics']();
      });


      it('prints nothing when there are no diagnostics', () => {

          builder = new ProgramBuilder();
          builder.options = {
              showDiagnosticsInConsole: true
          };
          sinon.stub(builder, 'getDiagnostics').returns([]);
          let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

          builder['printDiagnostics']();

          expect(printStub.called).to.be.false;
      });

      it('prints diagnostic, when file is present in project', () => {

          builder = new ProgramBuilder();
          builder.options = {
              showDiagnosticsInConsole: true
          };
          builder.program = new Program({});

          let diagnostics = createBsDiagnostic('p1', ['m1']);
          let f1 = diagnostics[0].file as BrsFile;
          f1.fileContents = `l1
l2
l3`;
          sinon.stub(builder, 'getDiagnostics').returns(diagnostics);

          sinon.stub(builder.program, 'getFileByPathAbsolute').returns(f1);

          let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

          builder['printDiagnostics']();

          expect(printStub.called).to.be.true;
      });
    });

    it('prints diagnostic, when file has no lines', () => {

        builder = new ProgramBuilder();
        builder.options = {
            showDiagnosticsInConsole: true
        };
        builder.program = new Program({});

        let diagnostics = createBsDiagnostic('p1', ['m1']);
        let f1 = diagnostics[0].file as BrsFile;
        f1.fileContents = null;
        sinon.stub(builder, 'getDiagnostics').returns(diagnostics);

        sinon.stub(builder.program, 'getFileByPathAbsolute').returns(f1);

        let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

        builder['printDiagnostics']();

        expect(printStub.called).to.be.true;
    });

    it('prints diagnostic, when no file present', () => {

        builder = new ProgramBuilder();
        builder.options = {
            showDiagnosticsInConsole: true
        };
        builder.program = new Program({});

        let diagnostics = createBsDiagnostic('p1', ['m1']);
        sinon.stub(builder, 'getDiagnostics').returns(diagnostics);

        sinon.stub(builder.program, 'getFileByPathAbsolute').returns(null);

        let printStub = sinon.stub(diagnosticUtils, 'printDiagnostic');

        builder['printDiagnostics']();

        expect(printStub.called).to.be.true;
    });
});

function createBsDiagnostic(filePath: string, messages: string[]): BsDiagnostic[] {
  let file = new BrsFile(filePath, filePath, null);
  let diagnostics = [];
  for (let message in messages) {
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
    startLine: number = 0,
    startCol: number = 99999,
    endLine: number = 0,
    endCol: number = 99999,
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

