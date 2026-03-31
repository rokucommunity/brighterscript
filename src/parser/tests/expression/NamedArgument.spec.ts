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

        describe('namespace calls', () => {
            it('validates a correctly named argument call to a namespace function', () => {
                program.setFile('source/main.bs', `
                    namespace MyNs
                        sub greet(name as string, excited as boolean)
                        end sub
                    end namespace
                    sub main()
                        MyNs.greet(excited: true, name: "Bob")
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
                        p = new Point(y: 2, x: 1)
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
                        foo(b: 1, a: 2)
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
                        foo(b: 1, a: 2)
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
                        foo(b: 1, a: 2)
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

        it('does not hoist variable or literal named args — just reorders them', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    myName = "Bob"
                    greet(excited: true, name: myName)
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                sub main()
                    myName = "Bob"
                    greet(myName, true)
                end sub
            `);
        });

        it('hoists a complex named arg expression to preserve evaluation order', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    greet(excited: true, name: getName())
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    __bsArgs0 = getName()
                    greet(__bsArgs0, true)
                end sub
            `);
        });

        it('hoists multiple complex named args in written order', () => {
            testTranspile(`
                sub greet(name as string, greeting as string)
                end sub
                function getName() as string
                    return "Bob"
                end function
                function getGreeting() as string
                    return "Hello"
                end function
                sub main()
                    greet(greeting: getGreeting(), name: getName())
                end sub
            `, `
                sub greet(name as string, greeting as string)
                end sub

                function getName() as string
                    return "Bob"
                end function

                function getGreeting() as string
                    return "Hello"
                end function

                sub main()
                    __bsArgs0 = getGreeting()
                    __bsArgs1 = getName()
                    greet(__bsArgs1, __bsArgs0)
                end sub
            `);
        });

        it('hoists before an if-statement when the call is in the condition', () => {
            testTranspile(`
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    if shouldGreet(excited: true, name: getName()) then
                        print "greeting"
                    end if
                end sub
            `, `
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    __bsArgs0 = getName()
                    if shouldGreet(__bsArgs0, true) then
                        print "greeting"
                    end if
                end sub
            `);
        });

        it('wraps in an IIFE for an else-if condition to preserve evaluation order', () => {
            // Hoisting before the outer `if` would be wrong — `getName()` should only be
            // called if the else-if branch is actually reached. An IIFE (same pattern as
            // ternary for complex consequents) evaluates args in written order and passes
            // them to the function in positional order, all inline.
            testTranspile(`
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    if false then
                        print "no"
                    else if shouldGreet(excited: true, name: getName()) then
                        print "greeting"
                    end if
                end sub
            `, `
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    if false then
                        print "no"
                    else if (function(__bsArg0, __bsArg1)
                            return shouldGreet(__bsArg1, __bsArg0)
                        end function)(true, getName()) then
                        print "greeting"
                    end if
                end sub
            `);
        });

        it('hoists before the for-statement when the call is in the to-expression', () => {
            testTranspile(`
                function getEnd(fromVal as integer, toVal as integer) as integer
                    return fromVal + toVal
                end function
                function getLimit() as integer
                    return 10
                end function
                sub main()
                    for i = 0 to getEnd(toVal: getLimit(), fromVal: 0)
                        print i
                    end for
                end sub
            `, `
                function getEnd(fromVal as integer, toVal as integer) as integer
                    return fromVal + toVal
                end function

                function getLimit() as integer
                    return 10
                end function

                sub main()
                    __bsArgs0 = getLimit()
                    for i = 0 to getEnd(0, __bsArgs0)
                        print i
                    end for
                end sub
            `);
        });

        it('hoists inside the loop body when the call is inside a for loop', () => {
            testTranspile(`
                sub process(value as integer, factor as integer)
                end sub
                function getFactor() as integer
                    return 2
                end function
                sub main()
                    for i = 0 to 5
                        process(factor: getFactor(), value: i)
                    end for
                end sub
            `, `
                sub process(value as integer, factor as integer)
                end sub

                function getFactor() as integer
                    return 2
                end function

                sub main()
                    for i = 0 to 5
                        __bsArgs0 = getFactor()
                        process(i, __bsArgs0)
                    end for
                end sub
            `);
        });

        it('hoists before the outer call when named-arg call is nested inside another call', () => {
            testTranspile(`
                sub outer(value as string)
                end sub
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    outer(inner(name: getName(), greeting: "Hello"))
                end sub
            `, `
                sub outer(value as string)
                end sub

                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    __bsArgs0 = getName()
                    outer(inner("Hello", __bsArgs0))
                end sub
            `);
        });

        it('ternary as named arg value is hoisted then rewritten to if-statement', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                sub main()
                    greet(name: "Bob", excited: condition ? true : false)
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                sub main()
                    if condition then
                        __bsArgs0 = true
                    else
                        __bsArgs0 = false
                    end if
                    greet("Bob", __bsArgs0)
                end sub
            `);
        });

        it('named arg call with only literals used as ternary condition becomes an if-statement', () => {
            testTranspile(`
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function
                sub main()
                    result = shouldGreet(excited: true, name: "Bob") ? "yes" : "no"
                end sub
            `, `
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function

                sub main()
                    if shouldGreet("Bob", true) then
                        result = "yes"
                    else
                        result = "no"
                    end if
                end sub
            `);
        });

        it('complex named arg call in ternary consequent wraps in IIFE to avoid unconditional evaluation', () => {
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    result = condition ? inner(name: getName(), greeting: "Hello") : "fallback"
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    if condition then
                        result = (function(__bsArg0, __bsArg1)
                                return inner(__bsArg1, __bsArg0)
                            end function)(getName(), "Hello")
                    else
                        result = "fallback"
                    end if
                end sub
            `);
        });

        it('complex named arg call in ternary alternate wraps in IIFE to avoid unconditional evaluation', () => {
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    result = condition ? "fallback" : inner(name: getName(), greeting: "Hello")
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    if condition then
                        result = "fallback"
                    else
                        result = (function(__bsArg0, __bsArg1)
                                return inner(__bsArg1, __bsArg0)
                            end function)(getName(), "Hello")
                    end if
                end sub
            `);
        });

        it('named arg call (simple) used as value inside another named arg call', () => {
            // inner has only literals — just reordered; outer hoists the inner call result
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                sub outer(value as string, flag as boolean)
                end sub
                sub main()
                    outer(flag: true, value: inner(name: "Bob", greeting: "Hello"))
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                sub outer(value as string, flag as boolean)
                end sub

                sub main()
                    __bsArgs0 = inner("Hello", "Bob")
                    outer(__bsArgs0, true)
                end sub
            `);
        });

        it('named arg call (complex inner) used as value inside another named arg call wraps inner in IIFE', () => {
            // inner has a complex arg — because the hoist statement for outer has no parent yet when
            // inner is processed, canHoist is false and inner falls back to IIFE, which is correct:
            // getGreeting() is evaluated inside the IIFE call, after outer's literal arg.
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                sub outer(value as string, flag as boolean)
                end sub
                function getGreeting() as string
                    return "Hello"
                end function
                sub main()
                    outer(flag: true, value: inner(name: "Bob", greeting: getGreeting()))
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                sub outer(value as string, flag as boolean)
                end sub

                function getGreeting() as string
                    return "Hello"
                end function

                sub main()
                    __bsArgs0 = (function(__bsArg0, __bsArg1)
                            return inner(__bsArg1, __bsArg0)
                        end function)("Bob", getGreeting())
                    outer(__bsArgs0, true)
                end sub
            `);
        });

        it('both outer and inner named arg calls have complex args — outer written order is preserved', () => {
            // outer written order: flag: getFlag() first, then value: inner(...)
            // getFlag() is hoisted first, then the IIFE for inner (which calls getGreeting() lazily),
            // ensuring getFlag() evaluates before getGreeting() as written.
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                sub outer(value as string, flag as boolean)
                end sub
                function getGreeting() as string
                    return "Hello"
                end function
                function getFlag() as boolean
                    return true
                end function
                sub main()
                    outer(flag: getFlag(), value: inner(name: "Bob", greeting: getGreeting()))
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                sub outer(value as string, flag as boolean)
                end sub

                function getGreeting() as string
                    return "Hello"
                end function

                function getFlag() as boolean
                    return true
                end function

                sub main()
                    __bsArgs0 = getFlag()
                    __bsArgs1 = (function(__bsArg0, __bsArg1)
                            return inner(__bsArg1, __bsArg0)
                        end function)("Bob", getGreeting())
                    outer(__bsArgs1, __bsArgs0)
                end sub
            `);
        });

        it('doubly-nested ternary with complex named arg in innermost branch uses IIFE', () => {
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                function getName() as string
                    return "Bob"
                end function
                sub main()
                    result = cond1 ? (cond2 ? inner(name: getName(), greeting: "Hello") : "alt1") : "alt2"
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                function getName() as string
                    return "Bob"
                end function

                sub main()
                    if cond1 then
                        if cond2 then
                            result = (function(__bsArg0, __bsArg1)
                                    return inner(__bsArg1, __bsArg0)
                                end function)(getName(), "Hello")
                        else
                            result = "alt1"
                        end if
                    else
                        result = "alt2"
                    end if
                end sub
            `);
        });

        it('three-level nested ternary with complex named arg in deepest branch', () => {
            testTranspile(`
                function inner(a as string, b as string) as string
                    return a + b
                end function
                function getB() as string
                    return "B"
                end function
                sub main()
                    result = c1 ? (c2 ? (c3 ? inner(b: getB(), a: "A") : "d3") : "d2") : "d1"
                end sub
            `, `
                function inner(a as string, b as string) as string
                    return a + b
                end function

                function getB() as string
                    return "B"
                end function

                sub main()
                    if c1 then
                        if c2 then
                            if c3 then
                                result = (function(__bsArg0, __bsArg1)
                                        return inner(__bsArg1, __bsArg0)
                                    end function)(getB(), "A")
                            else
                                result = "d3"
                            end if
                        else
                            result = "d2"
                        end if
                    else
                        result = "d1"
                    end if
                end sub
            `);
        });

        it('named arg call in ternary branch inside else-if', () => {
            testTranspile(`
                function pick(a as string, b as string) as string
                    return a
                end function
                function getA() as string
                    return "A"
                end function
                sub main()
                    if false then
                        print "no"
                    else if true then
                        result = condition ? pick(b: getA(), a: "X") : "fallback"
                    end if
                end sub
            `, `
                function pick(a as string, b as string) as string
                    return a
                end function

                function getA() as string
                    return "A"
                end function

                sub main()
                    if false then
                        print "no"
                    else if true then
                        if condition then
                            result = (function(__bsArg0, __bsArg1)
                                    return pick(__bsArg1, __bsArg0)
                                end function)(getA(), "X")
                        else
                            result = "fallback"
                        end if
                    end if
                end sub
            `);
        });

        it('outer variable used as named arg value in else-if is passed as IIFE arg, not a closure', () => {
            // BrightScript has no closures. When an IIFE is needed (else-if context), outer
            // variables must be passed as IIFE parameters — not referenced inside the body.
            // Here myName becomes __bsArg1, passed in the invocation: (getExcited(), myName)
            testTranspile(`
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function
                function getExcited() as boolean
                    return true
                end function
                sub main()
                    myName = "Bob"
                    if false then
                        print "no"
                    else if shouldGreet(excited: getExcited(), name: myName) then
                        print "greeting"
                    end if
                end sub
            `, `
                function shouldGreet(name as string, excited as boolean) as boolean
                    return true
                end function

                function getExcited() as boolean
                    return true
                end function

                sub main()
                    myName = "Bob"
                    if false then
                        print "no"
                    else if (function(__bsArg0, __bsArg1)
                            return shouldGreet(__bsArg1, __bsArg0)
                        end function)(getExcited(), myName) then
                        print "greeting"
                    end if
                end sub
            `);
        });

        it('outer variable as named arg in ternary branch is passed as IIFE arg, not a closure', () => {
            // myName is in the IIFE invocation list, not referenced inside the IIFE body directly.
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                function getGreeting() as string
                    return "Hello"
                end function
                sub main()
                    myName = "Bob"
                    result = condition ? inner(name: myName, greeting: getGreeting()) : "fallback"
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                function getGreeting() as string
                    return "Hello"
                end function

                sub main()
                    myName = "Bob"
                    if condition then
                        result = (function(__bsArg0, __bsArg1)
                                return inner(__bsArg1, __bsArg0)
                            end function)(myName, getGreeting())
                    else
                        result = "fallback"
                    end if
                end sub
            `);
        });

        it('outer variable in nested named arg call is passed as IIFE arg, not a closure', () => {
            // myName flows into the inner IIFE invocation — never referenced inside any IIFE body.
            testTranspile(`
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function
                sub outer(value as string, flag as boolean)
                end sub
                function getGreeting() as string
                    return "Hello"
                end function
                sub main()
                    myName = "Bob"
                    outer(flag: true, value: inner(name: myName, greeting: getGreeting()))
                end sub
            `, `
                function inner(greeting as string, name as string) as string
                    return greeting + " " + name
                end function

                sub outer(value as string, flag as boolean)
                end sub

                function getGreeting() as string
                    return "Hello"
                end function

                sub main()
                    myName = "Bob"
                    __bsArgs0 = (function(__bsArg0, __bsArg1)
                            return inner(__bsArg1, __bsArg0)
                        end function)(myName, getGreeting())
                    outer(__bsArgs0, true)
                end sub
            `);
        });

        it('outer variable mixed with positional arg in else-if IIFE — all passed as IIFE args', () => {
            // Positional "Hello" and named greeting: myName are both IIFE args in written order,
            // with getExcited() in between. No outer variable is referenced inside the IIFE body.
            testTranspile(`
                function greet(name as string, greeting as string, excited as boolean) as boolean
                    return true
                end function
                function getExcited() as boolean
                    return true
                end function
                sub main()
                    myName = "Bob"
                    if false then
                        print "no"
                    else if greet("Hello", excited: getExcited(), greeting: myName) then
                        print "greeting"
                    end if
                end sub
            `, `
                function greet(name as string, greeting as string, excited as boolean) as boolean
                    return true
                end function

                function getExcited() as boolean
                    return true
                end function

                sub main()
                    myName = "Bob"
                    if false then
                        print "no"
                    else if (function(__bsArg0, __bsArg1, __bsArg2)
                            return greet(__bsArg0, __bsArg2, __bsArg1)
                        end function)("Hello", getExcited(), myName) then
                        print "greeting"
                    end if
                end sub
            `);
        });

        it('hoisting counter is scoped per function', () => {
            testTranspile(`
                sub greet(name as string, excited as boolean)
                end sub
                function getName() as string
                    return "Bob"
                end function
                sub first()
                    greet(excited: true, name: getName())
                end sub
                sub second()
                    greet(excited: false, name: getName())
                end sub
            `, `
                sub greet(name as string, excited as boolean)
                end sub

                function getName() as string
                    return "Bob"
                end function

                sub first()
                    __bsArgs0 = getName()
                    greet(__bsArgs0, true)
                end sub

                sub second()
                    __bsArgs0 = getName()
                    greet(__bsArgs0, false)
                end sub
            `);
        });

        describe('namespace calls', () => {
            it('reorders named args for a namespace function call', () => {
                testTranspile(`
                    namespace MyNs
                        sub greet(name as string, excited as boolean)
                        end sub
                    end namespace
                    sub main()
                        MyNs.greet(excited: true, name: "Bob")
                    end sub
                `, `
                    sub MyNs_greet(name as string, excited as boolean)
                    end sub

                    sub main()
                        MyNs_greet("Bob", true)
                    end sub
                `);
            });

            it('hoists complex args for a namespace function call', () => {
                testTranspile(`
                    namespace MyNs
                        sub greet(name as string, excited as boolean)
                        end sub
                    end namespace
                    function getName() as string
                        return "Bob"
                    end function
                    sub main()
                        MyNs.greet(excited: true, name: getName())
                    end sub
                `, `
                    sub MyNs_greet(name as string, excited as boolean)
                    end sub

                    function getName() as string
                        return "Bob"
                    end function

                    sub main()
                        __bsArgs0 = getName()
                        MyNs_greet(__bsArgs0, true)
                    end sub
                `);
            });
        });

        describe('constructor calls', () => {
            it('reorders named args for a constructor call', () => {
                testTranspile(`
                    class Point
                        x as integer
                        y as integer
                        function new(x as integer, y as integer)
                            m.x = x
                            m.y = y
                        end function
                    end class
                    sub main()
                        p = new Point(y: 2, x: 1)
                    end sub
                `, `
                    function __Point_method_new(x as integer, y as integer)
                        m.x = invalid
                        m.y = invalid
                        m.x = x
                        m.y = y
                    end function
                    function __Point_builder()
                        instance = {}
                        instance.new = __Point_method_new
                        return instance
                    end function
                    function Point(x as integer, y as integer)
                        instance = __Point_builder()
                        instance.new(x, y)
                        return instance
                    end function

                    sub main()
                        p = Point(1, 2)
                    end sub
                `);
            });

            it('hoists complex args for a constructor call', () => {
                testTranspile(`
                    class Point
                        x as integer
                        y as integer
                        function new(x as integer, y as integer)
                            m.x = x
                            m.y = y
                        end function
                    end class
                    function getY() as integer
                        return 2
                    end function
                    sub main()
                        p = new Point(y: getY(), x: 1)
                    end sub
                `, `
                    function __Point_method_new(x as integer, y as integer)
                        m.x = invalid
                        m.y = invalid
                        m.x = x
                        m.y = y
                    end function
                    function __Point_builder()
                        instance = {}
                        instance.new = __Point_method_new
                        return instance
                    end function
                    function Point(x as integer, y as integer)
                        instance = __Point_builder()
                        instance.new(x, y)
                        return instance
                    end function

                    function getY() as integer
                        return 2
                    end function

                    sub main()
                        __bsArgs0 = getY()
                        p = Point(1, __bsArgs0)
                    end sub
                `);
            });

            it('uses inherited constructor params when subclass has no constructor', () => {
                testTranspile(`
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
                `, `
                    function __Shape_method_new(color as string)
                        m.color = invalid
                        m.color = color
                    end function
                    function __Shape_builder()
                        instance = {}
                        instance.new = __Shape_method_new
                        return instance
                    end function
                    function Shape(color as string)
                        instance = __Shape_builder()
                        instance.new(color)
                        return instance
                    end function
                    sub __Circle_method_new(color as string)
                        m.super0_new(color)
                    end sub
                    function __Circle_builder()
                        instance = __Shape_builder()
                        instance.super0_new = instance.new
                        instance.new = __Circle_method_new
                        return instance
                    end function
                    function Circle(color as string)
                        instance = __Circle_builder()
                        instance.new(color)
                        return instance
                    end function

                    sub main()
                        c = Circle("red")
                    end sub
                `);
            });
        });
    });
});
