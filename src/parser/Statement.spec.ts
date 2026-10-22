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
                const stmt = file.parser.references.classStatements[0];
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
                const stmt = file.parser.references.classStatements[0];
                expect(stmt.getName(ParseMode.BrightScript)).to.equal('NameA_Animal');
                expect(stmt.getName(ParseMode.BrighterScript)).to.equal('NameA.Animal');
            });
        });
    });

    describe('very large transpile output', () => {
        //spreading a huge array into a function call (i.e. `result.push(...items)`) throws "Maximum call stack size exceeded"
        //once it holds more than ~120k items, so these tests produce well over that for a single node
        const statementCount = 50_000;
        const methodCount = 30_000;

        function makeStatements(count: number) {
            const lines = [] as string[];
            for (let i = 0; i < count; i++) {
                lines.push(`print ${i}`);
            }
            return lines.join('\n');
        }

        async function transpile(source: string) {
            program.setFile('source/main.bs', source);
            return (await program.getTranspiledFileContents('source/main.bs')).code;
        }

        it('transpiles a class with a very large number of methods inside a namespace', async function() {
            this.timeout(20_000);
            const methods = [] as string[];
            for (let i = 0; i < methodCount; i++) {
                methods.push(`sub method${i}()\nend sub`);
            }
            const code = await transpile(`namespace alpha\nclass Big\n${methods.join('\n')}\nend class\nend namespace`);
            expect(code).to.include(`sub __alpha_Big_method_method${methodCount - 1}()`);
            expect(code).to.include(`instance.method${methodCount - 1} = __alpha_Big_method_method${methodCount - 1}`);
            expect(code).to.include('function alpha_Big()');
        });

        it('transpiles a function with a very large body', async function() {
            this.timeout(20_000);
            const code = await transpile(`sub main()\n${makeStatements(statementCount)}\nend sub`);
            expect(code).to.include(`print ${statementCount - 1}`);
        });

        it('transpiles a for loop with a very large body', async function() {
            this.timeout(20_000);
            const code = await transpile(`sub main()\nfor i = 0 to 1\n${makeStatements(statementCount)}\nend for\nend sub`);
            expect(code).to.include(`print ${statementCount - 1}`);
        });

        it('transpiles a for each loop with a very large body', async function() {
            this.timeout(20_000);
            const code = await transpile(`sub main()\nfor each item in []\n${makeStatements(statementCount)}\nend for\nend sub`);
            expect(code).to.include(`print ${statementCount - 1}`);
        });

        it('transpiles a while loop with a very large body', async function() {
            this.timeout(20_000);
            const code = await transpile(`sub main()\nwhile true\n${makeStatements(statementCount)}\nend while\nend sub`);
            expect(code).to.include(`print ${statementCount - 1}`);
        });

        it('transpiles an else branch with a very large body', async function() {
            this.timeout(20_000);
            const code = await transpile(`sub main()\nif true then\nprint "then"\nelse\n${makeStatements(statementCount)}\nend if\nend sub`);
            expect(code).to.include(`print ${statementCount - 1}`);
        });

        it('transpiles a try/catch with a very large body', async function() {
            this.timeout(20_000);
            const code = await transpile(`sub main()\ntry\n${makeStatements(statementCount)}\ncatch e\nend try\nend sub`);
            expect(code).to.include(`print ${statementCount - 1}`);
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
