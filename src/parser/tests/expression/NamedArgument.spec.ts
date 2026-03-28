import { expect } from '../../../chai-config.spec';
import { Program } from '../../../Program';
import { ParseMode, Parser } from '../../Parser';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, rootDir } from '../../../testHelpers.spec';
import { isNamedArgumentExpression } from '../../../astUtils/reflection';
import type { ExpressionStatement } from '../../Statement';
import type { CallExpression } from '../../Expression';

describe('named argument expressions', () => {

    describe('parsing', () => {
        it('parses a single named argument', () => {
            const { statements, diagnostics } = Parser.parse(
                'myFunc(paramOne: true)',
                { mode: ParseMode.BrighterScript }
            );
            expectZeroDiagnostics({ diagnostics: diagnostics });
            const call = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(call.args).to.be.lengthOf(1);
            expect(isNamedArgumentExpression(call.args[0])).to.be.true;
            expect((call.args[0] as any).name.text).to.equal('paramOne');
        });

        it('parses mixed positional and named arguments', () => {
            const { statements, diagnostics } = Parser.parse(
                'myFunc(first, paramThree: true)',
                { mode: ParseMode.BrighterScript }
            );
            expectZeroDiagnostics({ diagnostics: diagnostics });
            const call = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(call.args).to.be.lengthOf(2);
            expect(isNamedArgumentExpression(call.args[0])).to.be.false;
            expect(isNamedArgumentExpression(call.args[1])).to.be.true;
        });

        it('parses multiple named arguments', () => {
            const { statements, diagnostics } = Parser.parse(
                'myFunc(paramTwo: true, paramOne: false)',
                { mode: ParseMode.BrighterScript }
            );
            expectZeroDiagnostics({ diagnostics: diagnostics });
            const call = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(call.args).to.be.lengthOf(2);
            expect(isNamedArgumentExpression(call.args[0])).to.be.true;
            expect(isNamedArgumentExpression(call.args[1])).to.be.true;
        });

        it('does not treat identifier:value as named arg in BrightScript mode', () => {
            const { diagnostics } = Parser.parse(
                'myFunc(paramOne: true)',
                { mode: ParseMode.BrightScript }
            );
            // In BrightScript mode the colon is an unexpected token
            expect(diagnostics.length).to.be.greaterThan(0);
        });

        it('accepts complex expressions as named arg values', () => {
            const { statements, diagnostics } = Parser.parse(
                'myFunc(count: 1 + 2, name: "hello")',
                { mode: ParseMode.BrighterScript }
            );
            expectZeroDiagnostics({ diagnostics: diagnostics });
            const call = (statements[0] as ExpressionStatement).expression as CallExpression;
            expect(call.args).to.be.lengthOf(2);
        });
    });

    describe('validation', () => {
        let program: Program;

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });

        afterEach(() => {
            program.dispose();
        });

        it('validates a correctly named argument call', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(excited: true, name: "Bob")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('gives diagnostic for unknown named argument', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string)
                end sub
                sub main()
                    greet(nope: "Bob")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.unknownNamedArgument('nope', 'greet')
            ]);
        });

        it('gives diagnostic for duplicate named argument', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string)
                end sub
                sub main()
                    greet(name: "Bob", name: "Alice")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.namedArgDuplicate('name')
            ]);
        });

        it('gives diagnostic for positional arg after named arg', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(name: "Bob", true)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.positionalArgAfterNamedArg()
            ]);
        });

        it('gives diagnostic for named arg to unknown function', () => {
            program.setFile('source/main.bs', `
                sub main()
                    unknownFunc(param: true)
                end sub
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.namedArgsNotAllowedForUnknownFunction('unknownFunc')
            ]);
        });

        it('gives diagnostic for missing required parameter', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(excited: true)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount('2', 1)
            ]);
        });

        it('allows skipping middle optional params', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string, title = "Mr", excited = false)
                end sub
                sub main()
                    greet(name: "Bob", excited: true)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('transpilation', () => {
        let program: Program;
        let testTranspile = getTestTranspile(() => [program, rootDir]);

        beforeEach(() => {
            program = new Program({ rootDir: rootDir });
        });

        afterEach(() => {
            program.dispose();
        });

        it('reorders named args to positional order', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(excited: true, name: "Bob")
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                sub main()
                    greet("Bob", true)
                end sub
            `);
        });

        it('handles mixed positional and named args', () => {
            testTranspile(`
                sub greet(name as string, title as string, excited as boolean)
                end sub
                sub main()
                    greet("Bob", excited: true, title: "Mr")
                end sub
            `, `
                sub greet(name as string, title as string, excited as boolean)
                end sub

                sub main()
                    greet("Bob", "Mr", true)
                end sub
            `);
        });

        it('fills in default value for skipped middle optional param', () => {
            testTranspile(`
                sub greet(name as string, title = "Mr", excited = false)
                end sub
                sub main()
                    greet(name: "Bob", excited: true)
                end sub
            `, `
                sub greet(name as string, title = "Mr", excited = false)
                end sub

                sub main()
                    greet("Bob", "Mr", true)
                end sub
            `);
        });

        it('fills in invalid for skipped middle optional param with no default', () => {
            testTranspile(`
                sub greet(name as string, title = invalid, excited = false)
                end sub
                sub main()
                    greet(name: "Bob", excited: true)
                end sub
            `, `
                sub greet(name as string, title = invalid, excited = false)
                end sub

                sub main()
                    greet("Bob", invalid, true)
                end sub
            `);
        });

        it('does not reorder when all args are positional', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet("Bob", true)
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                sub main()
                    greet("Bob", true)
                end sub
            `);
        });
    });
});
