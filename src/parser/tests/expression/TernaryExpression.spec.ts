/* eslint-disable @typescript-eslint/no-for-in-array */
import { expect } from 'chai';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { TokenKind } from '../../../lexer';
import { Parser, ParseMode } from '../../Parser';
import { token, EOF } from '../Parser.spec';
import { BrsString, BrsBoolean } from '../../../brsTypes';
import { AssignmentStatement, ExpressionStatement, ForEachStatement } from '../../Statement';
import {
    AALiteralExpression,
    ArrayLiteralExpression,
    CallExpression,
    TernaryExpression,
    LiteralExpression
} from '../../Expression';
import { Program } from '../../../Program';
import { getTestTranspile } from '../../../files/BrsFile.spec';

describe('ternary expressions', () => {
    it('throws exception when used in brightscript scope', () => {
        let { diagnostics } = Parser.parse(`a = true ? "human" : "Zombie"`, { mode: ParseMode.BrightScript });
        expect(diagnostics[0]?.message).to.equal(DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('ternary operator').message);
    });

    it('cannot be used as a statement', () => {
        let { diagnostics } = Parser.parse([
            token(TokenKind.True, 'true', BrsBoolean.True),
            token(TokenKind.QuestionMark, '?'),
            token(TokenKind.StringLiteral, 'Human', new BrsString('Human')),
            token(TokenKind.Colon, ':'),
            token(TokenKind.StringLiteral, 'Zombie', new BrsString('Zombie')),
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
        expect(diagnostics).to.be.empty;
    });

    it(`supports function condition`, () => {
        let { statements, diagnostics } = parseBs(`a = user.getAccount() ? "logged in" : "not logged in"`);
        expect(statements[0]).to.be.instanceof(AssignmentStatement);
        expect((statements[0] as AssignmentStatement).value).to.be.instanceof(TernaryExpression);
        expect(diagnostics).to.be.empty;
    });

    it(`supports various tests with primitive values:`, () => {
        expect(parseBs(`result = true ? "human" : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = false ? "human" : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = len("person") = 10 ? "human" : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = m.getResponse() ? "human" : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = m.myZombies[3].hasEaten = true ? "human" : "zombie"`).diagnostics).to.be.empty;
    });

    it(`supports simple consequents`, () => {
        expect(parseBs(`result = true ? true : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? false : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? len("person") = 10 : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? m.getResponse() : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? m.myZombies[3].hasEaten = true : "zombie"`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? getZombieName : "zombie"`).diagnostics).to.be.empty;
    });

    it(`supports simple alternates`, () => {
        expect(parseBs(`result = true ? "zombie": true`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? "zombie": false`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? "zombie": len("person") = 10`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? "zombie": m.getResponse()`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? "zombie": m.myZombies[3].hasEaten = true`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? "zombie": getZombieName`).diagnostics).to.be.empty;
        expect(parseBs(`result = true ? "zombie": true`).diagnostics).to.be.empty;
    });

    describe('in assignment', () => {
        it(`simple case`, () => {
            let { statements, diagnostics } = parseBs(`a = true ? "human" : "zombie"`);
            expect(diagnostics).to.be.lengthOf(0);
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
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`single line assoc array`, () => {
            let { statements, diagnostics } = parseBs(`a = true ? {"a":"a"} : {}`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`multi line assoc array`, () => {
            let { statements, diagnostics } = parseBs(`
                a = true ? {"a":"a"} : {
                    "b": "test"
                }`
            );
            expect(diagnostics).to.be.empty;
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
            expect(diagnostics).to.be.lengthOf(0);
            expect(statements[0]).instanceof(AssignmentStatement);
        });

        it(`in func call with array args`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a.count() > 10 ? ["a","B"] : ["c", "d"])`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in func call with aa args`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a.count() > 10 ? {"a":1} : {"b": ["c", "d"]})`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in simple func call`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a = true ? "a" : "b")`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(1);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in func call with more args`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains(a = true ? "a" : "b", true, 12)`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
            expect(callExpression.args[0]).instanceof(TernaryExpression);
        });

        it(`in func call with more args, and comparing value`, () => {
            let { statements, diagnostics } = parseBs(`m.eatBrains((a = true ? "a" : "b").count() = 3, true, 12)`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ExpressionStatement);
            expect((statements[0] as ExpressionStatement).expression).instanceof(CallExpression);
            let callExpression = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(callExpression.args.length).to.equal(3);
        });

        it(`in array`, () => {
            let { statements, diagnostics } = parseBs(`a = [a = true ? {"a":"a"} : {"b":"b"}, "c"]`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(AssignmentStatement);
            expect((statements[0] as AssignmentStatement).value).instanceof(ArrayLiteralExpression);
            let literalExpression = (statements[0] as AssignmentStatement).value as ArrayLiteralExpression;
            expect(literalExpression.elements[0]).instanceOf(TernaryExpression);
            expect(literalExpression.elements[1]).instanceOf(LiteralExpression);
        });

        it(`in aa`, () => {
            let { statements, diagnostics } = parseBs(`a = {"v1": a = true ? {"a":"a"} : {"b":"b"}, "v2": "c"}`);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(AssignmentStatement);
            expect((statements[0] as AssignmentStatement).value).instanceof(AALiteralExpression);
            let literalExpression = (statements[0] as AssignmentStatement).value as AALiteralExpression;
            expect((literalExpression.elements[0] as any).key.value).is.equal('v1');
            expect((literalExpression.elements[0] as any).value).instanceOf(TernaryExpression);
            expect((literalExpression.elements[1] as any).key.value).is.equal('v2');
            expect((literalExpression.elements[1] as any).value).instanceOf(LiteralExpression);
        });

        it(`in for each`, () => {
            let { statements, diagnostics } = parseBs(
                `for each person in isZombieMode ? zombies : humans
                    ? "person is " ; person
                end for
            `);
            expect(diagnostics).to.be.empty;
            expect(statements[0]).instanceof(ForEachStatement);
            expect((statements[0] as ForEachStatement).target).instanceof(TernaryExpression);
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

        it('simple consequents', async () => {
            await testTranspile(
                `a = user = invalid ? "no user" : "logged in"`,
                `a = bslib_ternarySimple(user = invalid, "no user", "logged in")`
            );

            await testTranspile(
                `a = user = invalid ? 1 : "logged in"`,
                `a = bslib_ternarySimple(user = invalid, 1, "logged in")`
            );

            await testTranspile(
                `a = user = invalid ? 1.2 : "logged in"`,
                `a = bslib_ternarySimple(user = invalid, 1.2, "logged in")`
            );

            await testTranspile(
                `a = user = invalid ? [] : "logged in"`,
                `a = bslib_ternarySimple(user = invalid, [], "logged in")`
            );

            await testTranspile(
                `a = user = invalid ? {} : "logged in"`,
                `a = bslib_ternarySimple(user = invalid, {}, "logged in")`
            );
        });

        it('simple alternates', async () => {
            await testTranspile(
                `a = user = invalid ? "logged in" : "no user" `,
                `a = bslib_ternarySimple(user = invalid, "logged in", "no user")`
            );

            await testTranspile(
                `a = user = invalid ? "logged in" : 1 `,
                `a = bslib_ternarySimple(user = invalid, "logged in", 1)`
            );

            await testTranspile(
                `a = user = invalid ? "logged in" : 1.2 `,
                `a = bslib_ternarySimple(user = invalid, "logged in", 1.2)`
            );

            await testTranspile(
                `a = user = invalid ? "logged in" :  [] `,
                `a = bslib_ternarySimple(user = invalid, "logged in", [])`
            );

            await testTranspile(
                `a = user = invalid ? "logged in" :  {} `,
                `a = bslib_ternarySimple(user = invalid, "logged in", {})`
            );
        });

        it('complex conditions do not cause scope capture', async () => {
            await testTranspile(
                `a = IsTrue() = true ? true : false `,
                `a = bslib_ternarySimple(IsTrue() = true, true, false)`
            );

            await testTranspile(
                `a = m.top.service.IsTrue() ? true : false `,
                `a = bslib_ternarySimple(m.top.service.IsTrue(), true, false)`
            );

            await testTranspile(
                `a = First(second(third(fourth(m.fifth()[123].truthy(1))))) ? true : false `,
                `a = bslib_ternarySimple(First(second(third(fourth(m.fifth()[123].truthy(1))))), true, false)`
            );
        });

        it('captures scope for function call conseqent', async () => {
            await testTranspile(
                `name = zombie.getName() <> invalid ? zombie.GetName() : "zombie"`,
                `
                    name = (function(condition, zombie)
                            if condition then
                                return zombie.GetName()
                            else
                                return "zombie"
                            end if
                        end function)(zombie.getName() <> invalid, zombie)
                `
            );
        });

        it('captures scope for function call alternate', async () => {
            await testTranspile(
                `name = zombie.getName() = invalid ? "zombie" :  zombie.GetName()`,
                `
                    name = (function(condition, zombie)
                            if condition then
                                return "zombie"
                            else
                                return zombie.GetName()
                            end if
                        end function)(zombie.getName() = invalid, zombie)
                `
            );
        });

        it('captures scope for complex consequent', async () => {
            await testTranspile(
                `name = isLoggedIn ? m.defaults.getAccount(settings.name) : "no"`,
                `
                    name = (function(condition, m, settings)
                            if condition then
                                return m.defaults.getAccount(settings.name)
                            else
                                return "no"
                            end if
                        end function)(isLoggedIn, m, settings)
                `
            );
        });

        it('supports scope-captured outer, and simple inner', async () => {
            await testTranspile(
                `name = zombie <> invalid ? zombie.Attack(human <> invalid ? human: zombie) : "zombie"`,
                `
                    name = (function(condition, human, zombie)
                            if condition then
                                return zombie.Attack(bslib_ternarySimple(human <> invalid, human, zombie))
                            else
                                return "zombie"
                            end if
                        end function)(zombie <> invalid, human, zombie)
                `
            );
        });

        it('uses scope capture for property access', async () => {
            await testTranspile(
                `name = person <> invalid ? person.name : "John Doe"`,
                `
                    name = (function(condition, person)
                            if condition then
                                return person.name
                            else
                                return "John Doe"
                            end if
                        end function)(person <> invalid, person)
                `
            );
        });

    });
});

function parseBs(text: string) {
    return Parser.parse(text, { mode: ParseMode.BrighterScript });
}
