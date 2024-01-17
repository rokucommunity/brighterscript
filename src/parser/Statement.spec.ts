import { expect } from '../chai-config.spec';
import type { NamespaceStatement } from './Statement';
import { Body, CommentStatement, EmptyStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import { WalkMode } from '../astUtils/visitors';
import { isNamespaceStatement } from '../astUtils/reflection';
import { CancellationTokenSource } from 'vscode-languageserver';
import { Program } from '../Program';
import { trim } from '../testHelpers.spec';
import type { BrsFile } from '../files/BrsFile';
import { tempDir } from '../testHelpers.spec';

describe('Statement', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({
            cwd: tempDir
        });
    });
    describe('EmptyStatement', () => {
        it('returns empty array for transpile', () => {
            const statement = new EmptyStatement();
            expect(statement.transpile({} as any)).to.eql([]);
        });
        it('does nothing for walkAll', () => {
            const statement = new EmptyStatement();
            statement.walk(() => {
                expect(true).to.be.false;
            }, { walkMode: WalkMode.visitAllRecursive });
        });
    });

    describe('Body', () => {
        it('initializes statements array if none provided', () => {
            const body = new Body();
            expect(body.statements).to.eql([]);
        });
    });

    describe('NamespaceStatement', () => {
        it('getName() works', () => {
            const parser = Parser.parse(`
                namespace NameA.NameB
                end namespace
            `);
            const statement = parser.ast.statements[0] as NamespaceStatement;
            expect(statement.getName(ParseMode.BrighterScript)).to.equal('NameA.NameB');
            expect(statement.getName(ParseMode.BrightScript)).to.equal('NameA_NameB');
        });

        it('getName() works', () => {
            program.setFile<BrsFile>('source/main.brs', `
                namespace NameA
                    namespace NameB
                        sub main()
                        end sub
                    end namespace
                end namespace
            `);
            program.validate();
            let node = program.getFile<BrsFile>('source/main.brs')!.ast.findChild<NamespaceStatement>(isNamespaceStatement);
            while (node!.findChild(isNamespaceStatement)) {
                node = node!.findChild<NamespaceStatement>(isNamespaceStatement);
            }
            expect(node!.getName(ParseMode.BrighterScript)).to.equal('NameA.NameB');
            expect(node!.getName(ParseMode.BrightScript)).to.equal('NameA_NameB');
        });
    });

    describe('CommentStatement', () => {
        describe('walk', () => {
            it('skips visitor if canceled', () => {
                const comment = new CommentStatement([]);
                const cancel = new CancellationTokenSource();
                cancel.cancel();
                comment.walk(() => {
                    throw new Error('Should not have been called');
                }, { walkMode: WalkMode.visitAllRecursive, cancel: cancel.token });
            });
        });
    });

    describe('ClassStatement', () => {
        describe('getName', () => {
            it('handles null namespace name', () => {
                const file = program.setFile<BrsFile>('source/lib.bs', `
                    class Animal
                    end class
                `);
                program.validate();
                const stmt = file.cachedLookups.classStatements[0];
                expect(stmt.getName(ParseMode.BrightScript)).to.equal('Animal');
                expect(stmt.getName(ParseMode.BrighterScript)).to.equal('Animal');
            });
            it('handles namespaces', () => {
                const file = program.setFile<BrsFile>('source/lib.bs', `
                    namespace NameA
                        class Animal
                        end class
                    end namespace
                `);
                program.validate();
                const stmt = file.cachedLookups.classStatements[0];
                expect(stmt.getName(ParseMode.BrightScript)).to.equal('NameA_Animal');
                expect(stmt.getName(ParseMode.BrighterScript)).to.equal('NameA.Animal');
            });
        });
    });

    describe('ImportStatement', () => {
        describe('getTypedef', () => {
            it('changes .bs file extensions to .brs', () => {
                const file = program.setFile<BrsFile>('source/main.bs', `
                    import "lib1.bs"
                    import "pkg:/source/lib2.bs"
                `);

                expect(
                    trim`${file.getTypedef()}`
                ).to.eql(trim`
                    import "lib1.brs"
                    import "pkg:/source/lib2.brs"
                `);
            });
        });
    });

});
