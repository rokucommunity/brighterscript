/* eslint-disable @typescript-eslint/no-for-in-array */
import { expect } from '../../../chai-config.spec';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { TokenKind } from '../../../lexer/TokenKind';
import { Parser, ParseMode } from '../../Parser';
import { token, EOF } from '../Parser.spec';
import type { PrintStatement } from '../../Statement';
import { AssignmentStatement, ExpressionStatement, ForEachStatement } from '../../Statement';
import type {
    AAMemberExpression
} from '../../Expression';
import {
    AALiteralExpression,
    ArrayLiteralExpression,
    CallExpression,
    TernaryExpression,
    LiteralExpression
} from '../../Expression';
import { Program } from '../../../Program';
import { expectZeroDiagnostics, getTestTranspile } from '../../../testHelpers.spec';

describe('ternary expressions', () => {
    it('throws exception when used in brightscript scope', () => {
        let { diagnostics } = Parser.parse(`a = true ? "human" : "Zombie"`, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.message).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('ternary operator').message);
    });

    it('cannot be used as a statement', () => {
        let { diagnostics } = Parser.parse([
            token(TokenKind.True, 'true'),
            token(TokenKind.Question, '?'),
            token(TokenKind.StringLiteral, 'Human'),
            token(TokenKind.Colon, ':'),
            token(TokenKind.StringLiteral, 'Zombie'),
            EOF
        ], { mode: ParseMode.BrighterScript });

        expect(diagnostics).not.to.be.empty;
    });

    it(`cannot be used as a statement`, () => {
        expect(parseBs(`true ? true : "zombie"`).diagnostics).not.to.be.empty;
        expect(parseBs(`false ? true : "zombie"`).diagnostics).not.to.be.empty;
        expect(parseBs(`len("person") = 10 ? true : "zombie"`).diagnostics).not.to.be.empty;
        expect(parseBs(`m.getResponse() ? true : "zombie"`).diagnostics).not.to.be.empty;
    });

    it(`supports boolean expression condition`, () => {
        let { statements, diagnostics } = parseBs(`being = isZombie = false ? "human" : "zombie"`);
        expect(statements[0]).to.be.instanceof(AssignmentStatement);
        expect((statements[0] as AssignmentStatement).value).to.be.instanceof(TernaryExpression);
        expectZeroDiagnostics(diagnostics);
    });

    it(`supports function condition`, () => {
        let { statements, diagnostics } = parseBs(`a = user.getAccount() ? "logged in" : "not logged in"`);
        expect(statements[0]).to.be.instanceof(AssignmentStatement);
        expect((statements[0] as AssignmentStatement).value).to.be.instanceof(TernaryExpression);
        expectZeroDiagnostics(diagnostics);
    });

    it(`supports various tests with primitive values:`, () => {
        expectZeroDiagnostics(parseBs(`result = true ? "human" : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = false ? "human" : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = len("person") = 10 ? "human" : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = m.getResponse() ? "human" : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = m.myZombies[3].hasEaten = true ? "human" : "zombie"`));
    });

    it(`supports simple consequents`, () => {
        expectZeroDiagnostics(parseBs(`result = true ? true : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = true ? false : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = true ? len("person") = 10 : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = true ? m.getResponse() : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = true ? m.myZombies[3].hasEaten = true : "zombie"`));
        expectZeroDiagnostics(parseBs(`result = true ? getZombieName : "zombie"`));
    });

    it(`supports simple alternates`, () => {
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": true`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": false`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": len("person") = 10`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": m.getResponse()`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": m.myZombies[3].hasEaten = true`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": getZombieName`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": true`));
    });

    it('supports multi-line and comments', () => {
        expectZeroDiagnostics(parseBs(`result = true ? \n"zombie"\n: \ntrue`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie"\n: \ntrue`));
        expectZeroDiagnostics(parseBs(`result = true ? \n"zombie": \ntrue`));
        expectZeroDiagnostics(parseBs(`result = true ? \n"zombie"\n: true`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie"\n: \ntrue`));
        expectZeroDiagnostics(parseBs(`result = true ? "zombie": \ntrue`));
        expectZeroDiagnostics(parseBs(`result = true ? \n\n\n"zombie": \n\n\n\ntrue`));
        //with comments
        expectZeroDiagnostics(parseBs(`result = true ?'comment\n"zombie"'comment\n:'comment\nntrue`));
    });

    describe('in assignment', () => {
        it(`simple case`, () => {
            let { statements, diagnostics } = parseBs(`a = true ? "human" : "zombie"`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line arrays case`, () => {
            let { statements, diagnostics } = parseBs(`
                a = true ? [
                        "one"
                        "two"
                        "three"
                    ] : [
                        "one"
                        "two"
                        "three"
                    ]
            `);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`single line assoc array`, () => {
            let { statements, diagnostics } = parseBs(`a = true ? {"a":"a"} : {}`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line assoc array`, () => {
            let { statements, diagnostics } = parseBs(`
                a = true ? {"a":"a"} : {
                    "b": "test"
                }`
            );
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line assoc array - both sides`, () => {
            let { statements, diagnostics } = parseBs(`
                a = true ? {
                        "a":"a"
                        "b":"b"
                    } : {
                        "b": "test"
                    }
            `);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`in func call with array args`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a.count() > 10 ? ["a","B"] : ["c", "d"])`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in func call with aa args`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a.count() > 10 ? {"a":1} : {"b": ["c", "d"]})`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in simple func call`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a = true ? "a" : "b")`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in func call with more args`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a = true ? "a" : "b", true, 12)`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in func call with more args, and comparing value`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains((a = true ? "a" : "b").count() = 3, true, 12)`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
        });

        it(`in array`, () => {
            let { statements, diagnostics } = parseBs(`a = [a = true ? {"a":"a"} : {"b":"b"}, "c"]`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
            expect((statements[0] as AssignmentStatement).value).instanceof(ArrayLiteralExpression);
            let literalExpression = (statements[0] as AssignmentStatement).value as ArrayLiteralExpression;
            expect(literalExpression.elements[0]).instanceOf(TernaryExpression);
            expect(literalExpression.elements[1]).instanceOf(LiteralExpression);
        });

        it(`in aa`, () => {
            let { statements, diagnostics } = parseBs(`a = {"v1": a = true ? {"a":"a"} : {"b":"b"}, "v2": "c"}`);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(AssignmentStatement);
            expect((statements[0] as AssignmentStatement).value).instanceof(AALiteralExpression);
            let literalExpression = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            expect((literalExpression.elements[0] as AAMemberExpression).keyToken.text).is.equal('"v1"');
            expect((literalExpression.elements[0] as any).value).instanceOf(TernaryExpression);
            expect((literalExpression.elements[1] as AAMemberExpression).keyToken.text).is.equal('"v2"');
            expect((literalExpression.elements[1] as any).value).instanceOf(LiteralExpression);
        });

        it(`in for each`, () => {
            let { statements, diagnostics } = parseBs(
                `for each person in isZombieMode ? zombies : humans
                    ? "person is " ; person
                end for
            `);
            expectZeroDiagnostics(diagnostics);
            expect(statements[0]).instanceof(ForEachStatement);
            expect((statements[0] as ForEachStatement).target).instanceof(TernaryExpression);
        });

        it('creates TernaryExpression with missing alternate', () => {
            const { statements } = parseBs(`
                print name = "bob" ? "human":
            `);
            const expr = (statements[0] as PrintStatement).expressions[0];
            expect(expr).to.be.instanceof(TernaryExpression);
            expect(expr).property('alternate').to.be.undefined;
            expect(expr).property('consequent').not.to.be.undefined;
        });

        it('creates TernaryExpression with missing consequent', () => {
            const { statements } = parseBs(`
                print name = "bob" ? : "human"
            `);
            const expr = (statements[0] as PrintStatement).expressions[0];
            expect(expr).to.be.instanceof(TernaryExpression);
            expect(expr).property('consequent').to.be.undefined;
            expect(expr).property('alternate').not.to.be.undefined;
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

        it('transpiles top-level ternary expression', () => {
            testTranspile(`
                a += true ? 1 : 2
            `, `
                if true then
                    a += 1
                else
                    a += 2
                end if
            `, undefined, undefined, false);
        });

        it('transpiles ternary in RHS of AssignmentStatement to IfStatement', () => {
            testTranspile(`
                sub main()
                    a = true ? 1 : 2
                end sub
            `, `
                sub main()
                    if true then
                        a = 1
                    else
                        a = 2
                    end if
                end sub
            `);
        });

        it('transpiles ternary in RHS of incrementor AssignmentStatement to IfStatement', () => {
            testTranspile(`
                sub main()
                    a += true ? 1 : 2
                end sub
            `, `
                sub main()
                    if true then
                        a += 1
                    else
                        a += 2
                    end if
                end sub
            `);
        });

        it('transpiles ternary in RHS of DottedSetStatement to IfStatement', () => {
            testTranspile(`
                sub main()
                    m.a = true ? 1 : 2
                end sub
            `, `
                sub main()
                    if true then
                        m.a = 1
                    else
                        m.a = 2
                    end if
                end sub
            `);
        });

        it('transpiles ternary in RHS of incrementor DottedSetStatement to IfStatement', () => {
            testTranspile(`
                sub main()
                    m.a += true ? 1 : 2
                end sub
            `, `
                sub main()
                    if true then
                        m.a += 1
                    else
                        m.a += 2
                    end if
                end sub
            `);
        });

        it('transpiles ternary in RHS of IndexedSetStatement to IfStatement', () => {
            testTranspile(`
                sub main()
                    m["a"] = true ? 1 : 2
                end sub
            `, `
                sub main()
                    if true then
                        m["a"] = 1
                    else
                        m["a"] = 2
                    end if
                end sub
            `);
        });

        it('transpiles ternary in RHS of incrementor IndexedSetStatement to IfStatement', () => {
            testTranspile(`
                sub main()
                    m["a"] += true ? 1 : 2
                end sub
            `, `
                sub main()
                    if true then
                        m["a"] += 1
                    else
                        m["a"] += 2
                    end if
                end sub
            `);
        });

        it('uses the proper prefix when aliased package is installed', () => {
            program.setFile('source/roku_modules/rokucommunity_bslib/bslib.brs', '');
            testTranspile(`
                sub main()
                    user = {}
                    result = [
                        user = invalid ? "no user" : "logged in"
                    ]
                end sub
            `, `
                sub main()
                    user = {}
                    result = [
                        rokucommunity_bslib_ternary(user = invalid, "no user", "logged in")
                    ]
                end sub
            `);
        });

        it('simple consequents', () => {
            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "no user" : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = "no user"
                    else
                        a = "logged in"
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? 1 : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = 1
                    else
                        a = "logged in"
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? 1.2 : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = 1.2
                    else
                        a = "logged in"
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? {} : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = {}
                    else
                        a = "logged in"
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? [] : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = []
                    else
                        a = "logged in"
                    end if
                end sub
            `);
        });

        it('simple alternates', () => {
            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" : "no user"
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = "logged in"
                    else
                        a = "no user"
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" : 1
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = "logged in"
                    else
                        a = 1
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" : 1.2
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = "logged in"
                    else
                        a = 1.2
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" :  []
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = "logged in"
                    else
                        a = []
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" :  {}
                end sub
            `, `
                sub main()
                    user = {}
                    if user = invalid then
                        a = "logged in"
                    else
                        a = {}
                    end if
                end sub
            `);
        });

        it('does not capture restricted OS functions', () => {
            testTranspile(`
                sub main()
                    test(true ? invalid : [
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
                    test((function(__bsCondition)
                            if __bsCondition then
                                return invalid
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
                        end function)(true))
                end sub

                sub test(p1)
                end sub
            `);
        });

        it('complex conditions do not cause scope capture', () => {
            testTranspile(`
                sub main()
                    a = str("true") = "true" ? true : false
                end sub
            `, `
                sub main()
                    if str("true") = "true" then
                        a = true
                    else
                        a = false
                    end if
                end sub
            `);

            testTranspile(`
                sub main()
                    a = m.top.service.IsTrue() ? true : false
                end sub
            `, `
                sub main()
                    if m.top.service.IsTrue() then
                        a = true
                    else
                        a = false
                    end if
                end sub
            `);

            testTranspile(`
                sub test(param1)
                end sub

                sub main()
                    a = test(test(test(test(m.fifth()[123].truthy(1))))) ? true : false
                end sub
            `, `
                sub test(param1)
                end sub

                sub main()
                    if test(test(test(test(m.fifth()[123].truthy(1))))) then
                        a = true
                    else
                        a = false
                    end if
                end sub
            `);
        });

        it('captures scope for function call conseqent', () => {
            testTranspile(`
                sub main()
                    zombie = {}
                    result = [
                        zombie.getName() <> invalid ? zombie.GetName() : "zombie"
                    ]
                end sub
            `, `
                sub main()
                    zombie = {}
                    result = [
                        (function(__bsCondition, zombie)
                                if __bsCondition then
                                    return zombie.GetName()
                                else
                                    return "zombie"
                                end if
                            end function)(zombie.getName() <> invalid, zombie)
                    ]
                end sub
            `);
        });

        it('captures scope for function call alternate', () => {
            testTranspile(`
                sub main()
                    zombie = {}
                    result = [
                        zombie.getName() = invalid ? "zombie" :  zombie.GetName()
                    ]
                end sub
            `, `
                sub main()
                    zombie = {}
                    result = [
                        (function(__bsCondition, zombie)
                                if __bsCondition then
                                    return "zombie"
                                else
                                    return zombie.GetName()
                                end if
                            end function)(zombie.getName() = invalid, zombie)
                    ]
                end sub
            `);
        });

        it('captures scope for complex consequent', () => {
            testTranspile(`
                sub main()
                    settings = {}
                    result = [
                        {} ? m.defaults.getAccount(settings.name) : "no"
                    ]
                end sub
            `, `
                sub main()
                    settings = {}
                    result = [
                        (function(__bsCondition, m, settings)
                                if __bsCondition then
                                    return m.defaults.getAccount(settings.name)
                                else
                                    return "no"
                                end if
                            end function)({}, m, settings)
                    ]
                end sub
            `);
        });

        it('ignores enum variable names for scope capturing', () => {
            testTranspile(`
                enum Direction
                    up = "up"
                    down = "down"
                end enum
                sub main()
                    d = Direction.up
                    result = [
                        d = Direction.up ? Direction.up : false
                    ]
                end sub
            `, `
                sub main()
                    d = "up"
                    result = [
                        (function(__bsCondition)
                                if __bsCondition then
                                    return "up"
                                else
                                    return false
                                end if
                            end function)(d = "up")
                    ]
                end sub
            `);
        });

        it('ignores const variable names for scope capturing', () => {
            testTranspile(`
                enum Direction
                    up = "up"
                    down = "down"
                end enum
                const UP = "up"
                sub main()
                    d = Direction.up
                    result = [
                        d = Direction.up ? UP : Direction.down
                    ]
                end sub
            `, `
                sub main()
                    d = "up"
                    result = [
                        (function(__bsCondition)
                                if __bsCondition then
                                    return "up"
                                else
                                    return "down"
                                end if
                            end function)(d = "up")
                    ]
                end sub
            `);
        });

        it('supports scope-captured outer, and simple inner', () => {
            testTranspile(
                `
                    sub main()
                        zombie = {}
                        human = {}
                        result = zombie <> invalid ? zombie.Attack(human <> invalid ? human: zombie) : "zombie"
                    end sub
                `,
                `
                    sub main()
                        zombie = {}
                        human = {}
                        if zombie <> invalid then
                            result = zombie.Attack(bslib_ternary(human <> invalid, human, zombie))
                        else
                            result = "zombie"
                        end if
                    end sub
                `
            );
        });

        it('supports nested ternary in assignment', () => {
            testTranspile(
                `
                    sub main()
                        result = true ? (false ? "one" : "two") : "three"
                    end sub
                `,
                `
                    sub main()
                        if true then
                            if false then
                                result = "one"
                            else
                                result = "two"
                            end if
                        else
                            result = "three"
                        end if
                    end sub
                `
            );
        });

        it('supports nested ternary in DottedSet', () => {
            testTranspile(
                `
                    sub main()
                        m.result = true ? (false ? "one" : "two") : "three"
                    end sub
                `,
                `
                    sub main()
                        if true then
                            if false then
                                m.result = "one"
                            else
                                m.result = "two"
                            end if
                        else
                            m.result = "three"
                        end if
                    end sub
                `
            );
        });

        it('supports nested ternary in IndexedSet', () => {
            testTranspile(
                `
                    sub main()
                        m["result"] = true ? (false ? "one" : "two") : "three"
                    end sub
                `,
                `
                    sub main()
                        if true then
                            if false then
                                m["result"] = "one"
                            else
                                m["result"] = "two"
                            end if
                        else
                            m["result"] = "three"
                        end if
                    end sub
                `
            );
        });

        it('supports ternary in indexedSet key', () => {
            testTranspile(
                `
                    sub main()
                        m[m.isShiftPressed ? "a" : "b"] = 0
                        m[m.useAltKey ? m.altKey : m.key] = 1
                    end sub
                `,
                `
                    sub main()
                        m[bslib_ternary(m.isShiftPressed, "a", "b")] = 0
                        m[(function(__bsCondition, m)
                                if __bsCondition then
                                    return m.altKey
                                else
                                    return m.key
                                end if
                            end function)(m.useAltKey, m)] = 1
                    end sub
                `
            );
        });

        it('supports scope-captured outer, and simple inner', () => {
            testTranspile(
                `
                    sub main()
                        zombie = {}
                        human = {}
                        result = [
                            zombie <> invalid ? zombie.Attack(human <> invalid ? human: zombie) : "zombie"
                        ]
                    end sub
                `,
                `
                    sub main()
                        zombie = {}
                        human = {}
                        result = [
                            (function(__bsCondition, human, zombie)
                                    if __bsCondition then
                                        return zombie.Attack(bslib_ternary(human <> invalid, human, zombie))
                                    else
                                        return "zombie"
                                    end if
                                end function)(zombie <> invalid, human, zombie)
                        ]
                    end sub
                `
            );
        });

        it('uses scope capture for property access', () => {
            testTranspile(
                `
                    sub main()
                        person = {}
                        result = [
                            person <> invalid ? person.name : "John Doe"
                        ]
                    end sub
                    `,
                `
                    sub main()
                        person = {}
                        result = [
                            (function(__bsCondition, person)
                                    if __bsCondition then
                                        return person.name
                                    else
                                        return "John Doe"
                                    end if
                                end function)(person <> invalid, person)
                        ]
                    end sub
                `
            );
        });

        it('uses `invalid` in place of missing consequent ', () => {
            testTranspile(
                `print name = "bob" ? :"zombie"`,
                `print bslib_ternary(name = "bob", invalid, "zombie")`
                , 'none', undefined, false);
        });

        it('uses `invalid` in place of missing alternate ', () => {
            testTranspile(
                `print name = "bob" ? "human"`,
                `print bslib_ternary(name = "bob", "human", invalid)`
                , 'none', undefined, false);
        });

        it('uses `invalid` in place of missing alternate and consequent ', () => {
            testTranspile(
                `print name = "bob" ?:`,
                `print bslib_ternary(name = "bob", invalid, invalid)`
                , 'none', undefined, false);
        });
    });
});

function parseBs(text: string) {
    return Parser.parse(text, { mode: ParseMode.BrighterScript });
}
