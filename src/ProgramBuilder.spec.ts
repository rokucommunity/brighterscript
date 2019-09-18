import { expect } from 'chai';
import * as path from 'path';
import * as sinonImport from 'sinon';
import { FileChangeType } from 'vscode-languageserver';

import { Program } from './Program';
import { ProgramBuilder } from './ProgramBuilder';
import util from './util';

let sinon = sinonImport.createSandbox();
let rootDir = process.cwd();
let n = path.normalize;

describe('ProgramBuilder', () => {
    beforeEach(() => {
    });
    afterEach(() => {
        sinon.restore();
    });

    let builder: ProgramBuilder;
    let b: any;
    let vfs = {};
    beforeEach(() => {
        builder = new ProgramBuilder();
        b = builder;
        vfs = {};
        sinon.stub(util, 'getFileContents').callsFake((filePath) => {
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

    describe('handleFileChanges', () => {
        beforeEach(() => {
            sinon.stub(util, 'getFilePaths').returns(Promise.resolve([{
                src: n(`${rootDir}/source/promise.brs`),
                dest: 'source/promise.brs'
            }, {
                src: n(`${rootDir}/source/main.brs`),
                dest: 'source/source.brs'
            }]));
        });
        it('only adds files that match the files array', async () => {
            builder.program = new Program({});

            let mainPath = n(`${rootDir}/source/main.brs`);
            vfs[mainPath] = 'sub main()\nend sub';

            let libPath = n(`${rootDir}/source/lib.brs`);
            vfs[libPath] = 'sub libFunc1()\nend sub';

            expect(builder.program.files[mainPath]).to.be.undefined;
            expect(builder.program.files[libPath]).to.be.undefined;

            await builder.handleFileChanges([{
                type: <FileChangeType>FileChangeType.Created,
                uri: 'file:///' + mainPath
            }]);

            expect(builder.program.files[mainPath]).to.exist;
            expect(builder.program.files[libPath]).to.be.undefined;

            await builder.handleFileChanges([{
                type: <FileChangeType>FileChangeType.Created,
                uri: 'file:///' + libPath
            }]);

            expect(builder.program.files[mainPath]).to.exist;
            //this is the real test...did the program correctly IGNORE the lib path
            expect(builder.program.files[libPath]).to.be.undefined;
        });
    });
});
