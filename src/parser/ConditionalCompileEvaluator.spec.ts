import { expect } from '../chai-config.spec';
import { createToken } from '../astUtils/creators';
import { isConditionalCompileStatement } from '../astUtils/reflection';
import { InternalWalkMode, WalkMode, createVisitor } from '../astUtils/visitors';
import type { WalkOptions } from '../astUtils/visitors';
import { Lexer } from '../lexer/Lexer';
import { TokenKind } from '../lexer/TokenKind';
import { util } from '../util';
import { ConditionalCompileEvaluator } from './ConditionalCompileEvaluator';
import type { Body, ClassStatement, ConditionalCompileStatement, FunctionStatement } from './Statement';
import { ParseMode, Parser } from './Parser';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';

// eslint-disable-next-line no-bitwise
const allBranches = WalkMode.visitAllRecursive | InternalWalkMode.visitFalseConditionalCompilationBlocks;

describe('ConditionalCompileEvaluator', () => {
    function parse(text: string, bsConsts: Record<string, boolean> = {}) {
        const bsConstMap = new Map<string, boolean>();
        for (const name in bsConsts) {
            bsConstMap.set(name.toLowerCase(), bsConsts[name]);
        }
        const { tokens } = Lexer.scan(text);
        const { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript, bsConsts: bsConstMap });
        return { ast: ast, diagnostics: diagnostics };
    }

    function getStatements(ast: Body) {
        return ast.findChildren<ConditionalCompileStatement>(isConditionalCompileStatement, { walkMode: allBranches });
    }

    function getFunction(ast: Body, name: string) {
        return ast.findChild<FunctionStatement>((node) => (node as FunctionStatement).tokens?.name?.text === name, { walkMode: allBranches });
    }

    it('evaluates literals, not and manifest constants', () => {
        const { ast } = parse(`
            #if true
            sub a()
            end sub
            #end if
            #if not true
            sub b()
            end sub
            #end if
            #if DEBUG
            sub c()
            end sub
            #else
            sub d()
            end sub
            #end if
            #if not NOPE
            sub e()
            end sub
            #end if
        `, { DEBUG: true });
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(['a', 'b', 'c', 'd', 'e'].map(name => evaluator.isNodeActive(getFunction(ast, name)))).to.eql([true, false, true, false, true]);
    });

    it('reports an #if true nested in an #if false as inactive', () => {
        const { ast } = parse(`
            #if false
                #if true
                sub inner()
                end sub
                #else
                sub innerElse()
                end sub
                #end if
            #end if
        `);
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        const [outer, inner] = getStatements(ast);
        expect(evaluator.isThenBranchActive(outer)).to.be.false;
        expect(evaluator.isThenBranchActive(inner)).to.be.false;
        expect(evaluator.isElseBranchActive(inner)).to.be.false;
        expect(evaluator.isNodeActive(getFunction(ast, 'inner'))).to.be.false;
        expect(evaluator.isNodeActive(getFunction(ast, 'innerElse'))).to.be.false;
    });

    it('reports a nested statement as active only when every enclosing branch is active', () => {
        const { ast } = parse(`
            #if not false
                #if true
                sub active()
                end sub
                #end if
            #else
                #if true
                sub inactive()
                end sub
                #end if
            #end if
        `);
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(evaluator.isNodeActive(getFunction(ast, 'active'))).to.be.true;
        expect(evaluator.isNodeActive(getFunction(ast, 'inactive'))).to.be.false;
    });

    it('evaluates an #else if chain so that only the first branch with an active condition is used', () => {
        const { ast } = parse(`
            #if A
            sub a()
            end sub
            #else if B
            sub b()
            end sub
            #else if C
            sub c()
            end sub
            #else
            sub d()
            end sub
            #end if
        `, { A: false, B: true, C: true });
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(['a', 'b', 'c', 'd'].map(name => evaluator.isNodeActive(getFunction(ast, name)))).to.eql([false, true, false, false]);
    });

    it('applies a #const only when its branch is active, in source order', () => {
        const { ast } = parse(`
            #if false
                #const hidden = true
            #end if
            #if hidden
            sub a()
            end sub
            #end if
            #const shown = true
            #if shown
            sub b()
            end sub
            #end if
        `);
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(evaluator.isNodeActive(getFunction(ast, 'a'))).to.be.false;
        expect(evaluator.isNodeActive(getFunction(ast, 'b'))).to.be.true;
    });

    it('does not apply a #const to an #if that came before it', () => {
        const { ast } = parse(`
            #if later
            sub a()
            end sub
            #end if
            #const later = true
        `);
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(evaluator.isNodeActive(getFunction(ast, 'a'))).to.be.false;
    });

    it('reports duplicate constants and keeps the first value', () => {
        const { ast } = parse(`
            #const a = true
            #const a = false
            #const DEBUG = false
            #if a
            sub x()
            end sub
            #end if
        `, { DEBUG: true });
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(evaluator.duplicateConstNames.map(token => token.text)).to.eql(['a', 'DEBUG']);
        expect(evaluator.isNodeActive(getFunction(ast, 'x'))).to.be.true;
    });

    it('reports invalid constant values and declares nothing for them', () => {
        const { ast } = parse(`
            #const a = true
            #const alias = a
            #const number = 1
            #if number
            #end if
        `);
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(evaluator.invalidConstValues).to.have.lengthOf(2);
        expect(evaluator.undeclaredConditionNames.map(token => token.text)).to.eql(['number']);
    });

    it('reports undeclared names only in conditions the device evaluates', () => {
        const { ast } = parse(`
            #if NOPE
            #end if
            #if true
            #else if NEVER_REACHED
            #end if
            #if false
                #if INSIDE_INACTIVE
                #end if
            #end if
            #if DECLARED
            #end if
        `, { DECLARED: false });
        const evaluator = ConditionalCompileEvaluator.forNode(ast);
        expect(evaluator.undeclaredConditionNames.map(token => token.text)).to.eql(['NOPE']);
    });

    it('uses the explicit starting constants instead of those of the tree', () => {
        const { ast } = parse(`
            #if DEBUG
            sub a()
            end sub
            #end if
        `, { DEBUG: false });
        expect(ConditionalCompileEvaluator.forNode(ast).isNodeActive(getFunction(ast, 'a'))).to.be.false;
        expect(ConditionalCompileEvaluator.forNode(ast, new Map([['debug', true]])).isNodeActive(getFunction(ast, 'a'))).to.be.true;
    });

    it('answers for the file when given a node deep in the tree', () => {
        const { ast } = parse(`
            #const LOGGING = true
            sub main()
                #if LOGGING
                    print "a"
                #end if
            end sub
        `);
        const [statement] = getStatements(ast);
        const evaluator = ConditionalCompileEvaluator.forNode(statement);
        expect(evaluator.isThenBranchActive(statement)).to.be.true;
    });

    it('describes the AST as it was when the evaluation was created', () => {
        const { ast } = parse(`
            #if DEBUG
            sub a()
            end sub
            #end if
        `, { DEBUG: false });
        const [statement] = getStatements(ast);
        const before = ConditionalCompileEvaluator.forNode(ast);
        (statement.tokens as any).condition = createToken(TokenKind.True, 'true');
        const after = ConditionalCompileEvaluator.forNode(ast);
        expect(before.isThenBranchActive(statement)).to.be.false;
        expect(after.isThenBranchActive(statement)).to.be.true;
    });

    describe('isNodeActive with a boundary', () => {
        it('ignores the branches outside the boundary', () => {
            const { ast } = parse(`
                #if false
                class Foo
                    #if true
                    sub inside()
                    end sub
                    #else
                    sub outside()
                    end sub
                    #end if
                end class
                #end if
            `);
            const evaluator = ConditionalCompileEvaluator.forNode(ast);
            const klass = ast.findChild((node) => (node as any).tokens?.name?.text === 'Foo', { walkMode: allBranches });
            const inside = getFunction(ast, 'inside');
            const outside = getFunction(ast, 'outside');
            expect(evaluator.isNodeActive(inside)).to.be.false;
            expect(evaluator.isNodeActive(inside, klass)).to.be.true;
            expect(evaluator.isNodeActive(outside, klass)).to.be.false;
        });
    });

    describe('isRangeInInactiveBranch', () => {
        it('does not include text after the condition on the directive line', () => {
            const { ast } = parse('sub a()\n#if DEBUG +\n    print 1\n#else junk\n    print 2\n#end if\nend sub', { DEBUG: false });
            const evaluator = ConditionalCompileEvaluator.forNode(ast);
            expect(evaluator.isRangeInInactiveBranch(util.createRange(1, 10, 1, 11))).to.be.false;
            expect(evaluator.isRangeInInactiveBranch(util.createRange(2, 4, 2, 9))).to.be.true;
            expect(evaluator.isRangeInInactiveBranch(util.createRange(3, 6, 3, 10))).to.be.false;
            expect(evaluator.isRangeInInactiveBranch(util.createRange(4, 4, 4, 9))).to.be.false;
        });

        const source = [
            '#if DEBUG',
            'a = 1',
            '#else if OTHER',
            'b = 2',
            '#else',
            'c = 3',
            '#end if'
        ].join('\n');

        function inactiveLines(bsConsts: Record<string, boolean>) {
            const { ast } = parse(source, bsConsts);
            const evaluator = ConditionalCompileEvaluator.forNode(ast);
            return [0, 1, 2, 3, 4, 5, 6].filter(line => evaluator.isRangeInInactiveBranch(util.createRange(line, 0, line, 1)));
        }

        it('covers the branches that are not compiled and not the directive lines', () => {
            expect(inactiveLines({ DEBUG: true, OTHER: false })).to.eql([3, 5]);
            expect(inactiveLines({ DEBUG: false, OTHER: true })).to.eql([1, 5]);
            expect(inactiveLines({ DEBUG: false, OTHER: false })).to.eql([1, 3]);
        });

        it('is false when there is no range', () => {
            const { ast } = parse(source);
            expect(ConditionalCompileEvaluator.forNode(ast).isRangeInInactiveBranch(undefined)).to.be.false;
        });

        it('treats a branch nested in an inactive branch as part of the inactive branch', () => {
            const { ast } = parse([
                '#if false',
                '#if true',
                'a = 1',
                '#else',
                'b = 2',
                '#end if',
                'c = 3',
                '#end if',
                'd = 4'
            ].join('\n'));
            const evaluator = ConditionalCompileEvaluator.forNode(ast);
            const inactiveLines = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(line => evaluator.isRangeInInactiveBranch(util.createRange(line, 0, line, 1)));
            expect(inactiveLines).to.eql([1, 2, 3, 4, 5, 6]);
        });

        it('finds the lines of many inactive branches', () => {
            const lines: string[] = [];
            for (let index = 0; index < 100; index++) {
                lines.push('#if false', 'inactive = 1', '#end if', 'active = 1');
            }
            const { ast } = parse(lines.join('\n'));
            const evaluator = ConditionalCompileEvaluator.forNode(ast);
            for (let index = 0; index < 100; index++) {
                expect(evaluator.isRangeInInactiveBranch(util.createRange((index * 4) + 1, 0, (index * 4) + 1, 1)), `inactive line ${index}`).to.be.true;
                expect(evaluator.isRangeInInactiveBranch(util.createRange((index * 4) + 3, 0, (index * 4) + 3, 1)), `active line ${index}`).to.be.false;
            }
        });
    });

    describe('forWalk', () => {
        function walkFunctionNames(ast: Body, options: WalkOptions) {
            const names: string[] = [];
            ast.walk(createVisitor({
                FunctionStatement: (statement) => {
                    names.push(statement.tokens.name.text);
                }
            }), options);
            return names;
        }

        it('does not give the evaluation of one tree to another tree when the options are reused', () => {
            const { ast: fileA } = parse('#const DEBUG = true\n#if DEBUG\nsub inA()\nend sub\n#end if');
            const { ast: fileB } = parse('#if DEBUG\nsub inB()\nend sub\n#end if');
            const sharedOptions: WalkOptions = { walkMode: WalkMode.visitStatementsRecursive, bsConsts: new Map<string, boolean>() };
            //only file A declares DEBUG, so file B must not see the evaluation made for file A
            expect(walkFunctionNames(fileA, sharedOptions)).to.eql(['inA']);
            expect(walkFunctionNames(fileB, sharedOptions)).to.eql([]);
        });

        it('evaluates again when the same options object gets different bsConsts', () => {
            const { ast } = parse('#if FOO\nsub whenFoo()\nend sub\n#else\nsub whenNotFoo()\nend sub\n#end if');
            const options: WalkOptions = { walkMode: WalkMode.visitStatementsRecursive, bsConsts: new Map([['foo', true]]) };
            expect(walkFunctionNames(ast, options)).to.eql(['whenFoo']);
            expect(walkFunctionNames(ast, options)).to.eql(['whenFoo']);
            options.bsConsts = new Map([['foo', false]]);
            expect(walkFunctionNames(ast, options)).to.eql(['whenNotFoo']);
            options.bsConsts.set('foo', true);
            expect(walkFunctionNames(ast, options)).to.eql(['whenFoo']);
        });

        it('evaluates again when the constants of a tree that does not belong to a file change between walks with the same options', () => {
            const { ast } = parse('#if FOO\nsub whenFoo()\nend sub\n#end if', { FOO: false });
            const options: WalkOptions = { walkMode: WalkMode.visitStatementsRecursive };
            expect(walkFunctionNames(ast, options)).to.eql([]);
            ast.bsConsts.set('foo', true);
            expect(walkFunctionNames(ast, options)).to.eql(['whenFoo']);
        });

        it('evaluates again with explicit constants even when the file has an evaluation', () => {
            const program = new Program({ rootDir: '/tmp/fakeroot' });
            const file = program.setFile<BrsFile>('source/main.bs', '#if DEBUG\nsub a()\nend sub\n#end if');
            expect(walkFunctionNames(file.ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql([]);
            expect(walkFunctionNames(file.ast, { walkMode: WalkMode.visitStatementsRecursive, bsConsts: new Map([['debug', true]]) })).to.eql(['a']);
            expect(walkFunctionNames(file.ast, { walkMode: WalkMode.visitStatementsRecursive })).to.eql([]);
        });
    });

    describe('evaluation of a file', () => {
        function createFile(source: string) {
            const program = new Program({ rootDir: '/tmp/fakeroot' });
            return program.setFile<BrsFile>('source/main.bs', source);
        }

        it('is shared by every node of the file while the constants are unchanged', () => {
            const file = createFile('#if DEBUG\nsub a()\nend sub\n#end if');
            const [statement] = getStatements(file.ast);
            const evaluator = ConditionalCompileEvaluator.forNode(statement);
            expect(ConditionalCompileEvaluator.forNode(file.ast)).to.equal(evaluator);
            expect(evaluator.isThenBranchActive(statement)).to.be.false;
        });

        it('is replaced as soon as the constants change, without validating', () => {
            const file = createFile('#if DEBUG\nsub a()\nend sub\n#end if');
            const [statement] = getStatements(file.ast);
            const evaluator = ConditionalCompileEvaluator.forNode(statement);

            file.ast.bsConsts.set('debug', true);
            const replacement = ConditionalCompileEvaluator.forNode(statement);
            expect(replacement).not.to.equal(evaluator);
            expect(replacement.isThenBranchActive(statement)).to.be.true;
            expect(ConditionalCompileEvaluator.forNode(statement)).to.equal(replacement);

            file.ast.bsConsts = new Map([['debug', false]]);
            expect(ConditionalCompileEvaluator.forNode(statement).isThenBranchActive(statement)).to.be.false;
        });

        it('applies an edit to the AST the next time the file is validated', () => {
            const file = createFile('#if DEBUG\nsub a()\nend sub\n#end if');
            file.program.validate();
            const [statement] = getStatements(file.ast);
            const evaluator = ConditionalCompileEvaluator.forNode(statement);
            (statement.tokens as any).condition = createToken(TokenKind.True, 'true');
            expect(ConditionalCompileEvaluator.forNode(statement)).to.equal(evaluator);
            expect(evaluator.isThenBranchActive(statement)).to.be.false;

            file.isValidated = false;
            file.program.validate();
            expect(ConditionalCompileEvaluator.forNode(statement)).not.to.equal(evaluator);
            expect(ConditionalCompileEvaluator.forNode(statement).isThenBranchActive(statement)).to.be.true;
        });

        it('does not exist for a file without conditional compile statements', () => {
            const file = createFile('sub a()\nend sub');
            expect(file.getConditionalCompileEvaluator()).to.be.undefined;
        });
    });

    describe('a class without a file evaluation', () => {
        it('treats every member as active', () => {
            const { ast } = parse('class Foo\n#if DEBUG\nsub a()\nend sub\n#else\nsub b()\nend sub\n#end if\nend class', { DEBUG: false });
            const classStatement = ast.statements[0] as ClassStatement;
            expect(classStatement.getActiveMembers().map(member => member.tokens.name.text)).to.eql(['a', 'b']);
        });
    });

    describe('a statement the evaluation never visited', () => {
        it('is evaluated against the constants in effect after the last statement without being remembered', () => {
            const { ast } = parse('#const LATE = true\nsub main()\nend sub', { DEBUG: false });
            const evaluator = ConditionalCompileEvaluator.forNode(ast);
            const addedStatement = parse('#if LATE\nsub added()\nend sub\n#end if').ast.statements[0] as ConditionalCompileStatement;
            expect(evaluator.isThenBranchActive(addedStatement)).to.be.true;
            expect(evaluator.undeclaredConditionNames).to.be.empty;
            expect(evaluator.isRangeInInactiveBranch(util.createRange(1, 0, 1, 1))).to.be.false;
        });
    });
});
