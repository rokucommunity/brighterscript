import { expect } from 'chai';
import * as sinonImport from 'sinon';

import { ProgramBuilder } from './ProgramBuilder';
import util from './util';

let sinon = sinonImport.createSandbox();

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
});
