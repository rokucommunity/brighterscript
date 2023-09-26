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

    describe('transpilation', () => {
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
                sub main()
                    user = {}
                    a = user = invalid ? "no user" : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    a = rokucommunity_bslib_ternary(user = invalid, "no user", "logged in")
                end sub
            `);
        });

        it('simple consequents', async () => {
            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "no user" : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, "no user", "logged in")
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? 1 : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, 1, "logged in")
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? 1.2 : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, 1.2, "logged in")
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? {} : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, {}, "logged in")
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? [] : "logged in"
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, [], "logged in")
                end sub
            `);
        });

        it('simple alternates', async () => {
            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" : "no user"
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, "logged in", "no user")
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" : 1
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, "logged in", 1)
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" : 1.2
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, "logged in", 1.2)
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" :  []
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, "logged in", [])
                end sub
            `);

            await testTranspile(`
                sub main()
                    user = {}
                    a = user = invalid ? "logged in" :  {}
                end sub
            `, `
                sub main()
                    user = {}
                    a = bslib_ternary(user = invalid, "logged in", {})
                end sub
            `);
        });

        it('complex conditions do not cause scope capture', async () => {
            await testTranspile(`
                sub main()
                    a = str(123) = "123" ? true : false
                end sub
            `, `
                sub main()
                    a = bslib_ternary(str(123) = "123", true, false)
                end sub
            `);

            await testTranspile(`
                sub main()
                    a = m.top.service.IsTrue() ? true : false
                end sub
            `, `
                sub main()
                    a = bslib_ternary(m.top.service.IsTrue(), true, false)
                end sub
            `);

            await testTranspile(`
                sub test(param1)
                end sub

                sub main()
                    a = test(test(test(test(m.fifth()[123].truthy(1))))) ? true : false
                end sub
            `, `
                sub test(param1)
                end sub

                sub main()
                    a = bslib_ternary(test(test(test(test(m.fifth()[123].truthy(1))))), true, false)
                end sub
            `);
        });

        it('captures scope for function call conseqent', async () => {
            await testTranspile(`
                sub main()
                    zombie = {}
                    name = zombie.getName() <> invalid ? zombie.GetName() : "zombie"
                end sub
            `, `
                sub main()
                    zombie = {}
                    name = (function(__bsCondition, zombie)
                            if __bsCondition then
                                return zombie.GetName()
                            else
                                return "zombie"
                            end if
                        end function)(zombie.getName() <> invalid, zombie)
                end sub
            `);
        });

        it('captures scope for function call alternate', async () => {
            await testTranspile(`
                sub main()
                    zombie = {}
                    name = zombie.getName() = invalid ? "zombie" :  zombie.GetName()
                end sub
            `, `
                sub main()
                    zombie = {}
                    name = (function(__bsCondition, zombie)
                            if __bsCondition then
                                return "zombie"
                            else
                                return zombie.GetName()
                            end if
                        end function)(zombie.getName() = invalid, zombie)
                end sub
            `);
        });

        it('captures scope for complex consequent', async () => {
            await testTranspile(`
                sub main()
                    settings = {}
                    name = {} ? m.defaults.getAccount(settings.name) : "no"
                end sub
            `, `
                sub main()
                    settings = {}
                    name = (function(__bsCondition, m, settings)
                            if __bsCondition then
                                return m.defaults.getAccount(settings.name)
                            else
                                return "no"
                            end if
                        end function)({}, m, settings)
                end sub
            `);
        });

        it('supports scope-captured outer, and simple inner', async () => {
            await testTranspile(
                `
                    sub main()
                        zombie = {}
                        human = {}
                        name = zombie <> invalid ? zombie.Attack(human <> invalid ? human: zombie) : "zombie"
                    end sub
                `,
                `
                    sub main()
                        zombie = {}
                        human = {}
                        name = (function(__bsCondition, human, zombie)
                                if __bsCondition then
                                    return zombie.Attack(bslib_ternary(human <> invalid, human, zombie))
                                else
                                    return "zombie"
                                end if
                            end function)(zombie <> invalid, human, zombie)
                    end sub
                `
            );
        });

        it('uses scope capture for property access', async () => {
            await testTranspile(
                `
                    sub main()
                        person = {}
                        name = person <> invalid ? person.name : "John Doe"
                    end sub
                    `,
                `
                    sub main()
                        person = {}
                        name = (function(__bsCondition, person)
                                if __bsCondition then
                                    return person.name
                                else
                                    return "John Doe"
                                end if
                            end function)(person <> invalid, person)
                    end sub
                `
            );
        });

        it('uses `invalid` in place of missing consequent ', async () => {
            await testTranspile(
                `print name = "bob" ? :"zombie"`,
                `print bslib_ternary(name = "bob", invalid, "zombie")`
                , 'none', undefined, false);
        });

        it('uses `invalid` in place of missing alternate ', async () => {
            await testTranspile(
                `print name = "bob" ? "human"`,
                `print bslib_ternary(name = "bob", "human", invalid)`
                , 'none', undefined, false);
        });

        it('uses `invalid` in place of missing alternate and consequent ', async () => {
            await testTranspile(
                `print name = "bob" ?:`,
                `print bslib_ternary(name = "bob", invalid, invalid)`
                , 'none', undefined, false);
        });

    });
});

function parseBs(text: string) {
    return Parser.parse(text, { mode: ParseMode.BrighterScript });
}
