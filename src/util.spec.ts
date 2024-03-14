import { expect } from './chai-config.spec';
import * as path from 'path';
import util, { standardizePath as s } from './util';
import { Position, Range } from 'vscode-languageserver';
import type { BsConfig } from './BsConfig';
import * as fsExtra from 'fs-extra';
import { createSandbox } from 'sinon';
import { DiagnosticMessages } from './DiagnosticMessages';
import { tempDir, rootDir, expectTypeToBe } from './testHelpers.spec';
import { Program } from './Program';
import type { BsDiagnostic } from './interfaces';
import { TypeChainEntry } from './interfaces';
import { NamespaceType } from './types/NamespaceType';
import { ClassType } from './types/ClassType';
import { ReferenceType } from './types/ReferenceType';
import { SymbolTypeFlag } from './SymbolTypeFlag';
import { BooleanType, DoubleType, DynamicType, FloatType, IntegerType, InvalidType, LongIntegerType, StringType, TypedFunctionType, VoidType } from './types';
import { TokenKind } from './lexer/TokenKind';
import { createToken } from './astUtils/creators';
import { createDottedIdentifier, createVariableExpression } from './astUtils/creators';
import { Parser } from './parser/Parser';
import type { FunctionStatement } from './parser/Statement';
import { ComponentType } from './types/ComponentType';

const sinon = createSandbox();

let cwd = process.cwd();

