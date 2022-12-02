import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { DottedGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { Parser } from './Parser';

describe('Program', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir,
            stagingDir: stagingDir
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

    describe('toString', () => {
        function testToString(text: string) {
            expect(
                Parser.parse(text).ast.toString()
            ).to.eql(
                text
            );
        }
        it('retains full fidelity', () => {
            testToString(`
                thing = true

                if true
                    thing = true
                end if

                if true
                    thing = true
                else
                    thing = true
                end if

                if true
                    thing = true
                else if true
                    thing = true
                else
                    thing = true
                end if

                for i = 0 to 10 step 1
                    print true,false;3
                end for

                for each item in thing
                    print 1
                end for
            `);
        });
    });
});
