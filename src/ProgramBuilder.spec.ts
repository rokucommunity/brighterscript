import { expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';
import { FileChangeType } from 'vscode-languageserver';

import { BsConfig } from './BsConfig';
import { Program } from './Program';
import { ProgramBuilder } from './ProgramBuilder';
import util from './util';

let sinon = sinonImport.createSandbox();
let rootDir = process.cwd();
let n = util.standardizePath.bind(util);

describe('ProgramBuilder', () => {
    afterEach(() => {
        sinon.restore();
    });

    let builder: ProgramBuilder;
    let b: any;
    let setVfsFile: (filePath: string, contents: string) => void;
    beforeEach(async () => {
        builder = new ProgramBuilder();
        b = builder;
        b.options = await util.normalizeAndResolveConfig(undefined);
        b.program = new Program(b.options);
        let vfs = {};
        setVfsFile = (filePath, contents) => {
            vfs[filePath] = contents;
        };
        sinon.stub(b.program.util, 'getFileContents').callsFake((filePath) => {
            if (vfs[filePath]) {
                return vfs[filePath];
            } else {
                throw new Error('Cannot find file ' + filePath);
            }
        });
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
            setVfsFile(n(`${rootDir}/bsconfig.json`), '{');
            await builder.run({
                project: n(`${rootDir}/bsconfig.json`),
                username: 'john'
            });
            expect(builder.program.options.username).to.equal('rokudev');
        });

        it('throws an exception when run is called twice', async () => {
            await builder.run({});
            try {
                await builder.run({});
                expect(true).to.be.false('Should have thrown exception');
            } catch (e) { }
        });
    });
});