describe('util', () => {
    beforeEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
    });

    afterEach(() => {
        sinon.restore();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
    });

    describe('fileExists', () => {
        it('returns false when no value is passed', async () => {
            expect(await util.pathExists(undefined)).to.be.false;
        });
    });

    describe('uriToPath', () => {
        it('retains original drive casing for windows', () => {
            expect(util.uriToPath(`file:///C:${path.sep}something`)).to.equal(`C:${path.sep}something`);
            expect(util.uriToPath(`file:///c:${path.sep}something`)).to.equal(`c:${path.sep}something`);
        });
    });

    describe('getAllDottedGetPartsAsString', () => {
        it('returns undefined when no value found', () => {
            expect(
                util.getAllDottedGetPartsAsString(undefined)
            ).to.eql(undefined);
        });

        it('returns var name', () => {
            expect(
                util.getAllDottedGetPartsAsString(createVariableExpression('alpha'))
            ).to.eql('alpha');
        });

        it('returns dotted get name', () => {
            expect(
                util.getAllDottedGetPartsAsString(createDottedIdentifier(['alpha', 'beta']))
            ).to.eql('alpha.beta');
        });
    });

    describe('diagnosticIsSuppressed', () => {
        it('does not crash when diagnostic is missing location information', () => {
            const program = new Program({});
            const file = program.setFile('source/main.brs', '');
            const diagnostic: BsDiagnostic = {
                file: file,
                message: 'crash',
                //important part of the test. range must be missing
                range: undefined as any
            };

            file.commentFlags.push({
                affectedRange: util.createRange(1, 2, 3, 4),
                codes: [1, 2, 3],
                file: file,
                range: util.createRange(1, 2, 3, 4)
            });
            file.diagnostics.push(diagnostic);

            util.diagnosticIsSuppressed(diagnostic);

            //test passes if there's no crash
        });
    });

    describe('sanitizePkgPath', () => {
        it('replaces more than one windows slash in a path', () => {
            expect(util.sanitizePkgPath('source\\folder1\\folder2\\file.brs')).to.eql('pkg:/source/folder1/folder2/file.brs');
        });
    });

    describe('loadConfigFile', () => {
        it('returns undefined when no path is provided', () => {
            expect(util.loadConfigFile(undefined)).to.be.undefined;
        });

        it('returns undefined when the path does not exist', () => {
            expect(util.loadConfigFile(`?${rootDir}/donotexist.json`)).to.be.undefined;
        });

        it('returns proper list of ancestor project paths', () => {
            fsExtra.outputFileSync(s`${rootDir}/child.json`, `{"extends": "parent.json"}`);
            fsExtra.outputFileSync(s`${rootDir}/parent.json`, `{"extends": "grandparent.json"}`);
            fsExtra.outputFileSync(s`${rootDir}/grandparent.json`, `{"extends": "greatgrandparent.json"}`);
            fsExtra.outputFileSync(s`${rootDir}/greatgrandparent.json`, `{}`);
            expect(
                util.loadConfigFile(s`${rootDir}/child.json`)?._ancestors?.map(x => s(x))
            ).to.eql([
                s`${rootDir}/child.json`,
                s`${rootDir}/parent.json`,
                s`${rootDir}/grandparent.json`,
                s`${rootDir}/greatgrandparent.json`
            ]);
        });

        it('returns empty ancestors list for non-extends files', () => {
            fsExtra.outputFileSync(s`${rootDir}/child.json`, `{}`);
            let config = util.loadConfigFile(s`${rootDir}/child.json`);
            expect(
                config?._ancestors?.map(x => s(x))
            ).to.eql([
                s`${rootDir}/child.json`
            ]);
        });

        it('resolves plugins path relatively to config file', () => {
            const config: BsConfig = {
                plugins: [
                    './plugins.js',
                    './scripts/plugins.js',
                    '../scripts/plugins.js',
                    'bsplugin'
                ]
            };
            util.resolvePathsRelativeTo(config, 'plugins', s`${rootDir}/config`);
            expect(config?.plugins?.map(p => (p ? util.pathSepNormalize(p, '/') : undefined))).to.deep.equal([
                `${rootDir}/config/plugins.js`,
                `${rootDir}/config/scripts/plugins.js`,
                `${rootDir}/scripts/plugins.js`,
                'bsplugin'
            ].map(p => util.pathSepNormalize(p, '/')));
        });

        it('removes duplicate plugins and undefined values', () => {
            const config: BsConfig = {
                plugins: [
                    './plugins.js',
                    'bsplugin',
                    '../config/plugins.js',
                    'bsplugin',
                    undefined as any
                ]
            };
            util.resolvePathsRelativeTo(config, 'plugins', s`${process.cwd()}/config`);
            expect(config?.plugins?.map(p => (p ? util.pathSepNormalize(p, '/') : undefined))).to.deep.equal([
                s`${process.cwd()}/config/plugins.js`,
                'bsplugin'
            ].map(p => util.pathSepNormalize(p, '/')));
        });
    });

    describe('getConfigFilePath', () => {
        it('returns undefined when it does not find the file', () => {
            let configFilePath = util.getConfigFilePath(s`${process.cwd()}/testProject/project1`);
            expect(configFilePath).not.to.exist;
        });

        it('returns path to file when found', () => {
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, '');
            expect(
                util.getConfigFilePath(s`${tempDir}/rootDir`)
            ).to.equal(
                s`${tempDir}/rootDir/bsconfig.json`
            );
        });

        it('finds config file in parent directory', () => {
            const bsconfigPath = s`${tempDir}/rootDir/bsconfig.json`;
            fsExtra.outputFileSync(bsconfigPath, '');
            fsExtra.ensureDirSync(`${tempDir}/rootDir/source`);
            expect(
                util.getConfigFilePath(s`${tempDir}/rootDir/source`)
            ).to.equal(
                s`${tempDir}/rootDir/bsconfig.json`
            );
        });

        it('uses cwd when not provided', () => {
            //sanity check
            expect(util.getConfigFilePath()).not.to.exist;

            const rootDir = s`${tempDir}/rootDir`;

            fsExtra.outputFileSync(`${rootDir}/bsconfig.json`, '');

            fsExtra.ensureDirSync(rootDir);
            process.chdir(rootDir);
            try {
                expect(
                    util.getConfigFilePath()
                ).to.equal(
                    s`${rootDir}/bsconfig.json`
                );
            } finally {
                process.chdir(cwd);
            }
        });
    });

    describe('pathSepNormalize', () => {
        it('works for both types of separators', () => {
            expect(util.pathSepNormalize('c:/some\\path', '\\')).to.equal('c:\\some\\path');
            expect(util.pathSepNormalize('c:/some\\path', '/')).to.equal('c:/some/path');
        });
        it('does not throw when given `undefined`', () => {
            expect(undefined).to.be.undefined;
        });
    });

    describe('lowerDrivePath', () => {
        it('forces drive letters to lower case', () => {
            //unix slashes
            expect(util.driveLetterToLower('C:/projects')).to.equal('c:/projects');
            //windows slashes
            expect(util.driveLetterToLower('C:\\projects')).to.equal(('c:\\projects'));
        });
    });

    describe('findClosestConfigFile', () => {
        it('finds config up the chain', async () => {
            const brsFilePath = s`${rootDir}/src/app.brs`;
            const currentDirBsConfigPath = s`${rootDir}/src/bsconfig.json`;
            const currentDirBrsConfigPath = s`${rootDir}/src/brsconfig.json`;
            const parentDirBsConfigPath = s`${rootDir}/bsconfig.json`;
            const parentDirBrsConfigPath = s`${rootDir}/brsconfig.json`;
            fsExtra.outputFileSync(brsFilePath, '');
            fsExtra.outputFileSync(currentDirBsConfigPath, '');
            fsExtra.outputFileSync(currentDirBrsConfigPath, '');
            fsExtra.outputFileSync(parentDirBsConfigPath, '');
            fsExtra.outputFileSync(parentDirBrsConfigPath, '');

            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(currentDirBsConfigPath);
            fsExtra.removeSync(currentDirBsConfigPath);
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(currentDirBrsConfigPath);
            fsExtra.removeSync(currentDirBrsConfigPath);
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(parentDirBsConfigPath);
            fsExtra.removeSync(parentDirBsConfigPath);
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(parentDirBrsConfigPath);
        });

    });

    describe('normalizeAndResolveConfig', () => {
        it('loads project by default', () => {
            fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
                rootDir: s`${cwd}/TEST`
            });
            expect(
                util.normalizeAndResolveConfig({
                    cwd: rootDir
                }).rootDir
            ).to.eql(
                s`${cwd}/TEST`
            );
        });

        it('noproject skips loading the local bsconfig.json', () => {
            fsExtra.outputJsonSync(`${rootDir}/bsconfig.json`, {
                rootDir: s`${cwd}/TEST`
            });
            expect(
                util.normalizeAndResolveConfig({
                    cwd: rootDir,
                    noProject: true
                }).rootDir
            ).to.be.undefined;
        });

        it('throws for missing project file', () => {
            expect(() => {
                util.normalizeAndResolveConfig({ project: 'path/does/not/exist/bsconfig.json' });
            }).to.throw;
        });

        it('does not throw for optional missing', () => {
            expect(() => {
                util.normalizeAndResolveConfig({ project: '?path/does/not/exist/bsconfig.json' });

            }).not.to.throw;
        });

        it('throws for missing extends file', () => {
            try {
                fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, `{ "extends": "path/does/not/exist/bsconfig.json" }`);
                expect(() => {
                    util.normalizeAndResolveConfig({
                        project: s`${rootDir}/bsconfig.json`
                    });
                }).to.throw;
            } finally {
                process.chdir(cwd);
            }
        });

        it('throws for missing extends file', () => {
            fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, `{ "extends": "?path/does/not/exist/bsconfig.json" }`);
            expect(() => {
                util.normalizeAndResolveConfig({
                    project: s`${rootDir}/bsconfig.json`
                });
            }).not.to.throw;
        });
    });

    describe('normalizeConfig', () => {
        it('sets emitDefinitions to false by default and in edge cases', () => {
            expect(util.normalizeConfig({}).emitDefinitions).to.be.false;
            expect((util as any).normalizeConfig().emitDefinitions).to.be.false;
            expect(util.normalizeConfig(<any>{ emitDefinitions: 123 }).emitDefinitions).to.be.false;
            expect(util.normalizeConfig(<any>{ emitDefinitions: undefined }).emitDefinitions).to.be.false;
            expect(util.normalizeConfig(<any>{ emitDefinitions: 'true' }).emitDefinitions).to.be.false;
        });

        it('sets pruneEmptyCodeFiles to false by default, or true if explicitly true', () => {
            expect(util.normalizeConfig({}).pruneEmptyCodeFiles).to.be.false;
            expect(util.normalizeConfig({ pruneEmptyCodeFiles: true }).pruneEmptyCodeFiles).to.be.true;
            expect(util.normalizeConfig({ pruneEmptyCodeFiles: false }).pruneEmptyCodeFiles).to.be.false;
        });

        it('loads project from disc', () => {
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, `{ "outFile": "customOutDir/pkg.zip" }`);
            let config = util.normalizeAndResolveConfig({
                project: s`${tempDir}/rootDir/bsconfig.json`
            });
            expect(
                config.outFile
            ).to.equal(
                s`${tempDir}/rootDir/customOutDir/pkg.zip`
            );
        });

        it('loads project from disc and extends it', () => {
            //the extends file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.base.json`, `{
                "outFile": "customOutDir/pkg1.zip",
                "rootDir": "core"
            }`);

            //the project file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, `{
                "extends": "bsconfig.base.json",
                "watch": true
            }`);

            let config = util.normalizeAndResolveConfig({ project: s`${tempDir}/rootDir/bsconfig.json` });

            expect(config.outFile).to.equal(s`${tempDir}/rootDir/customOutDir/pkg1.zip`);
            expect(config.rootDir).to.equal(s`${tempDir}/rootDir/core`);
            expect(config.watch).to.equal(true);
        });

        it('overrides parent files array with child files array', () => {
            //the parent file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.parent.json`, `{
                "files": ["base.brs"]
            }`);

            //the project file
            fsExtra.outputFileSync(s`${tempDir}/rootDir/bsconfig.json`, `{
                "extends": "bsconfig.parent.json",
                "files": ["child.brs"]
            }`);

            let config = util.normalizeAndResolveConfig({ project: s`${tempDir}/rootDir/bsconfig.json` });

            expect(config.files).to.eql(['child.brs']);
        });

        it('catches circular dependencies', () => {
            fsExtra.outputFileSync(s`${rootDir}/bsconfig.json`, `{
                "extends": "bsconfig2.json"
            }`);
            fsExtra.outputFileSync(s`${rootDir}/bsconfig2.json`, `{
                "extends": "bsconfig.json"
            }`);

            let threw = false;
            try {
                util.normalizeAndResolveConfig({ project: s`${rootDir}/bsconfig.json` });
            } catch (e) {
                threw = true;
            }
            process.chdir(cwd);
            expect(threw).to.equal(true, 'Should have thrown an error');
            //the test passed
        });

        it('properly handles default for watch', () => {
            let config = util.normalizeAndResolveConfig({ watch: true });
            expect(config.watch).to.be.true;
        });

        it('sets default value for bslibDestinationDir', () => {
            expect(util.normalizeConfig(<any>{}).bslibDestinationDir).to.equal('source');
        });

        it('strips leading and/or trailing slashes from bslibDestinationDir', () => {
            ['source/opt', '/source/opt', 'source/opt/', '/source/opt/'].forEach(input => {
                expect(util.normalizeConfig(<any>{ bslibDestinationDir: input }).bslibDestinationDir).to.equal('source/opt');
            });
        });
    });

    describe('areArraysEqual', () => {
        it('finds equal arrays', () => {
            expect(util.areArraysEqual([1, 2], [1, 2])).to.be.true;
            expect(util.areArraysEqual(['cat', 'dog'], ['cat', 'dog'])).to.be.true;
        });
        it('detects non-equal arrays', () => {
            expect(util.areArraysEqual([1, 2], [1])).to.be.false;
            expect(util.areArraysEqual([1, 2], [2])).to.be.false;
            expect(util.areArraysEqual([2], [1])).to.be.false;
            expect(util.areArraysEqual([2], [0])).to.be.false;
            expect(util.areArraysEqual(['cat', 'dog'], ['cat', 'dog', 'mouse'])).to.be.false;
            expect(util.areArraysEqual(['cat', 'dog'], ['dog', 'cat'])).to.be.false;
        });
    });

    describe('getPkgPathFromTarget', () => {
        it('works with both types of separators', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', '../lib.brs')).to.equal('lib.brs');
            expect(util.getPkgPathFromTarget('components\\component1.xml', '../lib.brs')).to.equal('lib.brs');
        });

        it('resolves single dot directory', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', './lib.brs')).to.equal(s`components/lib.brs`);
        });

        it('resolves absolute pkg paths as relative paths', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/source/lib.brs')).to.equal(s`source/lib.brs`);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/lib.brs')).to.equal(`lib.brs`);
        });

        it('resolves gracefully for invalid values', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/')).to.equal(null);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:')).to.equal(null);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg')).to.equal(s`components/pkg`);
        });

        it('supports pkg:/ and libpkg:/', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/source/lib.brs')).to.equal(s`source/lib.brs`);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'libpkg:/source/lib.brs')).to.equal(s`source/lib.brs`);
        });

        it('works case insensitive', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'PKG:/source/lib.brs')).to.equal(s`source/lib.brs`);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'LIBPKG:/source/lib.brs')).to.equal(s`source/lib.brs`);
        });
    });

    describe('getRelativePath', () => {
        it('works when both files are at the root', () => {
            expect(util.getRelativePath('file.xml', 'file.brs')).to.equal('file.brs');
        });
        it('works when both files are in subfolder', () => {
            expect(util.getRelativePath('sub/file.xml', 'sub/file.brs')).to.equal('file.brs');
        });
        it('works when source in root, target in subdir', () => {
            expect(util.getRelativePath('file.xml', 'sub/file.brs')).to.equal(s`sub/file.brs`);
        });
        it('works when source in sub, target in root', () => {
            expect(util.getRelativePath('sub/file.xml', 'file.brs')).to.equal(s`../file.brs`);
        });
        it('works when source and target are in different subs', () => {
            expect(util.getRelativePath('sub1/file.xml', 'sub2/file.brs')).to.equal(s`../sub2/file.brs`);
        });
    });

    describe('padLeft', () => {
        it('stops at an upper limit to prevent terrible memory explosions', () => {
            expect(util.padLeft('', Number.MAX_VALUE, ' ')).to.be.lengthOf(1000);
        });
    });

    describe('getTextForRange', () => {
        const testArray = ['The quick', 'brown fox', 'jumps over', 'the lazy dog'];
        const testString = testArray.join('\n');
        it('should work if string is passed in', () => {
            const result = util.getTextForRange(testString, Range.create(0, 0, 1, 5));
            expect(result).to.equal('The quick\nbrown');
        });

        it('should work if array is passed in', () => {
            const result = util.getTextForRange(testArray, Range.create(0, 0, 1, 5));
            expect(result).to.equal('The quick\nbrown');
        });

        it('should work if start and end are on the same line', () => {
            const result = util.getTextForRange(testArray, Range.create(0, 4, 0, 7));
            expect(result).to.equal('qui');
        });
    });

    describe('comparePositionToRange', () => {
        it('does not crash on undefined props', () => {
            expect(
                util.comparePositionToRange(undefined, util.createRange(0, 0, 0, 0))
            ).to.eql(0);
            expect(
                util.comparePositionToRange(util.createPosition(1, 1), undefined)
            ).to.eql(0);
        });

        it('correctly compares positions to ranges with one line range line', () => {
            let range = Range.create(1, 10, 1, 15);
            expect(util.comparePositionToRange(Position.create(0, 13), range)).to.equal(-1);
            expect(util.comparePositionToRange(Position.create(1, 1), range)).to.equal(-1);
            expect(util.comparePositionToRange(Position.create(1, 9), range)).to.equal(-1);
            expect(util.comparePositionToRange(Position.create(1, 10), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(1, 13), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(1, 15), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(1, 16), range)).to.equal(1);
            expect(util.comparePositionToRange(Position.create(2, 10), range)).to.equal(1);
        });
        it('correctly compares positions to ranges with multiline range', () => {
            let range = Range.create(1, 10, 3, 15);
            expect(util.comparePositionToRange(Position.create(0, 13), range)).to.equal(-1);
            expect(util.comparePositionToRange(Position.create(1, 1), range)).to.equal(-1);
            expect(util.comparePositionToRange(Position.create(1, 9), range)).to.equal(-1);
            expect(util.comparePositionToRange(Position.create(1, 10), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(1, 13), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(1, 15), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(2, 0), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(2, 10), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(2, 13), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(3, 0), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(3, 10), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(3, 13), range)).to.equal(0);
            expect(util.comparePositionToRange(Position.create(3, 16), range)).to.equal(1);
            expect(util.comparePositionToRange(Position.create(4, 10), range)).to.equal(1);
        });
    });
    describe('getExtension', () => {
        it('handles edge cases', () => {
            expect(util.getExtension('main.bs')).to.eql('.bs');
            expect(util.getExtension('main.brs')).to.eql('.brs');
            expect(util.getExtension('main.spec.bs')).to.eql('.bs');
            expect(util.getExtension('main.d.bs')).to.eql('.d.bs');
            expect(util.getExtension('main.xml')).to.eql('.xml');
            expect(util.getExtension('main.component.xml')).to.eql('.xml');
        });
    });

    describe('loadPlugins', () => {

        let pluginPath: string;
        let id = 1;

        beforeEach(() => {
            // `require` caches plugins, so  generate a unique plugin name for every test
            pluginPath = `${tempDir}/plugin${id++}.js`;
        });

        it('shows warning when loading plugin with old "object" format', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports = {
                    name: 'AwesomePlugin'
                };
            `);
            const stub = sinon.stub(console, 'warn').callThrough();
            const plugins = util.loadPlugins(cwd, [pluginPath]);
            expect(plugins[0].name).to.eql('AwesomePlugin');
            expect(stub.callCount).to.equal(1);
        });

        it('shows warning when loading plugin with old "object" format and exports.default', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports.default = {
                    name: 'AwesomePlugin'
                };
            `);
            const stub = sinon.stub(console, 'warn').callThrough();
            const plugins = util.loadPlugins(cwd, [pluginPath]);
            expect(plugins[0].name).to.eql('AwesomePlugin');
            expect(stub.callCount).to.equal(1);
        });

        it('loads plugin with factory pattern', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports = function() {
                    return {
                        name: 'AwesomePlugin'
                    };
                };
            `);
            const stub = sinon.stub(console, 'warn').callThrough();
            const plugins = util.loadPlugins(cwd, [pluginPath]);
            expect(plugins[0].name).to.eql('AwesomePlugin');
            //does not warn about factory pattern
            expect(stub.callCount).to.equal(0);
        });

        it('loads plugin with factory pattern and `default`', () => {
            fsExtra.writeFileSync(pluginPath, `
                module.exports.default = function() {
                    return {
                        name: 'AwesomePlugin'
                    };
                };
            `);
            const stub = sinon.stub(console, 'warn').callThrough();
            const plugins = util.loadPlugins(cwd, [pluginPath]);
            expect(plugins[0].name).to.eql('AwesomePlugin');
            //does not warn about factory pattern
            expect(stub.callCount).to.equal(0);
        });
    });

    describe('rangesIntersect', () => {
        it('does not crash on undefined range', () => {
            expect(
                util.rangesIntersect(undefined, util.createRange(0, 0, 0, 0))
            ).to.be.false;
            expect(
                util.rangesIntersect(util.createRange(0, 0, 0, 0), undefined)
            ).to.be.false;
        });

        it('does not match when ranges do not touch (a < b)', () => {
            // AA BB
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 0, 0, 1),
                util.createRange(0, 2, 0, 3)
            )).to.be.false;
        });

        it('does not match when ranges do not touch (a < b)', () => {
            // BB AA
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 2, 0, 3),
                util.createRange(0, 0, 0, 1)
            )).to.be.false;
        });

        it('does not match when ranges touch at right edge', () => {
            // AABB
            expect(util.rangesIntersect(
                util.createRange(0, 0, 0, 1),
                util.createRange(0, 1, 0, 2)
            )).to.be.false;
        });

        it('does not match when ranges touch at left edge', () => {
            // BBAA
            expect(util.rangesIntersect(
                util.createRange(0, 1, 0, 2),
                util.createRange(0, 0, 0, 1)
            )).to.be.false;
        });

        it('matches when range overlaps by single character on the right', () => {
            // A BA B
            expect(util.rangesIntersect(
                util.createRange(0, 1, 0, 3),
                util.createRange(0, 2, 0, 4)
            )).to.be.true;
        });

        it('matches when range overlaps by single character on the left', () => {
            // B AB A
            expect(util.rangesIntersect(
                util.createRange(0, 2, 0, 4),
                util.createRange(0, 1, 0, 3)
            )).to.be.true;
        });

        it('matches when A is contained by B at the edges', () => {
            // B AA B
            expect(util.rangesIntersect(
                util.createRange(0, 2, 0, 3),
                util.createRange(0, 1, 0, 4)
            )).to.be.true;
        });

        it('matches when B is contained by A at the edges', () => {
            // A BB A
            expect(util.rangesIntersect(
                util.createRange(0, 1, 0, 4),
                util.createRange(0, 2, 0, 3)
            )).to.be.true;
        });

        it('matches when A and B are identical', () => {
            // ABBA
            expect(util.rangesIntersect(
                util.createRange(0, 1, 0, 2),
                util.createRange(0, 1, 0, 2)
            )).to.be.true;
        });

        it('matches when A spans multiple lines', () => {
            // ABBA
            expect(util.rangesIntersect(
                util.createRange(0, 1, 2, 0),
                util.createRange(0, 1, 0, 3)
            )).to.be.true;
        });

        it('matches when B spans multiple lines', () => {
            // ABBA
            expect(util.rangesIntersect(
                util.createRange(0, 1, 0, 3),
                util.createRange(0, 1, 2, 0)
            )).to.be.true;
        });
    });

    describe('rangesIntersectOrTouch', () => {
        it('does not crash on undefined range', () => {
            expect(
                util.rangesIntersectOrTouch(undefined, util.createRange(0, 0, 0, 0))
            ).to.be.false;
            expect(
                util.rangesIntersectOrTouch(util.createRange(0, 0, 0, 0), undefined)
            ).to.be.false;
        });

        it('does not match when ranges do not touch (a < b)', () => {
            // AA BB
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 0, 0, 1),
                util.createRange(0, 2, 0, 3)
            )).to.be.false;
        });

        it('does not match when ranges do not touch (a < b)', () => {
            // BB AA
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 2, 0, 3),
                util.createRange(0, 0, 0, 1)
            )).to.be.false;
        });

        it('matches when ranges touch at right edge', () => {
            // AABB
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 0, 0, 1),
                util.createRange(0, 1, 0, 2)
            )).to.be.true;
        });

        it('matches when ranges touch at left edge', () => {
            // BBAA
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 1, 0, 2),
                util.createRange(0, 0, 0, 1)
            )).to.be.true;
        });

        it('matches when range overlaps by single character on the right', () => {
            // A BA B
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 1, 0, 3),
                util.createRange(0, 2, 0, 4)
            )).to.be.true;
        });

        it('matches when range overlaps by single character on the left', () => {
            // B AB A
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 2, 0, 4),
                util.createRange(0, 1, 0, 3)
            )).to.be.true;
        });

        it('matches when A is contained by B at the edges', () => {
            // B AA B
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 2, 0, 3),
                util.createRange(0, 1, 0, 4)
            )).to.be.true;
        });

        it('matches when B is contained by A at the edges', () => {
            // A BB A
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 1, 0, 4),
                util.createRange(0, 2, 0, 3)
            )).to.be.true;
        });

        it('matches when A and B are identical', () => {
            // ABBA
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 1, 0, 2),
                util.createRange(0, 1, 0, 2)
            )).to.be.true;
        });

        it('matches when A spans multiple lines', () => {
            // ABBA
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 1, 2, 0),
                util.createRange(0, 1, 0, 3)
            )).to.be.true;
        });

        it('matches when B spans multiple lines', () => {
            // ABBA
            expect(util.rangesIntersectOrTouch(
                util.createRange(0, 1, 0, 3),
                util.createRange(0, 1, 2, 0)
            )).to.be.true;
        });
    });

    it('sortByRange', () => {
        const front = {
            range: util.createRange(1, 1, 1, 2)
        };
        const middle = {
            range: util.createRange(1, 3, 1, 4)
        };
        const back = {
            range: util.createRange(1, 5, 1, 6)
        };
        expect(
            util.sortByRange([middle, front, back])
        ).to.eql([
            front, middle, back
        ]);
    });

    describe('splitWithLocation', () => {
        it('works with no split items', () => {
            expect(
                util.splitGetRange('.', 'hello', util.createRange(2, 10, 2, 15))
            ).to.eql([{
                text: 'hello',
                range: util.createRange(2, 10, 2, 15)
            }]);
        });

        it('handles empty chunks', () => {
            expect(
                util.splitGetRange('l', 'hello', util.createRange(2, 10, 2, 15))
            ).to.eql([{
                text: 'he',
                range: util.createRange(2, 10, 2, 12)
            }, {
                text: 'o',
                range: util.createRange(2, 14, 2, 15)
            }]);
        });

        it('handles multiple non-empty chunks', () => {
            expect(
                util.splitGetRange('.', 'abc.d.efgh.i', util.createRange(2, 10, 2, 2))
            ).to.eql([{
                text: 'abc',
                range: util.createRange(2, 10, 2, 13)
            }, {
                text: 'd',
                range: util.createRange(2, 14, 2, 15)
            }, {
                text: 'efgh',
                range: util.createRange(2, 16, 2, 20)
            }, {
                text: 'i',
                range: util.createRange(2, 21, 2, 22)
            }]);
        });
    });

    describe('toDiagnostic', () => {
        it('uses a uri on relatedInfo missing location', () => {
            expect(
                util.toDiagnostic({
                    ...DiagnosticMessages.cannotFindName('someVar'),
                    file: undefined as any,
                    range: util.createRange(1, 2, 3, 4),
                    relatedInformation: [{
                        message: 'Alpha',
                        location: undefined as any
                    }]
                }, 'u/r/i').relatedInformation
            ).to.eql([{
                message: 'Alpha',
                location: util.createLocation(
                    'u/r/i', util.createRange(1, 2, 3, 4)
                )
            }]);
        });

        it('eliminates diagnostics with relatedInformation that are missing a uri', () => {
            expect(
                util.toDiagnostic({
                    ...DiagnosticMessages.cannotFindName('someVar'),
                    file: undefined as any,
                    range: util.createRange(1, 2, 3, 4),
                    relatedInformation: [{
                        message: 'Alpha',
                        location: util.createLocation(
                            'uri', util.createRange(2, 3, 4, 5)
                        )
                    }, {
                        message: 'Beta',
                        location: undefined as any
                    }]
                }, undefined as any).relatedInformation
            ).to.eql([{
                message: 'Alpha',
                location: util.createLocation(
                    'uri', util.createRange(2, 3, 4, 5)
                )
            }]);
        });
    });
    describe('processTypeChain', () => {
        it('should  find the correct details in a list of type resolutions', () => {
            const chain = [
                new TypeChainEntry({ name: 'AlphaNamespace', type: new NamespaceType('Alpha'), data: { flags: SymbolTypeFlag.runtime }, range: util.createRange(1, 1, 2, 2) }),
                new TypeChainEntry({ name: 'BetaProp', type: new ClassType('Beta'), data: { flags: SymbolTypeFlag.runtime }, range: util.createRange(2, 2, 3, 3) }),
                new TypeChainEntry({ name: 'CharlieProp', type: new ReferenceType('Charlie', 'Alpha.Beta.CharlieProp', SymbolTypeFlag.runtime, () => null), data: { flags: SymbolTypeFlag.runtime }, range: util.createRange(3, 3, 4, 4) })
            ];

            const result = util.processTypeChain(chain);
            expect(result.itemName).to.eql('CharlieProp');
            expect(result.fullChainName).to.eql('AlphaNamespace.BetaProp.CharlieProp');
            expect(result.itemParentTypeName).to.eql('Beta');
            expect(result.fullNameOfItem).to.eql('Beta.CharlieProp');
            expect(result.range).to.eql(util.createRange(3, 3, 4, 4));
        });

        it('respects the separatorToken', () => {
            const chain = [
                new TypeChainEntry({ name: 'roSGNodeCustom', type: new ComponentType('Custom'), data: { flags: SymbolTypeFlag.runtime }, range: util.createRange(1, 1, 2, 2) }),
                new TypeChainEntry({ name: 'someCallFunc', type: new TypedFunctionType(VoidType.instance), data: { flags: SymbolTypeFlag.runtime }, range: util.createRange(2, 2, 3, 3), separatorToken: createToken(TokenKind.Callfunc) })
            ];

            const result = util.processTypeChain(chain);
            expect(result.fullChainName).to.eql('roSGNodeCustom@.someCallFunc');
        });
    });

    describe('binaryOperatorResultType', () => {
        it('returns the correct type for math operations', () => {
            // String + String is string
            expectTypeToBe(util.binaryOperatorResultType(StringType.instance, createToken(TokenKind.Plus), StringType.instance), StringType);
            // string plus anything else is an error - return dynamic
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Plus), StringType.instance), DynamicType);

            // Plus
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Plus), IntegerType.instance), DoubleType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Plus), FloatType.instance), FloatType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Plus), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Plus), IntegerType.instance), IntegerType);
            // Subtract
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Minus), IntegerType.instance), DoubleType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Minus), FloatType.instance), FloatType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Minus), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Minus), IntegerType.instance), IntegerType);
            // Multiply
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Star), IntegerType.instance), DoubleType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Star), FloatType.instance), FloatType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Star), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Star), IntegerType.instance), IntegerType);
            // Mod
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Mod), IntegerType.instance), DoubleType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Mod), FloatType.instance), FloatType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Mod), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Mod), IntegerType.instance), IntegerType);
            // Divide
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Forwardslash), IntegerType.instance), DoubleType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Forwardslash), FloatType.instance), FloatType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Forwardslash), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Forwardslash), IntegerType.instance), FloatType); // int/int -> float
            // Exponent
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Caret), IntegerType.instance), DoubleType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Caret), FloatType.instance), FloatType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Caret), LongIntegerType.instance), DoubleType);// long^int -> Double, int^long -> Double
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Caret), IntegerType.instance), IntegerType);
        });

        it('returns the correct type for Bitshift operations', () => {
            // <<
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.LeftShift), IntegerType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.LeftShift), FloatType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.LeftShift), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.LeftShift), IntegerType.instance), IntegerType);
            // >>
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.RightShift), IntegerType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.RightShift), FloatType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.RightShift), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.RightShift), IntegerType.instance), IntegerType);
        });

        it('returns the correct type for Comparison operations', () => {
            // =
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Equal), IntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Equal), FloatType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Equal), LongIntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Equal), IntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(InvalidType.instance, createToken(TokenKind.Equal), IntegerType.instance), BooleanType); // = accepts invalid
            expectTypeToBe(util.binaryOperatorResultType(StringType.instance, createToken(TokenKind.Equal), IntegerType.instance), DynamicType); // only one string is not accepted
            expectTypeToBe(util.binaryOperatorResultType(StringType.instance, createToken(TokenKind.Equal), StringType.instance), BooleanType); // both strings is accepted
            // <>
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.LessGreater), InvalidType.instance), BooleanType); // <> accepts invalid
            // > - does not accept invalid
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Greater), IntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Greater), FloatType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Greater), LongIntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Greater), IntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(InvalidType.instance, createToken(TokenKind.Greater), IntegerType.instance), DynamicType);
            // etc. - all should be boolean
        });

        it('returns the correct type for Logical/bitwise operations', () => {
            // and
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.And), IntegerType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.And), FloatType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.And), BooleanType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(BooleanType.instance, createToken(TokenKind.And), IntegerType.instance), BooleanType);
            expectTypeToBe(util.binaryOperatorResultType(InvalidType.instance, createToken(TokenKind.And), IntegerType.instance), DynamicType); // invalid not accepted
            expectTypeToBe(util.binaryOperatorResultType(StringType.instance, createToken(TokenKind.And), IntegerType.instance), DynamicType); // strings are not accepted
            // or
            expectTypeToBe(util.binaryOperatorResultType(DoubleType.instance, createToken(TokenKind.Or), IntegerType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Or), FloatType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Or), LongIntegerType.instance), LongIntegerType);
            expectTypeToBe(util.binaryOperatorResultType(IntegerType.instance, createToken(TokenKind.Or), IntegerType.instance), IntegerType);
            expectTypeToBe(util.binaryOperatorResultType(InvalidType.instance, createToken(TokenKind.Or), IntegerType.instance), DynamicType);
        });
    });

    describe('unaryOperatorResultType', () => {
        it('returns the correct type for minus operation', () => {
            let minus = createToken(TokenKind.Minus);
            expectTypeToBe(util.unaryOperatorResultType(minus, IntegerType.instance), IntegerType);
            expectTypeToBe(util.unaryOperatorResultType(minus, FloatType.instance), FloatType);
            expectTypeToBe(util.unaryOperatorResultType(minus, BooleanType.instance), DynamicType);
            expectTypeToBe(util.unaryOperatorResultType(minus, DoubleType.instance), DoubleType);
            expectTypeToBe(util.unaryOperatorResultType(minus, StringType.instance), DynamicType);
        });

        describe('unaryOperatorResultType', () => {
            it('returns the correct type for not operation', () => {
                let notToken = createToken(TokenKind.Not);
                expectTypeToBe(util.unaryOperatorResultType(notToken, IntegerType.instance), IntegerType);
                expectTypeToBe(util.unaryOperatorResultType(notToken, FloatType.instance), IntegerType);
                expectTypeToBe(util.unaryOperatorResultType(notToken, BooleanType.instance), BooleanType);
                expectTypeToBe(util.unaryOperatorResultType(notToken, DoubleType.instance), IntegerType);
                expectTypeToBe(util.unaryOperatorResultType(notToken, StringType.instance), DynamicType);
                expectTypeToBe(util.unaryOperatorResultType(notToken, LongIntegerType.instance), LongIntegerType);
            });
        });
    });

    describe('getTokenDocumentation', () => {
        it('should return a string of the comment', () => {
            const { statements } = Parser.parse(`
                ' This is a comment.
                ' it has two lines
                function getOne() as integer
                    return 1
                end function
            `);
            const func = (statements[0] as FunctionStatement).func;
            const docs = util.getTokenDocumentation(func);
            expect(docs).to.eql('This is a comment.\nit has two lines');
        });

        it('should pay attention to @param, @return, etc. (jsdoc tags)', () => {
            const { statements } = Parser.parse(`
                ' Add 1 to a number
                '
                ' @public
                ' @param {integer} the number to add to
                ' @return {integer} the result
                function addOne(num as integer) as integer
                    return num + 1
                end function
            `);
            const func = (statements[0] as FunctionStatement).func;
            const docs = util.getTokenDocumentation(func);
            expect(docs).to.eql('Add 1 to a number\n\n\n_@public_\n\n_@param_ {integer} the number to add to\n\n_@return_ {integer} the result');
        });


        it('only includes comments directly above token', () => {
            const { statements } = Parser.parse(`
                const abc = "ABC" ' comment at end of line

                ' plus one
                function addOne(num as integer) as integer
                    return num + 1
                end function
            `);
            const func = (statements[1] as FunctionStatement).func;
            const docs = util.getNodeDocumentation(func);
            expect(docs).to.eql('plus one');
        });

        it('allows jsdoc style comment blocks', () => {
            const { statements } = Parser.parse(`
                ' /**
                '  plus one
                ' */
                function addOne(num as integer) as integer
                    return num + 1
                end function
            `);
            const func = (statements[0] as FunctionStatement).func;
            const docs = util.getNodeDocumentation(func);
            expect(docs).to.eql('plus one');
        });

        it('allows jsdoc style comment blocks with leading *', () => {
            const { statements } = Parser.parse(`
                ' /**
                '  * plus one
                '  */
                function addOne(num as integer) as integer
                    return num + 1
                end function
            `);
            const func = (statements[0] as FunctionStatement).func;
            const docs = util.getNodeDocumentation(func);
            expect(docs).to.eql('plus one');
        });
    });

    describe('truncate', () => {
        const items = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

        it('returns whole string when under the limit', () => {
            expect(
                util.truncate({
                    leadingText: 'We have numbers: ',
                    items: items,
                    partBuilder: (item) => item,
                    maxLength: 1000
                })
            ).to.eql(
                'We have numbers: ' + items.join(', ')
            );
        });

        it('truncates to max length', () => {
            expect(
                util.truncate({
                    leadingText: 'We have numbers: ',
                    items: items,
                    partBuilder: (item) => item,
                    maxLength: 50
                })
            ).to.eql(
                'We have numbers: one, two, three, ...and 17 more'
            );
        });

        it('shows at least 2 items, even if going over the length', () => {
            expect(
                util.truncate({
                    leadingText: 'We have numbers: ',
                    items: items,
                    partBuilder: (item) => item,
                    maxLength: 30
                })
            ).to.eql(
                'We have numbers: one, two, ...and 18 more'
            );
        });

        it('Accounts for extra wrapping around items', () => {
            expect(
                util.truncate({
                    leadingText: 'We have numbers: ',
                    items: items,
                    partBuilder: (item) => `--${item}--`,
                    maxLength: 60
                })
            ).to.eql(
                'We have numbers: --one--, --two--, --three--, ...and 17 more'
            );
        });

        it('includes trailing text', () => {
            expect(
                util.truncate({
                    leadingText: 'We have numbers: ',
                    trailingText: '!',
                    items: items,
                    partBuilder: (item) => item,
                    maxLength: 50
                })
            ).to.eql(
                'We have numbers: one, two, three, ...and 17 more!'
            );
        });
    });
});
