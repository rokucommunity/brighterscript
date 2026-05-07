import { expect } from '../../../chai-config.spec';
import { Program } from '../../../Program';
import { ParseMode, Parser } from '../../Parser';
import { DiagnosticMessages } from '../../../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, rootDir, trim } from '../../../testHelpers.spec';
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
                    greet(name: "Bob", excited: true)
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

        it('gives diagnostic when named args are out of declaration order', () => {
            program.setFile('source/main.bs', `
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(excited: true, name: "Bob")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.namedArgOutOfOrder('name')
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

        describe('namespace calls', () => {
            it('validates a correctly named argument call to a namespace function', () => {
                program.setFile('source/main.bs', `
                    namespace MyNs
                        sub greet(name as string, excited as boolean)
                        end sub
                    end namespace
                    sub main()
                        MyNs.greet(name: "Bob", excited: true)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('gives diagnostic for unknown named argument on a namespace function', () => {
                program.setFile('source/main.bs', `
                    namespace MyNs
                        sub greet(name as string)
                        end sub
                    end namespace
                    sub main()
                        MyNs.greet(nope: "Bob")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.unknownNamedArgument('nope', 'MyNs_greet')
                ]);
            });

            it('gives diagnostic for named args on a non-namespace dotted call', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        obj = {}
                        obj.method(name: "Bob")
                    end sub
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.namedArgsNotAllowedForUnknownFunction('method')
                ]);
            });
        });

        describe('constructor calls', () => {
            it('validates correctly named argument call to a class constructor', () => {
                program.setFile('source/main.bs', `
                    class Point
                        x as integer
                        y as integer
                        function new(x as integer, y as integer)
                            m.x = x
                            m.y = y
                        end function
                    end class
                    sub main()
                        p = new Point(x: 1, y: 2)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('gives diagnostic for unknown named argument on a constructor', () => {
                program.setFile('source/main.bs', `
                    class Point
                        x as integer
                        y as integer
                        function new(x as integer, y as integer)
                        end function
                    end class
                    sub main()
                        p = new Point(z: 99)
                    end sub
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.unknownNamedArgument('z', 'Point')
                ]);
            });

            it('gives diagnostic for missing required constructor parameter', () => {
                program.setFile('source/main.bs', `
                    class Point
                        x as integer
                        y as integer
                        function new(x as integer, y as integer)
                        end function
                    end class
                    sub main()
                        p = new Point(x: 1)
                    end sub
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.mismatchArgumentCount('2', 1)
                ]);
            });

            it('uses inherited constructor params when subclass has no constructor', () => {
                program.setFile('source/main.bs', `
                    class Shape
                        color as string
                        function new(color as string)
                            m.color = color
                        end function
                    end class
                    class Circle extends Shape
                    end class
                    sub main()
                        c = new Circle(color: "red")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        describe('cross-scope conflict', () => {
            it('gives diagnostic when same function name has different parameter signatures across component scopes', () => {
                // shared.bs calls foo() with named args; each component imports a different
                // definition of foo() with the same param names but in different order.
                program.setFile('components/shared.bs', `
                    sub callFoo()
                        foo(a: 2, b: 1)
                    end sub
                `);
                program.setFile('components/helperA.bs', `
                    sub foo(a, b)
                    end sub
                `);
                program.setFile('components/helperB.bs', `
                    sub foo(b, a)
                    end sub
                `);
                program.setFile('components/CompA.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="CompA" extends="Scene">
                        <script type="text/brightscript" uri="shared.bs" />
                        <script type="text/brightscript" uri="helperA.bs" />
                    </component>
                `);
                program.setFile('components/CompB.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="CompB" extends="Scene">
                        <script type="text/brightscript" uri="shared.bs" />
                        <script type="text/brightscript" uri="helperB.bs" />
                    </component>
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    DiagnosticMessages.namedArgsCrossScopeConflict('foo')
                ]);
            });

            it('includes relatedInformation pointing to each conflicting function definition', () => {
                program.setFile('components/shared.bs', `
                    sub callFoo()
                        foo(a: 2, b: 1)
                    end sub
                `);
                program.setFile('components/helperA.bs', `
                    sub foo(a, b)
                    end sub
                `);
                program.setFile('components/helperB.bs', `
                    sub foo(b, a)
                    end sub
                `);
                program.setFile('components/CompA.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="CompA" extends="Scene">
                        <script type="text/brightscript" uri="shared.bs" />
                        <script type="text/brightscript" uri="helperA.bs" />
                    </component>
                `);
                program.setFile('components/CompB.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="CompB" extends="Scene">
                        <script type="text/brightscript" uri="shared.bs" />
                        <script type="text/brightscript" uri="helperB.bs" />
                    </component>
                `);
                program.validate();
                expectDiagnosticsIncludes(program, [
                    {
                        ...DiagnosticMessages.namedArgsCrossScopeConflict('foo'),
                        relatedInformation: [
                            { message: `'foo' defined in scope 'components/CompA.xml'` },
                            { message: `'foo' defined in scope 'components/CompB.xml'` }
                        ]
                    }
                ]);
            });

            it('does not give cross-scope diagnostic when all scopes agree on the parameter signature', () => {
                program.setFile('components/shared.bs', `
                    sub callFoo()
                        foo(a: 2, b: 1)
                    end sub
                `);
                program.setFile('components/helperA.bs', `
                    sub foo(a, b)
                    end sub
                `);
                program.setFile('components/helperB.bs', `
                    sub foo(a, b)
                    end sub
                `);
                program.setFile('components/CompA.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="CompA" extends="Scene">
                        <script type="text/brightscript" uri="shared.bs" />
                        <script type="text/brightscript" uri="helperA.bs" />
                    </component>
                `);
                program.setFile('components/CompB.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="CompB" extends="Scene">
                        <script type="text/brightscript" uri="shared.bs" />
                        <script type="text/brightscript" uri="helperB.bs" />
                    </component>
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
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

        it('transpiles in-order named args to positional args', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(name: "Bob", excited: true)
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                sub main()
                    greet("Bob", true)
                end sub
            `);
        });

        it('fills skipped leading optional params', () => {
            testTranspile(`
                sub greet(name = "Unknown" as string, excited = false as boolean)
                end sub
                sub main()
                    greet(excited: true)
                end sub
            `, `
                sub greet(name = "Unknown" as string, excited = false as boolean)
                end sub

                sub main()
                    greet("Unknown", true)
                end sub
            `);
        });

        it('handles mixed positional and named args in declaration order', () => {
            testTranspile(`
                sub greet(name as string, title = "Mr" as string, excited = false as boolean)
                end sub
                sub main()
                    greet("Bob", excited: true)
                end sub
            `, `
                sub greet(name as string, title = "Mr" as string, excited = false as boolean)
                end sub

                sub main()
                    greet("Bob", "Mr", true)
                end sub
            `);
        });
    });
});
