import { expect } from '../chai-config.spec';
import { NamespaceStatement, ClassStatement } from './Statement';
import { AssignmentStatement, Block, Body, CatchStatement, DottedSetStatement, EmptyStatement, EndStatement, ExitStatement, ExpressionStatement, ForEachStatement, ForStatement, FunctionStatement, GotoStatement, IfStatement, ImportStatement, IncrementStatement, IndexedSetStatement, LabelStatement, LibraryStatement, PrintStatement, ReturnStatement, StopStatement, ThrowStatement, TryCatchStatement, WhileStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import { WalkMode } from '../astUtils/visitors';
import { isClassStatement, isNamespaceStatement } from '../astUtils/reflection';
import { Program } from '../Program';
import { trim } from '../testHelpers.spec';
import type { BrsFile } from '../files/BrsFile';
import { tempDir } from '../testHelpers.spec';
import { createStringLiteral, createToken, createVariableExpression } from '../astUtils/creators';
import { TokenKind } from '../lexer/TokenKind';
import { FunctionExpression } from './Expression';
import type { AstNode } from './AstNode';

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
            const body = new Body({});
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

    describe('ClassStatement', () => {
        describe('getName', () => {
            it('handles null namespace name', () => {
                const file = program.setFile<BrsFile>('source/lib.bs', `
                    class Animal
                    end class
                `);
                program.validate();
                const stmt = file.ast.findChildren<ClassStatement>(isClassStatement)[0];
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
                const stmt = file.ast.findChildren<ClassStatement>(isClassStatement)[0];
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

    describe('all Statements', () => {

        let allStatements: AstNode[] = [];

        beforeEach(() => {
            const ident = createToken(TokenKind.Identifier, 'a');
            const expr = createStringLiteral('');
            const token = createToken(TokenKind.StringLiteral, '');
            const body = new Body({ statements: [] });
            const assignment = new AssignmentStatement({ equals: undefined, name: ident, value: expr });
            const block = new Block({ statements: [] });
            const expression = new ExpressionStatement({ expression: expr });
            const exitFor = new ExitStatement({ exit: token, loopType: token });
            const exitWhile = new ExitStatement({ exit: token, loopType: token });
            const funs = new FunctionStatement({
                name: ident,
                func: new FunctionExpression({
                    parameters: [],
                    body: block,
                    functionType: token,
                    leftParen: token,
                    rightParen: token,
                    endFunctionType: token
                })
            });
            const ifs = new IfStatement({ if: token, condition: expr, thenBranch: block });
            const increment = new IncrementStatement({ value: expr, operator: token });
            const print = new PrintStatement({ print: token, expressions: [] });
            const gotos = new GotoStatement({ goto: token, label: token });
            const labels = new LabelStatement({ name: ident, colon: token });
            const returns = new ReturnStatement({ return: token });
            const ends = new EndStatement({ end: token });
            const stop = new StopStatement({ stop: token });
            const fors = new ForStatement({ for: token, counterDeclaration: assignment, to: token, finalValue: expr, body: block, endFor: token, step: token, increment: expr });
            const foreach = new ForEachStatement({ forEach: token, in: token, endFor: token, item: token, target: expr, body: block });
            const whiles = new WhileStatement({ while: token, endWhile: token, condition: expr, body: block });
            const dottedSet = new DottedSetStatement({ obj: expr, name: ident, value: expr });
            const indexedSet = new IndexedSetStatement({ obj: expr, indexes: [expr], value: expr, openingSquare: token, closingSquare: token });
            const library = new LibraryStatement({ library: token, filePath: token });
            const namespace = new NamespaceStatement({ namespace: token, nameExpression: createVariableExpression('a'), body: body, endNamespace: token });
            const cls = new ClassStatement({ class: token, name: ident, body: [], endClass: token });
            const imports = new ImportStatement({ import: token, path: token });
            const catchStmt = new CatchStatement({ catch: token, exceptionVariable: ident, catchBranch: block });
            const tryCatch = new TryCatchStatement({ try: token, tryBranch: block, catchStatement: catchStmt });
            const throwSt = new ThrowStatement({ throw: createToken(TokenKind.Throw) });

            allStatements = [
                expression,
                exitFor,
                exitWhile,
                funs,
                ifs,
                increment,
                print,
                gotos,
                labels,
                returns,
                ends,
                stop,
                fors,
                foreach,
                whiles,
                dottedSet,
                indexedSet,
                library,
                namespace,
                cls,
                imports,
                catchStmt,
                tryCatch,
                throwSt
            ];

        });

        it('has editable leading trivia', () => {
            for (const stmt of allStatements) {
                const beforeTrivia = stmt.leadingTrivia;
                expect(beforeTrivia.length, `${stmt.kind} already has leading trivia`).to.eq(0);
                stmt.leadingTrivia.push(createToken(TokenKind.Comment, 'This is an added comment'));
                const afterComments = stmt.leadingTrivia.filter(t => t.kind === TokenKind.Comment);
                expect(afterComments.length, `${stmt.kind} leading trivia was not edited`).to.eq(1);
                expect(afterComments[0].text, `${stmt.kind} leading trivia was not edited`).to.eq('This is an added comment');
                stmt.leadingTrivia.pop();
            }
        });

    });

});
