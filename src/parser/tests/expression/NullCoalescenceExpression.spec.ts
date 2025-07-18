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
import { expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';

describe('NullCoalescingExpression', () => {
    it('throws exception when used in brightscript scope', () => {
        let { tokens } = Lexer.scan(`a = user ?? {"id": "default"}`);
        let { diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.code).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('').code);
    });

    describe('null coalescing as statements are not supported', () => {
        it(`rejects various consequents with primitive values:`, () => {
            //test as property
            for (const test in [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()',
                'm.myZombies[3].ifFed = true'
            ]) {

                let { tokens } = Lexer.scan(`${test} ?? "human"`);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.not.be.empty;
                expect(statements).to.be.empty;
            }
        });
    });

    describe('invalid coalescene - variety of test cases', () => {
        it(`rejects various consequents with primitive values:`, () => {
            //test as property
            for (const test in [
                'result = true',
                'result = false',
                'result = len("person") = 10',
                'result = m.getResponse()',
                'result = m.myZombies[3].ifFed = true'
            ]) {

                let { tokens } = Lexer.scan(`${test} ?? "human"`);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.not.be.empty;
                expect(statements).to.be.empty;
            }
        });

        it(`supports non-primitive alternates:`, () => {
            //test as property
            for (const consequent in [
                'true',
                'false',
                'len("person") = 10',
                'm.getResponse()',
                'm.myZombies[3].ifFed = true',
                'getZombieName()'
            ]) {

                let { tokens } = Lexer.scan(`result = "text" ?? ${consequent}`);
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expectZeroDiagnostics(diagnostics);
                expect(statements[0]).instanceof(AssignmentStatement);
                expect((statements[0] as AssignmentStatement).value).instanceof(NullCoalescingExpression);

            }
        });
    });

    describe('in assignment', () => {
        it(`simple case`, () => {
            let { tokens } = Lexer.scan(`a = user ?? {"id": "default"}`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line arrays case`, () => {
            let { tokens } = Lexer.scan(`a = items ?? [
          "one"
          "two"
          "three"]`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });
        it(`multi line assoc array`, () => {
            let { tokens } = Lexer.scan(`a = user ?? {
          "b": "test"
          }`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`in func call with array args`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains(user ?? defaultUser)`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(NullCoalescingExpression);
        });

        it(`in func call with more args`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains(user ?? defaultUser, true, 12)`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
            expect(callExpression.args[0]).instanceof(NullCoalescingExpression);
        });

        it(`in func call with more args, and comparing value`, () => {
            let { tokens } = Lexer.scan(`m.eatBrains((items ?? ["1","2"]).count() = 3, true, 12)`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
        });

        it(`in array`, () => {
            let { tokens } = Lexer.scan(`a = [letter ?? "b", "c"]`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
            expect((statements[0] as AssignmentStatement).value).instanceof(ArrayLiteralExpression);
            let literalExpression = (statements[0] as AssignmentStatement).value as ArrayLiteralExpression;
            expect(literalExpression.elements[0]).instanceOf(NullCoalescingExpression);
            expect(literalExpression.elements[1]).instanceOf(LiteralExpression);
        });

        it(`in aa`, () => {
            let { tokens } = Lexer.scan(`a = {"v1": letter ?? "b", "v2": "c"}`);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
            expect((statements[0] as AssignmentStatement).value).instanceof(AALiteralExpression);
            let literalExpression = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            expect((literalExpression.elements[0] as AAMemberExpression).keyToken.text).is.equal('"v1"');
            expect((literalExpression.elements[0] as AAMemberExpression).value).instanceOf(NullCoalescingExpression);
            expect((literalExpression.elements[1] as AAMemberExpression).keyToken.text).is.equal('"v2"');
            expect((literalExpression.elements[1] as AAMemberExpression).value).instanceOf(LiteralExpression);
        });

        it(`in for each`, () => {
            let { tokens } = Lexer.scan(`for each person in items ?? defaultItems
                ? "person is " ; person
            end for
            `);
            let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ForEachStatement);
            expect((statements[0] as ForEachStatement).target).instanceof(NullCoalescingExpression);
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

        it('uses the proper prefix when aliased package is installed', () => {
            program.setFile('source/roku_modules/rokucommunity_bslib/bslib.brs', '');
            testTranspile(`
                sub main()
                    a = user ?? false
                end sub
            `, `
                sub main()
                    a = user
                    if a = invalid then
                        a = false
                    end if
                end sub
            `);
        });

        it('properly transpiles null coalesence assignments - simple', () => {
            testTranspile(`
                sub main()
                    a = user ?? {"id": "default"}
                end sub
            `, `
                sub main()
                    a = user
                    if a = invalid then
                        a = {
                            "id": "default"
                        }
                    end if
                end sub
            `);
        });

        it('properly transpiles null coalesence assignments - complex consequent', () => {
            testTranspile(`
                sub main()
                    user = {}
                    a = user.getAccount() ?? {"id": "default"}
                end sub
            `, `
                sub main()
                    user = {}
                    a = (function(user)
                            __bsConsequent = user.getAccount()
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return {
                                    "id": "default"
                                }
                            end if
                        end function)(user)
                end sub
            `);
        });

        it('transpiles null coalesence assignment for variable alternate- complex consequent', () => {
            testTranspile(`
                sub main()
                    a = obj.link ?? false
                end sub
            `, `
                sub main()
                    a = (function(obj)
                            __bsConsequent = obj.link
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return false
                            end if
                        end function)(obj)
                end sub
            `);
        });

        it('does not capture restricted OS functions', () => {
            testTranspile(`
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
            `);
        });

        it('properly transpiles null coalesence assignments - complex alternate', () => {
            testTranspile(`
                sub main()
                    user = {}
                    settings = {}
                    a = user ?? m.defaults.getAccount(settings.name)
                end sub
            `, `
                sub main()
                    user = {}
                    settings = {}
                    a = (function(m, settings, user)
                            __bsConsequent = user
                            if __bsConsequent <> invalid then
                                return __bsConsequent
                            else
                                return m.defaults.getAccount(settings.name)
                            end if
                        end function)(m, settings, user)
                end sub
            `);
        });

        it('ignores enum variable names', () => {
            testTranspile(`
                enum Direction
                    up = "up"
                end enum
                sub main()
                    d = invalid
                    a = d ?? Direction.up
                end sub
            `, `
                sub main()
                    d = invalid
                    a = (function(d)
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

        it('ignores const variable names', () => {
            testTranspile(`
                const USER = "user"
                sub main()
                    settings = {}
                    a = m.defaults.getAccount(settings.name) ?? USER
                end sub
            `, `
                sub main()
                    settings = {}
                    a = (function(m, settings)
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

        it('transpiles null coalescing in RHS of AssignmentStatement to if statement', () => {
            testTranspile(`
                sub main()
                    a = user ?? {}
                end sub
            `, `
                sub main()
                    a = user
                    if a = invalid then
                        a = {}
                    end if
                end sub
            `);
        });

        it('transpiles null coalescing in RHS of incrementor AssignmentStatement to if statement', () => {
            testTranspile(`
                sub main()
                    a += user ?? 0
                end sub
            `, `
                sub main()
                    a += user
                    if a = invalid then
                        a += 0
                    end if
                end sub
            `);
        });

        it('transpiles null coalescing in RHS of DottedSetStatement to if statement', () => {
            testTranspile(`
                sub main()
                    m.a = user ?? {}
                end sub
            `, `
                sub main()
                    m.a = user
                    if m.a = invalid then
                        m.a = {}
                    end if
                end sub
            `);
        });

        it('transpiles null coalescing in RHS of incrementor DottedSetStatement to if statement', () => {
            testTranspile(`
                sub main()
                    m.a += user ?? 0
                end sub
            `, `
                sub main()
                    m.a += user
                    if m.a = invalid then
                        m.a += 0
                    end if
                end sub
            `);
        });

        it('transpiles null coalescing in RHS of IndexedSetStatement to if statement', () => {
            testTranspile(`
                sub main()
                    m["a"] = user ?? {}
                end sub
            `, `
                sub main()
                    m["a"] = user
                    if m["a"] = invalid then
                        m["a"] = {}
                    end if
                end sub
            `);
        });

        it('transpiles null coalescing in RHS of incrementor IndexedSetStatement to if statement', () => {
            testTranspile(`
                sub main()
                    m["a"] += user ?? 0
                end sub
            `, `
                sub main()
                    m["a"] += user
                    if m["a"] = invalid then
                        m["a"] += 0
                    end if
                end sub
            `);
        });

        it('supports nested null coalescing in assignment', () => {
            testTranspile(`
                sub main()
                    result = user ?? (fallback ?? {})
                end sub
            `, `
                sub main()
                    result = user
                    if result = invalid then
                        result = fallback
                        if result = invalid then
                            result = {}
                        end if
                    end if
                end sub
            `);
        });

        it('supports nested null coalescing in DottedSet', () => {
            testTranspile(`
                sub main()
                    m.result = user ?? (fallback ?? {})
                end sub
            `, `
                sub main()
                    m.result = user
                    if m.result = invalid then
                        m.result = fallback
                        if m.result = invalid then
                            m.result = {}
                        end if
                    end if
                end sub
            `);
        });

        it('supports nested null coalescing in IndexedSet', () => {
            testTranspile(`
                sub main()
                    m["result"] = user ?? (fallback ?? {})
                end sub
            `, `
                sub main()
                    m["result"] = user
                    if m["result"] = invalid then
                        m["result"] = fallback
                        if m["result"] = invalid then
                            m["result"] = {}
                        end if
                    end if
                end sub
            `);
        });

        it('uses scope-captured functions for complex expressions', () => {
            testTranspile(`
                sub main()
                    zombie = {}
                    result = [
                        zombie.getName() ?? "zombie"
                    ]
                end sub
            `, `
                sub main()
                    zombie = {}
                    result = [
                        (function(zombie)
                                __bsConsequent = zombie.getName()
                                if __bsConsequent <> invalid then
                                    return __bsConsequent
                                else
                                    return "zombie"
                                end if
                            end function)(zombie)
                    ]
                end sub
            `);
        });
    });
});
