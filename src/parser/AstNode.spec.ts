import { util } from '../util';
import * as fsExtra from 'fs-extra';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import { expect } from '../chai-config.spec';
import type { DottedGetExpression } from './Expression';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { isAssignmentStatement, isClassStatement, isDottedGetExpression, isPrintStatement } from '../astUtils/reflection';
import type { FunctionStatement } from './Statement';
import { AssignmentStatement } from './Statement';

describe('AstNode', () => {
    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program(util.normalizeConfig({
            rootDir: rootDir,
            stagingDir: stagingDir
        }));
        program.createSourceScope(); //ensure source scope is created
    });
    afterEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program.dispose();
    });

    describe('findChildAtPosition', () => {
        it('finds deepest AstNode that matches the position', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                    sub main()
                        alpha = invalid
                        print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                    end sub
                `);
            program.validate();
            expectZeroDiagnostics(program);
            const delta = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 52))!;
            expect(delta.name.text).to.eql('delta');

            const foxtrot = file.ast.findChildAtPosition<DottedGetExpression>(util.createPosition(3, 71))!;
            expect(foxtrot.name.text).to.eql('foxtrot');
        });
    });

    describe('findChild', () => {
        it('finds a child that matches the matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            expect(
                file.ast.findChild((node) => {
                    return isAssignmentStatement(node) && node.name.text === 'alpha';
                })
            ).instanceof(AssignmentStatement);
        });

        it('returns the exact node that matches', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha1 = invalid
                    alpha2 = invalid
                end sub
            `);
            let count = 0;
            const instance = file.ast.findChild((node) => {
                if (isAssignmentStatement(node)) {
                    count++;
                    if (count === 2) {
                        return true;
                    }
                }
            });
            const expected = (file.ast.statements[0] as FunctionStatement).func.body.statements[1];
            expect(instance).to.equal(expected);
        });

        it('returns undefined when matcher never returned true', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            expect(
                file.ast.findChild((node) => false)
            ).not.to.exist;
        });

        it('returns the value returned from the matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const secondStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[1];
            expect(
                file.ast.findChild((node) => secondStatement)
            ).to.equal(secondStatement);
        });

        it('cancels properly', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            let count = 0;
            file.ast.findChild((node, cancelToken) => {
                count++;
                cancelToken.cancel();
            });
            expect(count).to.eql(1);
        });
    });

    describe('findAncestor', () => {
        it('returns node when matcher returns true', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const secondStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[1];
            const foxtrot = file.ast.findChild((node) => {
                return isDottedGetExpression(node) && node.name?.text === 'foxtrot';
            })!;
            expect(
                foxtrot.findAncestor(isPrintStatement)
            ).to.equal(secondStatement);
        });

        it('returns undefined when no match found', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const foxtrot = file.ast.findChild((node) => {
                return isDottedGetExpression(node) && node.name?.text === 'foxtrot';
            })!;
            expect(
                foxtrot.findAncestor(isClassStatement)
            ).to.be.undefined;
        });

        it('returns overridden node when returned in matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            const firstStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[0];
            const foxtrot = file.ast.findChild((node) => {
                return isDottedGetExpression(node) && node.name?.text === 'foxtrot';
            })!;
            expect(
                foxtrot.findAncestor(node => firstStatement)
            ).to.equal(firstStatement);
        });

        it('returns overridden node when returned in matcher', () => {
            const file = program.setFile<BrsFile>('source/main.brs', `
                sub main()
                    alpha = invalid
                    print alpha.beta.charlie.delta(alpha.echo.foxtrot())
                end sub
            `);
            let count = 0;
            const firstStatement = (file.ast.statements[0] as FunctionStatement).func.body.statements[0];
            firstStatement.findAncestor((node, cancel) => {
                count++;
                cancel.cancel();
            });
            expect(count).to.eql(1);
        });
    });
});
