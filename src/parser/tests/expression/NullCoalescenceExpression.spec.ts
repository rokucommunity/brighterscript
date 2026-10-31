/* eslint-disable @typescript-eslint/no-for-in-array */
import { expect } from '../../../chai-config.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { Lexer } from '../../../lexer/Lexer';
import { Parser, ParseMode } from '../../Parser';
import { AssignmentStatement, ExpressionStatement, ForEachStatement } from '../../Statement';
import type {
    AAMemberExpression
} from '../../Expression';
import {
    AALiteralExpression,
    ArrayLiteralExpression,
    CallExpression,
    LiteralExpression,
    NullCoalescingExpression
} from '../../Expression';
import { Program } from '../../../Program';
import { expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';

describe('NullCoalescingExpression', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`a = user ?? {"id": "default"}`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    describe('null coalescing as statements are not supported', () => {
        it(`creates diagnostic when used as a statement`, () => {
            //test as property
            for (const test of [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()'
            ]) {

                let { tokens } = Lexer.scan(`${test} ?? "human"`);
                let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.unexpectedToken('??').code);
                expect(ast.statements).not.to.be.empty;
            }
        });
    });

    describe('different coalescence types- variety of test cases', () => {
        it(`accepts various consequents with primitive values:`, () => {
            //test as property
            for (const test of [
                'result = true',
                'result = false',
                'result = len("person") = 10',
                'result = m.getResponse()',
                'result = m.myZombies[3].ifFed = true'
            ]) {

                let { tokens } = Lexer.scan(`${test} ?? "human"`);
                let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.empty;
                expect(ast.statements[0]).instanceof(AssignmentStatement);
                expect((ast.statements[0] as AssignmentStatement).value).instanceof(NullCoalescingExpression);
            }
        });

        it(`supports non-primitive alternates`, () => {
            //test as property
            for (const consequent of [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()',
                'm.myZombies[3].ifFed = true',
                'getZombieName()'
            ]) {

                let { tokens } = Lexer.scan(`result = "text" ?? ${consequent}`);
                let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expectZeroDiagnostics(diagnostics);
                expect(ast.statements[0]).instanceof(AssignmentStatement);
                expect((ast.statements[0] as AssignmentStatement).value).instanceof(NullCoalescingExpression);
            }
        });
    });

    describe('in assignment', () => {
        it(`simple case`, () => {
            let { tokens } = Lexer.scan(`a = user ?? {"id": "default"}`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line arrays case`, () => {
            let { tokens } = Lexer.scan(`a = items ?? [
          "one"
          "two"
          "three"]`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(AssignmentStatement);
        });
        it(`multi line assoc array`, () => {
            let { tokens } = Lexer.scan(`a = user ?? {
          "b": "test"
          }`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(AssignmentStatement);
        });

        it(`in func call with array args`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains(user ?? defaultUser)`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(ExpressionStatement);
            expect((ast.statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (ast.statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(NullCoalescingExpression);
        });

        it(`in func call with more args`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains(user ?? defaultUser, true, 12)`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(ExpressionStatement);
            expect((ast.statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (ast.statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
            expect(callExpression.args[0]).instanceof(NullCoalescingExpression);
        });

        it(`in func call with more args, and comparing value`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains((items ?? ["1","2"]).count() = 3, true, 12)`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(ExpressionStatement);
            expect((ast.statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (ast.statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
        });

        it(`in array`, () => {
            let { tokens } = Lexer.scan(`a = [letter ?? "b", "c"]`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(AssignmentStatement);
            expect((ast.statements[0] as AssignmentStatement).value).instanceof(ArrayLiteralExpression);
            let literalExpression = (ast.statements[0] as AssignmentStatement).value as ArrayLiteralExpression;
            expect(literalExpression.elements[0]).instanceOf(NullCoalescingExpression);
            expect(literalExpression.elements[1]).instanceOf(LiteralExpression);
        });

        it(`in aa`, () => {
            let { tokens } = Lexer.scan(`a = {"v1": letter ?? "b", "v2": "c"}`);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(AssignmentStatement);
            expect((ast.statements[0] as AssignmentStatement).value).instanceof(AALiteralExpression);
            let literalExpression = (ast.statements[0] as AssignmentStatement).value as AALiteralExpression;
            expect((literalExpression.elements[0] as AAMemberExpression).tokens.key.text).is.equal('"v1"');
            expect((literalExpression.elements[0] as AAMemberExpression).value).instanceOf(NullCoalescingExpression);
            expect((literalExpression.elements[1] as AAMemberExpression).tokens.key.text).is.equal('"v2"');
            expect((literalExpression.elements[1] as AAMemberExpression).value).instanceOf(LiteralExpression);
        });

        it(`in for each`, () => {
            let { tokens } = Lexer.scan(`for each person in items ?? defaultItems
                ? "person is " ; person
            end for
            `);
            let { ast, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(ast.statements[0]).instanceof(ForEachStatement);
            expect((ast.statements[0] as ForEachStatement).target).instanceof(NullCoalescingExpression);
        });

    });

    describe('transpile', () => {
        let rootDir = process.cwd();
        let program: Program;
        let testTranspile = getTestTranspile(() => [program, rootDir]);

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });
        afterEach(() => {
            program.dispose();
        });

        it('uses the proper prefix when aliased package is installed', async () => {
            program.setFile('source/roku_modules/rokucommunity_bslib/bslib.brs', '');
            await testTranspile(`
                sub main(user)
                    a = user ?? false
                end sub
            `, `
                sub main(user)
                    a = rokucommunity_bslib_coalesce(user, false)
                end sub
            `);
        });

        it('properly transpiles null coalesence assignments - simple', async () => {
            await testTranspile(`
                sub main(user)
                    a = user ?? {"id": "default"}
                end sub
            `, `
                sub main(user)
                    a = bslib_coalesce(user, {
                        "id": "default"
                    })
                end sub
            `);
        });

        it('properly transpiles null coalesence assignments - complex consequent', async () => {
            await testTranspile(`
                sub main()
                    user = {}
                    a = user.getAccount() ?? {"id": "default"}
                end sub
            `, `
                sub main()
                    user = {}
                    a = user.getAccount()
                    if a = invalid then
                        a = {
                            "id": "default"
                        }
                    end if
                end sub
            `);
        });

        it('transpiles null coalesence assignment for variable alternate- complex consequent', async () => {
            await testTranspile(`
                sub main(obj)
                    a = obj.link ?? false
                end sub
            `, `
                sub main(obj)
                    a = obj.link
                    if a = invalid then
                        a = false
                    end if
                end sub
            `);
        });

        it('does not capture restricted OS functions', async () => {
            //failOnDiagnostic=false: the bare `eval("print 1")` triggers the rsg_version=1.2
            //deprecation diagnostic under default settings, which is unrelated to what this test covers.
            await testTranspile(`
                sub main()
                    num = 1
                    test(num.ToStr() = "1" ?? [
                        createObject("roDeviceInfo")
                        type(true)
                        GetGlobalAA()
                        box(1)
                        run("file.brs", invalid)
                        eval("print 1")
                        GetLastRunCompileError()
                        GetLastRunRuntimeError()
                        Tab(1)
                        Pos(0)
                    ])
                end sub
                sub test(p1)
                end sub
            `, `
                sub main()
                    num = 1
                    test((function(num)
                            __bsConsequent = num.ToStr() = "1"
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return [
                                    createObject("roDeviceInfo")
                                    type(true)
                                    GetGlobalAA()
                                    box(1)
                                    run("file.brs", invalid)
                                    eval("print 1")
                                    GetLastRunCompileError()
                                    GetLastRunRuntimeError()
                                    Tab(1)
                                    Pos(0)
                                ]
                            end if
                        end function)(num))
                end sub

                sub test(p1)
                end sub
            `, 'trim', 'source/main.bs', false);
        });

        it('properly transpiles null coalesence assignments - complex alternate', async () => {
            await testTranspile(`
                sub main()
                    user = {}
                    settings = {}
                    a = user ?? m.defaults.getAccount(settings.name)
                end sub
            `, `
                sub main()
                    user = {}
                    settings = {}
                    a = user
                    if a = invalid then
                        a = m.defaults.getAccount(settings.name)
                    end if
                end sub
            `);
        });

        it('ignores enum variable names', async () => {
            await testTranspile(`
                enum Direction
                    up = "up"
                end enum
                sub main()
                    d = invalid
                    print d ?? Direction.up
                end sub
            `, `
                sub main()
                    d = invalid
                    print (function(d)
                            __bsConsequent = d
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return "up"
                            end if
                        end function)(d)
                end sub
            `);
        });

        it('ignores const variable names', async () => {
            await testTranspile(`
                const USER = "user"
                sub main()
                    settings = {}
                    print m.defaults.getAccount(settings.name) ?? USER
                end sub
            `, `
                sub main()
                    settings = {}
                    print (function(m, settings)
                            __bsConsequent = m.defaults.getAccount(settings.name)
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return "user"
                            end if
                        end function)(m, settings)
                end sub
            `);
        });

        describe('namespace names in scope capturing', () => {
            beforeEach(() => {
                program.setFile('source/lib.bs', `
                    namespace promises
                        function resolve(value)
                            return value
                        end function
                    end namespace
                    namespace alpha.beta
                        function getValue()
                            return 1
                        end function
                    end namespace
                `);
            });

            it('does not capture a namespace', async () => {
                await testTranspile(`
                    sub main(value)
                        print value.next ?? promises.resolve(value)
                    end sub
                `, `
                    sub main(value)
                        print (function(value)
                                __bsConsequent = value.next
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return promises_resolve(value)
                                end if
                            end function)(value)
                    end sub
                `);
            });

            it('does not capture a nested namespace', async () => {
                await testTranspile(`
                    sub main(value)
                        print value.next ?? alpha.beta.getValue()
                    end sub
                `, `
                    sub main(value)
                        print (function(value)
                                __bsConsequent = value.next
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return alpha_beta_getValue()
                                end if
                            end function)(value)
                    end sub
                `);
            });

            it('still captures a parameter that shadows a namespace name', async () => {
                await testTranspile(`
                    sub main(promises, value)
                        print value.next ?? promises
                    end sub
                `, `
                    sub main(promises, value)
                        print (function(promises, value)
                                __bsConsequent = value.next
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return promises
                                end if
                            end function)(promises, value)
                    end sub
                `);
            });

            it('still captures a local variable that shadows a namespace name', async () => {
                await testTranspile(`
                    sub main(value)
                        promises = [1, 2]
                        print value.next ?? promises
                    end sub
                `, `
                    sub main(value)
                        promises = [
                            1
                            2
                        ]
                        print (function(promises, value)
                                __bsConsequent = value.next
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return promises
                                end if
                            end function)(promises, value)
                    end sub
                `);
            });
        });

        describe('as the value of an assignment', () => {
            it('assigns a local target directly when the alternate does not read it', async () => {
                await testTranspile(`
                    namespace mc
                        function getPath(obj, path)
                        end function
                    end namespace
                    sub main(task)
                        endpoints = mc.getPath(task.output, "data.endpoints") ?? {}
                    end sub
                `, `
                    function mc_getPath(obj, path)
                    end function

                    sub main(task)
                        endpoints = mc_getPath(task.output, "data.endpoints")
                        if endpoints = invalid then
                            endpoints = {}
                        end if
                    end sub
                `);
            });

            it('uses a temp when the alternate reads the local being assigned', async () => {
                await testTranspile(`
                    sub main(node)
                        node = node.next ?? node
                    end sub
                `, `
                    sub main(node)
                        __bsc_tmp_coalesce = node.next
                        if __bsc_tmp_coalesce = invalid then
                            __bsc_tmp_coalesce = node
                        end if
                        node = __bsc_tmp_coalesce
                    end sub
                `);
            });

            it('uses a temp for dotted set targets', async () => {
                await testTranspile(`
                    sub main(task)
                        m.value = task.output ?? {}
                    end sub
                `, `
                    sub main(task)
                        __bsc_tmp_coalesce = task.output
                        if __bsc_tmp_coalesce = invalid then
                            __bsc_tmp_coalesce = {}
                        end if
                        m.value = __bsc_tmp_coalesce
                    end sub
                `);
            });

            it('uses a temp for indexed set targets', async () => {
                await testTranspile(`
                    sub main(task, arr)
                        arr[0] = task.output ?? {}
                    end sub
                `, `
                    sub main(task, arr)
                        __bsc_tmp_coalesce = task.output
                        if __bsc_tmp_coalesce = invalid then
                            __bsc_tmp_coalesce = {}
                        end if
                        arr[0] = __bsc_tmp_coalesce
                    end sub
                `);
            });

            it('uses a temp for augmented assignments', async () => {
                await testTranspile(`
                    sub main(task)
                        total = 1
                        total += task.count ?? 1
                    end sub
                `, `
                    sub main(task)
                        total = 1
                        __bsc_tmp_coalesce = task.count
                        if __bsc_tmp_coalesce = invalid then
                            __bsc_tmp_coalesce = 1
                        end if
                        total += __bsc_tmp_coalesce
                    end sub
                `);
            });

            it('handles a parenthesized value', async () => {
                await testTranspile(`
                    sub main(task)
                        a = (task.output ?? {})
                    end sub
                `, `
                    sub main(task)
                        a = task.output
                        if a = invalid then
                            a = {}
                        end if
                    end sub
                `);
            });

            it('flattens a nested coalesce in the consequent', async () => {
                await testTranspile(`
                    sub main(task)
                        a = (task.a ?? task.b) ?? task.c
                    end sub
                `, `
                    sub main(task)
                        a = task.a
                        if a = invalid then
                            a = task.b
                        end if
                        if a = invalid then
                            a = task.c
                        end if
                    end sub
                `);
            });

            it('only evaluates a nested coalesce in the alternate when needed', async () => {
                await testTranspile(`
                    sub main(task)
                        a = task.a ?? (task.b ?? task.c)
                    end sub
                `, `
                    sub main(task)
                        a = task.a
                        if a = invalid then
                            a = task.b
                            if a = invalid then
                                a = task.c
                            end if
                        end if
                    end sub
                `);
            });

            it('rewrites a ternary in the alternate', async () => {
                await testTranspile(`
                    sub main(task, x)
                        a = task.a ?? (x > 1 ? "big" : "small")
                    end sub
                `, `
                    sub main(task, x)
                        a = task.a
                        if a = invalid then
                            if x > 1 then
                                a = "big"
                            else
                                a = "small"
                            end if
                        end if
                    end sub
                `);
            });

            it('rewrites a coalesce inside a single-line if', async () => {
                await testTranspile(`
                    sub main(task, x)
                        if x then a = task.a ?? 2
                    end sub
                `, `
                    sub main(task, x)
                        if x then
                            a = task.a
                            if a = invalid then
                                a = 2
                            end if
                        end if
                    end sub
                `);
            });

            it('rewrites a coalesce inside a function expression', async () => {
                await testTranspile(`
                    sub main(task)
                        callback = function(task)
                            return task
                        end function
                        result = callback(task) ?? {}
                    end sub
                `, `
                    sub main(task)
                        callback = function(task)
                            return task
                        end function
                        result = callback(task)
                        if result = invalid then
                            result = {}
                        end if
                    end sub
                `);
            });

            it('leaves a coalesce that is only part of the value as an inline function', async () => {
                await testTranspile(`
                    sub main(task)
                        a = (task.count ?? 0) + 1
                    end sub
                `, `
                    sub main(task)
                        a = ((function(task)
                                __bsConsequent = task.count
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return 0
                                end if
                            end function)(task)) + 1
                    end sub
                `);
            });
        });
    });
});
