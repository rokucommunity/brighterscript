import { expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';

import util from './util';
import { Range } from 'vscode-languageserver';

//shorthand for normalizing a path
let n = path.normalize;
let sinon = sinonImport.createSandbox();
let cwd = process.cwd();
let rootConfigPath = path.join(process.cwd(), 'bsconfig.json');
let rootConfigDir = path.dirname(rootConfigPath);
let vfs = {};
function addFile(relativeFilePath: string, fileContents?: string) {
    let absFilePath = n(`${cwd}/${relativeFilePath}`);
    vfs[absFilePath] = fileContents || '';
    return absFilePath;
}

describe('util', () => {
    beforeEach(() => {
        vfs = {};
        sinon.stub(util, 'getFileContents').callsFake((filePath) => {
            if (vfs[filePath]) {
                return vfs[filePath];
            } else {
                throw new Error('Cannot find file ' + filePath);
            }
        });
    });

    afterEach(() => {
        sinon.restore();
        //restore current working directory
        process.chdir(cwd);
    });

    describe('uriToPath', () => {
        it('retains original drive casing for windows', () => {
            expect(util.uriToPath(`file:///C:\\something`)).to.equal('C:\\something');
            expect(util.uriToPath(`file:///C:\\something`)).to.equal('C:\\something');
        });
    });

    describe('loadConfigFile', () => {
        it('returns proper list of ancestor project paths', async () => {
            vfs[n(`${cwd}/child.json`)] = `{"extends": "parent.json"}`;
            vfs[n(`${cwd}/parent.json`)] = `{"extends": "grandparent.json"}`;
            vfs[n(`${cwd}/grandparent.json`)] = `{"extends": "greatgrandparent.json"}`;
            vfs[n(`${cwd}/greatgrandparent.json`)] = `{}`;
            let config = await util.loadConfigFile('child.json');
            expect(config._ancestors).to.eql([n(`${cwd}/child.json`), n(`${cwd}/parent.json`), n(`${cwd}/grandparent.json`), n(`${cwd}/greatgrandparent.json`)]);
        });

        it('returns empty ancestors list for non-extends files', async () => {
            vfs[n(`${cwd}/child.json`)] = `{}`;
            let config = await util.loadConfigFile('child.json');
            expect(config._ancestors).to.eql([n(`${cwd}/child.json`)]);
        });
    });

    describe('getConfigFilePath', () => {
        it('returns undefined when it does not find the file', async () => {
            let configFilePath = await util.getConfigFilePath(path.join(process.cwd(), 'testProjects', 'project1'));
            expect(configFilePath).not.to.exist;
        });

        it('returns path to file when found', async () => {
            let rootDir = path.join(cwd, 'testProjects', 'project2');
            let configFilePath = await util.getConfigFilePath(rootDir);
            expect(configFilePath).to.equal(path.join(rootDir, 'bsconfig.json'));
        });

        it('finds config file in parent directory', async () => {
            let configFilePath = await util.getConfigFilePath(path.join(cwd, 'testProjects', 'project2', 'source'));
            expect(configFilePath).to.equal(path.join(cwd, 'testProjects', 'project2', 'bsconfig.json'));
        });

        it('uses cwd when not provided', async () => {
            //sanity check
            expect(await util.getConfigFilePath()).not.to.exist;

            addFile('testProjects/project2/bsconfig.json');

            let rootDir = path.join(cwd, 'testProjects', 'project2');
            process.chdir(rootDir);
            expect(await util.getConfigFilePath()).to.equal(path.join(rootDir, 'bsconfig.json'));
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
        beforeEach(() => {
            sinon.stub(util, 'fileExists').callsFake(async (filePath) => {
                return Promise.resolve(
                    Object.keys(vfs).includes(filePath)
                );
            });
        });

        it('finds config up the chain', async () => {
            let brsFilePath = addFile('src/app.brs');
            let currentDirBsConfigPath = addFile('src/bsconfig.json');
            let currentDirBrsConfigPath = addFile('src/brsconfig.json');
            let parentDirBsConfigPath = addFile('bsconfig.json');
            let parentDirBrsConfigPath = addFile('brsconfig.json');

            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(currentDirBsConfigPath);
            delete vfs[currentDirBsConfigPath];
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(currentDirBrsConfigPath);
            delete vfs[currentDirBrsConfigPath];
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(parentDirBsConfigPath);
            delete vfs[parentDirBsConfigPath];
            expect(await util.findClosestConfigFile(brsFilePath)).to.equal(parentDirBrsConfigPath);
        });

    });

    describe('normalizeConfig', () => {
        it('loads project from disc', async () => {
            vfs[rootConfigPath] = `{"outFile": "customOutDir/pkg.zip"}`;
            let config = await util.normalizeAndResolveConfig({ project: rootConfigPath });
            expect(config.outFile).to.equal(path.join(path.dirname(rootConfigPath), 'customOutDir', 'pkg.zip'));
        });

        it('loads project from disc and extends it', async () => {
            //the extends file
            let extendsConfigPath = path.join(rootConfigDir, 'testProjects', 'base_bsconfig.json');
            vfs[extendsConfigPath] = `{
                "outFile": "customOutDir/pkg1.zip",
                "rootDir": "core"
            }`;

            //the project file
            vfs[rootConfigPath] = `{
                "extends": "testProjects/base_bsconfig.json",
                "watch": true
            }`;

            let config = await util.normalizeAndResolveConfig({ project: rootConfigPath });

            expect(config.outFile).to.equal(path.join(rootConfigDir, 'testProjects', 'customOutDir', 'pkg1.zip'));
            expect(config.rootDir).to.equal(path.join(rootConfigDir, 'testProjects', 'core'));
            expect(config.watch).to.equal(true);
        });

        it('overrides parent files array with child files array', async () => {
            //the parent file
            let extendsConfigPath = path.join(rootConfigDir, 'testProjects', 'parent.bsconfig.json');
            vfs[extendsConfigPath] = `{
                "files": ["base.brs"]
            }`;

            //the project file
            vfs[rootConfigPath] = `{
                "extends": "testProjects/parent.bsconfig.json",
                "files": ["child.brs"]
            }`;

            let config = await util.normalizeAndResolveConfig({ project: rootConfigPath });

            expect(config.files).to.eql(['child.brs']);
        });

        it('catches circular dependencies', async () => {
            vfs[rootConfigPath] = `{
                "extends": "bsconfig2.json"
            }`;
            vfs[path.join(rootConfigDir, 'bsconfig2.json')] = `{
                "extends": "bsconfig.json"
            }`;

            let threw = false;
            try {
                await util.normalizeAndResolveConfig({ project: rootConfigPath });
            } catch (e) {
                threw = true;
            }
            expect(threw).to.equal(true, 'Should have thrown an error');
            //the test passed
        });

        it('properly handles default for watch', async () => {
            let config = await util.normalizeAndResolveConfig({ watch: true });
            expect(config.watch).to.be.true;
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

    describe('stringFormat', () => {
        it('handles out-of-order replacements', () => {
            expect(util.stringFormat('{1}{0}', 'b', 'a')).to.equal('ab');
        });

        it('does not fail on arguments not provided', () => {
            expect(util.stringFormat('{0}{1}', 'a')).to.equal('a{1}');
        });

    });

    describe('getPkgPathFromTarget', () => {
        it('works with both types of separators', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', '../lib.brs')).to.equal('lib.brs');
            expect(util.getPkgPathFromTarget('components\\component1.xml', '../lib.brs')).to.equal('lib.brs');
        });

        it('resolves single dot directory', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', './lib.brs')).to.equal(n(`components/lib.brs`));
        });

        it('resolves absolute pkg paths as relative paths', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/source/lib.brs')).to.equal(n(`source/lib.brs`));
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/lib.brs')).to.equal(`lib.brs`);
        });

        it('resolves gracefully for invalid values', () => {
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:/')).to.equal(null);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg:')).to.equal(null);
            expect(util.getPkgPathFromTarget('components/component1.xml', 'pkg')).to.equal(n(`components/pkg`));
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
            expect(util.getRelativePath('file.xml', 'sub/file.brs')).to.equal(n(`sub/file.brs`));
        });
        it('works when source in sub, target in root', () => {
            expect(util.getRelativePath('sub/file.xml', 'file.brs')).to.equal(n(`../file.brs`));
        });
        it('works when source and target are in different subs', () => {
            expect(util.getRelativePath('sub1/file.xml', 'sub2/file.brs')).to.equal(n(`../sub2/file.brs`));
        });
    });

    describe('findAllDeep', () => {
        class Person {
            constructor(
                public name: string,
                public parent?: Person
            ) {
            }
        }
        it('finds all properties deep', () => {
            let grandpa = new Person('grandpa');
            let dad = new Person('dad', grandpa);
            let me = new Person('me', dad);
            let people = util.findAllDeep(me, (x) => x instanceof Person);
            expect(people[0]).to.deep.include({ key: undefined, value: me });
            expect(people[1]).to.deep.include({ key: 'parent', value: dad });
            expect(people[2]).to.deep.include({ key: 'parent.parent', value: grandpa });
        });

        it('finds properties in arrays', () => {
            let results = util.findAllDeep<{ id: number }>({
                children: [{
                    id: 1,
                    name: 'bob',
                    children: [{
                        id: 2,
                        name: 'john'
                    }, {
                        id: 3,
                        name: 'bob'
                    }]
                }, {
                    id: 4,
                    name: 'bob'
                }]
            }, (x) => {
                return x.name === 'bob';
            });

            expect(results[0].key).to.eql('children.0');
            expect(results[0].value.id).to.eql(1);

            expect(results[1].key).to.eql('children.0.children.1');
            expect(results[1].value.id).to.eql(3);

            expect(results[2].key).to.eql('children.1');
            expect(results[2].value.id).to.eql(4);
        });

        it('prevents recursive infinite loop', () => {
            let objA = { name: 'a', sibling: undefined };
            let objB = { name: 'b', sibling: objA };
            objA.sibling = objB;
            expect(
                util.findAllDeep<any>(objA, x => ['a', 'b'].includes(x.name)).map(x => x.value.name)
            ).to.eql([
                'a',
                'b'
            ]);
        });
    });

    describe('padLeft', () => {
        it('stops at an upper limit to prevent terrible memory explosions', () => {
            expect(util.padLeft('', Number.MAX_VALUE, ' ')).to.be.lengthOf(1000);
        });
    });

    describe('tokenizeByWhitespace', () => {
        it('works with single chars', () => {
            expect(util.tokenizeByWhitespace('a b c')).to.deep.equal([{
                startIndex: 0,
                text: 'a'
            }, {
                startIndex: 2,
                text: 'b'
            },
            {
                startIndex: 4,
                text: 'c'
            }]);
        });

        it('works with tabs', () => {
            expect(util.tokenizeByWhitespace('a\tb\t c')).to.deep.equal([{
                startIndex: 0,
                text: 'a'
            }, {
                startIndex: 2,
                text: 'b'
            },
            {
                startIndex: 5,
                text: 'c'
            }]);

            it('works with leading whitespace', () => {
                expect(util.tokenizeByWhitespace('  \ta\tb\t c')).to.deep.equal([{
                    startIndex: 4,
                    text: 'a'
                }, {
                    startIndex: 6,
                    text: 'b'
                },
                {
                    startIndex: 9,
                    text: 'c'
                }]);
            });

            it('works with multiple characters in a word', () => {
                expect(util.tokenizeByWhitespace('abc 123')).to.deep.equal([{
                    startIndex: 0,
                    text: 'abc'
                }, {
                    startIndex: 4,
                    text: '123'
                }]);
            });
        });
    });

    describe('getDiagnosticSquiggly', () => {
        it('works for normal cases', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 4)
            }, 'asdf')).to.equal('~~~~');
        });

        it('highlights whole line if no range', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
            }, ' asdf ')).to.equal('~~~~~~');
        });

        it('returns empty string when no line is found', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, '')).to.equal('');

            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, undefined)).to.equal('');
        });

        it('supports diagnostic not at start of line', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 6)
            }, '  asdf')).to.equal('  ~~~~');
        });

        it('supports diagnostic that does not finish at end of line', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 4)
            }, 'asdf  ')).to.equal('~~~~  ');
        });

        it('supports diagnostic with space on both sides', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 6)
            }, '  asdf  ')).to.equal('  ~~~~  ');
        });

        it('handles diagnostic that starts and stops on the same position', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 2)
            }, 'abcde')).to.equal('~~~~~');
        });

        it('handles single-character diagnostic', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 3)
            }, 'abcde')).to.equal('  ~  ');
        });

        it('handles diagnostics that are longer than the line', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, 'abcde')).to.equal('~~~~~');

            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 10)
            }, 'abcde')).to.equal('  ~~~');
        });

        it('handles Number.MAX_VALUE for end character', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, Number.MAX_VALUE)
            }, 'abcde')).to.equal('~~~~~');
        });

        it.skip('handles edge cases', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(5, 16, 5, 18)
            }, 'end functionasdf')).to.equal('            ~~~~');
        });
    });
});
