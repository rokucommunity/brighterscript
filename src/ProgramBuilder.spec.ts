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

    describe('loadPlugins', () => {
        let pluginPath: string;
        let pluginId = 1;

        beforeEach(() => {
            pluginPath = `${tempDir}/pb-plugin${pluginId++}.js`;
        });

        it('calls onSetConfiguration with inline config object when plugin entry is an object', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports = function() {
                    return { name: 'ConfigPlugin' };
                };
            `);
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'ConfigPlugin',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: { myOption: true },
                entry: { src: pluginPath, config: { myOption: true } }
            }]);
            builder.options = util.normalizeAndResolveConfig({
                rootDir: rootDir,
                plugins: [{ src: pluginPath, config: { myOption: true } }]
            });
            builder['loadPlugins']();
            expect(receivedConfigs).to.eql([{ myOption: true }]);
        });

        it('calls onSetConfiguration with empty object when plugin has no config', () => {
            let receivedConfig: any;
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'NoConfigPlugin',
                    onSetConfiguration: (cfg: any) => {
                        receivedConfig = cfg;
                    }
                },
                config: undefined,
                entry: pluginPath
            }]);
            builder.options = util.normalizeAndResolveConfig({
                rootDir: rootDir,
                plugins: [pluginPath]
            });
            builder['loadPlugins']();
            expect(receivedConfig).to.eql({});
        });

        it('calls onSetConfiguration with empty object for string shorthand plugins', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports = function() {
                    return { name: 'StringShorthandPlugin' };
                };
            `);
            let receivedConfig: any;
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'StringShorthandPlugin',
                    onSetConfiguration: (cfg: any) => {
                        receivedConfig = cfg;
                    }
                },
                config: undefined,
                entry: pluginPath
            }]);
            builder.options = util.normalizeAndResolveConfig({
                rootDir: rootDir,
                plugins: [pluginPath]
            });
            builder['loadPlugins']();
            expect(receivedConfig).to.eql({});
        });

        it('does not crash when plugin has no onSetConfiguration method', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports = function() {
                    return { name: 'MinimalPlugin' };
                };
            `);
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: { name: 'MinimalPlugin' },
                config: { someConfig: 'value' },
                entry: { src: pluginPath, config: { someConfig: 'value' } }
            }]);
            builder.options = util.normalizeAndResolveConfig({
                rootDir: rootDir,
                plugins: [{ src: pluginPath, config: { someConfig: 'value' } }]
            });
            // should not throw
            expect(() => builder['loadPlugins']()).not.to.throw();
        });

        it('calls onSetConfiguration with config loaded from a JSONC file', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports = function() {
                    return { name: 'FileConfigPlugin' };
                };
            `);
            const configPath = `${tempDir}/my-plugin-config.json`;
            fsExtra.writeFileSync(configPath, `{ "enabled": true, "threshold": 5 }`);
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'FileConfigPlugin',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: { enabled: true, threshold: 5 },
                entry: { src: pluginPath, config: configPath }
            }]);
            builder.options = util.normalizeAndResolveConfig({
                rootDir: rootDir,
                plugins: [{ src: pluginPath, config: configPath }]
            });
            builder['loadPlugins']();
            expect(receivedConfigs).to.eql([{ enabled: true, threshold: 5 }]);
        });

        it('adds all loaded plugins to the plugin interface', () => {
            sinon.stub(util, 'loadPlugins').returns([
                { plugin: { name: 'PluginA' }, config: undefined, entry: 'pluginA' },
                { plugin: { name: 'PluginB' }, config: undefined, entry: 'pluginB' }
            ]);
            builder.options = util.normalizeAndResolveConfig({
                rootDir: rootDir,
                plugins: ['pluginA', 'pluginB']
            });
            builder['loadPlugins']();
            expect(builder.plugins.has({ name: 'PluginA' })).to.be.false; // `has` checks by reference
            // verify via emit - count beforeProgramCreate calls
            let callCount = 0;
            builder.plugins.add({
                name: 'counter',
                beforeProgramCreate: () => {
                    callCount++;
                }
            });
            // PluginA and PluginB don't have beforeProgramCreate, so only counter fires
            builder.plugins.emit('beforeProgramCreate', builder as any);
            expect(callCount).to.eql(1);
        });

        it('deep-merges CLI plugin overrides on top of bsconfig plugin config', () => {
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'my-plugin',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: { severity: 'warn', nested: { a: 1, b: 2 } },
                entry: { src: 'my-plugin' }
            }]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            // simulate what cli.ts produces for --plugin.my-plugin.severity=error --plugin.my-plugin.nested.a=99
            builder.options.pluginOverrides = { 'my-plugin': { merge: { severity: 'error', nested: { a: 99 } } } };
            builder['loadPlugins']();
            expect(receivedConfigs[0]).to.eql({ severity: 'error', nested: { a: 99, b: 2 } });
        });

        it('CLI plugin overrides only affect the matched plugin', () => {
            const configA: any[] = [];
            const configB: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([
                { plugin: { name: 'plugin-a', onSetConfiguration: (cfg: any) => configA.push(cfg) }, config: { x: 1 }, entry: { src: 'plugin-a' } },
                { plugin: { name: 'plugin-b', onSetConfiguration: (cfg: any) => configB.push(cfg) }, config: { y: 2 }, entry: { src: 'plugin-b' } }
            ]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            builder.options.pluginOverrides = { 'plugin-a': { merge: { x: 99 } } };
            builder['loadPlugins']();
            expect(configA[0]).to.eql({ x: 99 });
            expect(configB[0]).to.eql({ y: 2 });
        });

        it('CLI plugin overrides apply even when plugin has no bsconfig config', () => {
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'bare-plugin',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: undefined,
                entry: 'bare-plugin'
            }]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            builder.options.pluginOverrides = { 'bare-plugin': { merge: { foo: 'bar' } } };
            builder['loadPlugins']();
            expect(receivedConfigs[0]).to.eql({ foo: 'bar' });
        });

        it('matches override by bsconfig user-supplied name over factory name', () => {
            const configA: any[] = [];
            const configB: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([
                //plugin A: factory name is 'bslint' (no user-supplied name)
                { plugin: { name: 'bslint', onSetConfiguration: (cfg: any) => configA.push(cfg) }, config: { id: 'A' }, entry: '@rokucommunity/bslint' },
                //plugin B: bsconfig assigns user-supplied name 'bslint' to a different plugin
                { plugin: { name: 'bslint', onSetConfiguration: (cfg: any) => configB.push(cfg) }, config: { id: 'B' }, entry: { src: './other.js', name: 'bslint' } }
            ]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            //user wrote --plugin.bslint.enabled=true; user-supplied name wins → only plugin B should be configured
            builder.options.pluginOverrides = { 'bslint': { merge: { enabled: true } } };
            builder['loadPlugins']();
            expect(configA[0]).to.eql({ id: 'A' });
            expect(configB[0]).to.eql({ id: 'B', enabled: true });
        });

        it('matches override by bsconfig src as fallback', () => {
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'some-factory-name',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: undefined,
                entry: './scripts/myPlugin.js'
            }]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            //target by src — neither user-name nor factory-name match, but src does
            builder.options.pluginOverrides = { './scripts/myPlugin.js': { merge: { foo: 'bar' } } };
            builder['loadPlugins']();
            expect(receivedConfigs[0]).to.eql({ foo: 'bar' });
        });

        it('user-supplied bsconfig name wins even when other plugins have the same factory name (no ambiguity error)', () => {
            //three plugins all reporting factory name 'bslint'; only one has a user-supplied bsconfig name
            const configs: Record<string, any[]> = { A: [], B: [], C: [] };
            sinon.stub(util, 'loadPlugins').returns([
                { plugin: { name: 'bslint', onSetConfiguration: (cfg: any) => configs.A.push(cfg) }, config: { tag: 'A' }, entry: '@one/bslint' },
                { plugin: { name: 'bslint', onSetConfiguration: (cfg: any) => configs.B.push(cfg) }, config: { tag: 'B' }, entry: { src: './local.js', name: 'bslint' } },
                { plugin: { name: 'bslint', onSetConfiguration: (cfg: any) => configs.C.push(cfg) }, config: { tag: 'C' }, entry: '@two/bslint' }
            ]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            builder.options.pluginOverrides = { 'bslint': { merge: { enabled: true } } };
            //should NOT throw — user-supplied name on plugin B is the unambiguous winner
            expect(() => builder['loadPlugins']()).not.to.throw();
            expect(configs.A[0]).to.eql({ tag: 'A' });
            expect(configs.B[0]).to.eql({ tag: 'B', enabled: true });
            expect(configs.C[0]).to.eql({ tag: 'C' });
        });

        it('hard-fails when a CLI override identifier is ambiguous across factory names', () => {
            sinon.stub(util, 'loadPlugins').returns([
                { plugin: { name: 'bslint', onSetConfiguration: () => { } }, config: undefined, entry: '@rokucommunity/bslint' },
                { plugin: { name: 'bslint', onSetConfiguration: () => { } }, config: undefined, entry: '@other/bslint' }
            ]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            builder.options.pluginOverrides = { 'bslint': { merge: { foo: 'bar' } } };
            expect(() => builder['loadPlugins']()).to.throw(/ambiguous/i);
        });

        it('hard-fails when a CLI override identifier matches no loaded plugin', () => {
            sinon.stub(util, 'loadPlugins').returns([
                { plugin: { name: 'bslint', onSetConfiguration: () => { } }, config: undefined, entry: 'bslint' }
            ]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir });
            builder.options.pluginOverrides = { 'unknown-plugin': { merge: { foo: 'bar' } } };
            expect(() => builder['loadPlugins']()).to.throw(/did not match any loaded plugin/);
        });

        it('replaces config entirely with a JSONC file via bare --plugin.<id>=<path>', () => {
            const configPath = `${tempDir}/replacement.jsonc`;
            fsExtra.writeFileSync(configPath, `{ "fresh": true }`);
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'my-plugin',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: { stale: true, willGoAway: 1 },
                entry: { src: 'my-plugin' }
            }]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir, cwd: tempDir });
            builder.options.pluginOverrides = { 'my-plugin': { replace: configPath } };
            builder['loadPlugins']();
            expect(receivedConfigs[0]).to.eql({ fresh: true });
        });

        it('replace + merge: applies replace first then deep-merges on top', () => {
            const configPath = `${tempDir}/replacement.jsonc`;
            fsExtra.writeFileSync(configPath, `{ "fresh": true, "enabled": true }`);
            const receivedConfigs: any[] = [];
            sinon.stub(util, 'loadPlugins').returns([{
                plugin: {
                    name: 'my-plugin',
                    onSetConfiguration: (cfg: any) => receivedConfigs.push(cfg)
                },
                config: { stale: true },
                entry: { src: 'my-plugin' }
            }]);
            builder.options = util.normalizeAndResolveConfig({ rootDir: rootDir, cwd: tempDir });
            builder.options.pluginOverrides = { 'my-plugin': { replace: configPath, merge: { enabled: false } } };
            builder['loadPlugins']();
            expect(receivedConfigs[0]).to.eql({ fresh: true, enabled: false });
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
