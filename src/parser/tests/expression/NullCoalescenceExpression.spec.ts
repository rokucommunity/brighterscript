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
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expectDiagnosticsIncludes(diagnostics, DiagnosticMessages.unexpectedToken('??').code);
                expect(statements).not.to.be.empty;
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
                let { statements, diagnostics } = Parser.parse(tokens, { mode: ParseMode.BrighterScript });
                expect(diagnostics).to.be.empty;
                expect(statements[0]).instanceof(AssignmentStatement);
                expect((statements[0] as AssignmentStatement).value).instanceof(NullCoalescingExpression);
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

        it('uses the proper prefix when aliased package is installed', async () => {
            program.setFile('source/roku_modules/rokucommunity_bslib/bslib.brs', '');
            await testTranspile(`
                sub main()
                    a = user ?? false
                end sub
            `, `
                sub main()
                    a = rokucommunity_bslib_coalesce(user, false)
                end sub
            `);
        });

        it('properly transpiles null coalesence assignments - simple', async () => {
            await testTranspile(`
                sub main()
                    a = user ?? {"id": "default"}
                end sub
            `, `
                sub main()
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

        it('transpiles null coalesence assignment for variable alternate- complex consequent', async () => {
            await testTranspile(`
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
    });
});
