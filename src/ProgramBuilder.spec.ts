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
let n = util.normalizeFilePath.bind(util);

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

    describe('handleFileChanges', () => {
        beforeEach(() => {
            setVfsFile(n(`${rootDir}/source/promise.brs`), 'sub promise()\nend sub');
            setVfsFile(n(`${rootDir}/source/main.brs`), 'sub main()\nend sub');
        });
        /**
         * Linux/windows issues...standardize the file protocol so we avoid this error:
         * Error: [UriError]: If a URI does not contain an authority component, then the path cannot begin with two slash characters ("//")
         * @param fullPath
         */

        it('only adds files that match the files array', async () => {
            sinon.stub(util, 'getFilePaths').returns(
                Promise.resolve([{
                    src: n(`${rootDir}/source/main.brs`),
                    dest: 'source/main.brs'
                }])
            );
            let options = {
                rootDir: rootDir
            } as BsConfig;
            builder.program = new Program(options);
            b.options = builder.program.options;

            let mainPath = n(`${rootDir}/source/main.brs`);
            setVfsFile(mainPath, 'sub main()\nend sub');

            let libPath = n(`${rootDir}/source/lib.brs`);
            setVfsFile(libPath, 'sub libFunc1()\nend sub');

            expect(builder.program.files[mainPath]).to.be.undefined;
            expect(builder.program.files[libPath]).to.be.undefined;

            await builder.handleFileChanges([{
                type: <FileChangeType>FileChangeType.Created,
                uri: getFileProtocolPath(mainPath)
            }]);

            expect(builder.program.files[mainPath]).to.exist;
            expect(builder.program.files[libPath]).to.be.undefined;

            await builder.handleFileChanges([{
                type: <FileChangeType>FileChangeType.Created,
                uri: getFileProtocolPath(libPath)
            }]);

            expect(builder.program.files[mainPath]).to.exist;
            //this is the real test...did the program correctly IGNORE the lib path
            expect(builder.program.files[libPath]).to.be.undefined;
        });
    });
});

export function getFileProtocolPath(fullPath: string) {
    let result: string;
    if (fullPath.indexOf('/') === 0 || fullPath.indexOf('\\') === 0) {
        result = `file://${fullPath}`;
    } else {
        result = `file:///${fullPath}`;
    }
    return result;
}
