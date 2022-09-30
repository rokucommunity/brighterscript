import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from 'chai';
import type { DottedGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';

describe('Program', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            stagingFolderPath: stagingDir
        });
        program.createSourceScope(); //ensure source scope is created
    });
    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program.dispose();
    });

    describe('AstNode', () => {
        describe('findNodeAtPosition', () => {
            it('finds deepest AstNode that matches the position', () => {
                const file = program.setFile<BrsFile>('source/main.brs', `
                    sub main()
                        alpha = invalid
                        print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
                const delta = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 52));
                expect(delta.name.text).to.eql('delta');

                const foxtrot = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 71));
                expect(foxtrot.name.text).to.eql('foxtrot');
            });
        });
    });
});

