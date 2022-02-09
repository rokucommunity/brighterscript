import { expect } from 'chai';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import { standardizePath as s } from './util';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import { ParseMode } from './parser/Parser';
import PluginInterface from './PluginInterface';
import { expectDiagnostics, expectZeroDiagnostics, trim } from './testHelpers.spec';
import { Logger } from './Logger';
import type { BrsFile } from './files/BrsFile';
import type { FunctionStatement, NamespaceStatement } from './parser/Statement';
import type { OnScopeValidateEvent } from './interfaces';

describe('Scope', () => {
    let sinon = sinonImport.createSandbox();
    let rootDir = process.cwd();
    let program: Program;
    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
        program.createSourceScope();
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('does not mark namespace functions as collisions with stdlib', () => {
        program.setFile({
            src: `${rootDir}/source/main.bs`,
            dest: `source/main.bs`
        }, `
            namespace a
                function constructor()
                end function
            end namespace
        `);

        program.validate();
        expectZeroDiagnostics(program);
    });

    it('handles variables with javascript prototype names', () => {
        program.setFile('source/main.brs', `
            sub main()
                constructor = true
            end sub
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags parameter with same name as namespace', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main(nameA)
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace('nameA')
        ]);
    });

    it('flags assignments with same name as namespace', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main()
                namea = 2
                NAMEA += 1
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('namea'),
            DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('NAMEA')
        ]);
    });

    it('allows adding diagnostics', () => {
        const source = program.getScopeByName('source');
        const expected = [{
            message: 'message',
            file: undefined,
            range: undefined
        }];
        source.addDiagnostics(expected);
        expectDiagnostics(source, expected);
    });

    it('allows getting all scopes', () => {
        const scopes = program.getScopes();
        expect(scopes.length).to.equal(2);
    });

    describe('addFile', () => {
        it('detects callables from all loaded files', () => {
            const sourceScope = program.getScopeByName('source');

            program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            program.setFile({ src: s`${rootDir}/source/lib.brs`, dest: s`source/lib.brs` }, `
                sub ActionB()
                end sub
            `);

            program.validate();

            expect(sourceScope.getOwnFiles().map(x => x.pathAbsolute).sort()).eql([
                s`${rootDir}/source/lib.brs`,
                s`${rootDir}/source/main.brs`
            ]);
            expectZeroDiagnostics(program);
            expect(sourceScope.getOwnCallables()).is.lengthOf(3);
            expect(sourceScope.getAllCallables()).is.length.greaterThan(3);
        });

        it('picks up new callables', () => {
            program.setFile('source/file.brs', '');
            //we have global callables, so get that initial number
            let originalLength = program.getScopeByName('source').getAllCallables().length;

            program.setFile('source/file.brs', `
                function DoA()
                    print "A"
                end function

                function DoA()
                    print "A"
                end function
            `);
            expect(program.getScopeByName('source').getAllCallables().length).to.equal(originalLength + 2);
        });
    });

    describe('removeFile', () => {
        it('removes callables from list', () => {
            //add the file
            let file = program.setFile(`source/file.brs`, `
                function DoA()
                    print "A"
                end function
            `);
            let initCallableCount = program.getScopeByName('source').getAllCallables().length;

            //remove the file
            program.removeFile(file.pathAbsolute);
            expect(program.getScopeByName('source').getAllCallables().length).to.equal(initCallableCount - 1);
        });
    });

    describe('validate', () => {
        it('marks the scope as validated after validation has occurred', () => {
            program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
               sub main()
               end sub
            `);
            let lib = program.setFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
               sub libFunc()
               end sub
            `);
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;
            program.validate();
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.true;
            lib = program.setFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
                sub libFunc()
                end sub
            `);

            //scope gets marked as invalidated
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;

        });

        it('does not mark same-named-functions in different namespaces as an error', () => {
            program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameB
                    sub alert()
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
        it('resolves local-variable function calls', () => {
            program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName()
                end sub`
            );
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('function shadowing', () => {
            it('warns when local var function has same name as stdlib function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = function(p)
                            return "override"
                        end function
                        print str(12345) 'prints "12345" (i.e. our local function is never used)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [{
                    ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                    range: Range.create(2, 24, 2, 27)
                }]);
            });

            it('warns when local var has same name as built-in function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('warns when local var has same name as built-in function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 6789
                        print str(12345) ' prints "12345" (i.e. our local variable did not override the callable global function)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('detects local function with same name as scope function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = function()
                            return "override"
                        end function
                        print getHello() 'prints "hello" (i.e. our local variable is never called)
                    end sub

                    function getHello()
                        return "hello"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('scope').message,
                    range: Range.create(2, 24, 2, 32)
                }]);
            });

            it('detects local function with same name as scope function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = "override"
                        print getHello ' prints <Function: gethello> (i.e. local variable override does NOT work for same-scope-defined methods)
                    end sub
                    function getHello()
                        return "hello"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.localVarShadowedByScopedFunction().message,
                    range: Range.create(2, 24, 2, 32)
                }]);
            });

            it('flags scope function with same name (but different case) as built-in function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        print str(12345) ' prints 12345 (i.e. our str() function below is ignored)
                    end sub
                    function STR(num)
                        return "override"
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [{
                    message: DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction().message,
                    range: Range.create(4, 29, 4, 32)
                }]);
            });
        });

        it('detects duplicate callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            expectZeroDiagnostics(program);
            //validate the scope
            program.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expectDiagnostics(program, [
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source'),
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source')
            ]);
        });

        it('detects calls to unknown callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
            `);
            expectZeroDiagnostics(program);
            //validate the scope
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.callToUnknownFunction('DoB', 'source')
            ]);
        });

        it('recognizes known callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
                function DoB()
                    DoC()
                end function
            `);
            //validate the scope
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.callToUnknownFunction('DoC', 'source')
            ]);
        });

        it('does not error with calls to callables in same namespace', () => {
            program.setFile('source/file.bs', `
                namespace Name.Space
                    sub a(param as string)
                        print param
                    end sub

                    sub b()
                        a("hello")
                    end sub
                end namespace
            `);
            //validate the scope
            program.validate();
            expectZeroDiagnostics(program);
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', () => {
            expectZeroDiagnostics(program);
            program.setFile('source/file.brs', `
               function DoB()
                    m.doSomething()
                end function
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expectZeroDiagnostics(program);
        });

        it('detects calling functions with too many parameters', () => {
            program.setFile('source/file.brs', `
                sub a()
                end sub
                sub b()
                    a(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(0, 1).message
            ]);
        });

        it('detects calling class constructors with too many parameters', () => {
            program.setFile('source/main.bs', `
                function noop0()
                end function

                function noop1(p1)
                end function

                sub main()
                   noop0(1)
                   noop1(1,2)
                   noop1()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(0, 1),
                DiagnosticMessages.mismatchArgumentCount(1, 2),
                DiagnosticMessages.mismatchArgumentCount(1, 0)
            ]);
        });

        it('detects calling functions with too many parameters', () => {
            program.setFile('source/file.brs', `
                sub a(name)
                end sub
                sub b()
                    a()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 0)
            ]);
        });

        it('allows skipping optional parameter', () => {
            program.setFile('source/file.brs', `
                sub a(name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            program.validate();
            //should have an error
            expectZeroDiagnostics(program);
        });

        it('shows expected parameter range in error message', () => {
            program.setFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            program.validate();
            //should have an error
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount('1-2', 0)
            ]);
        });

        it('handles expressions as arguments to a function', () => {
            program.setFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a("cat" + "dog" + "mouse")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Catches extra arguments for expressions as arguments to a function', () => {
            program.setFile('source/file.brs', `
                sub a(age)
                end sub
                sub b()
                    a(m.lib.movies[0], 1)
                end sub
            `);
            program.validate();
            //should have an error
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 2)
            ]);
        });

        it('handles JavaScript reserved names', () => {
            program.setFile('source/file.brs', `
                sub constructor()
                end sub
                sub toString()
                end sub
                sub valueOf()
                end sub
                sub getPrototypeOf()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('Emits validation events', () => {
            program.setFile('source/file.brs', ``);
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                </component>
            `);
            program.setFile(s`components/comp.brs`, ``);
            const sourceScope = program.getScopeByName('source');
            const compScope = program.getScopeByName('components/comp.xml');
            program.plugins = new PluginInterface([], new Logger());
            const plugin = program.plugins.add({
                name: 'Emits validation events',
                beforeScopeValidate: sinon.spy(),
                onScopeValidate: sinon.spy(),
                afterScopeValidate: sinon.spy()
            });
            program.validate();
            const scopeNames = program.getScopes().map(x => x.name).filter(x => x !== 'global').sort();

            expect(plugin.beforeScopeValidate.callCount).to.equal(2);
            expect(plugin.beforeScopeValidate.calledWith(sourceScope)).to.be.true;
            expect(plugin.beforeScopeValidate.calledWith(compScope)).to.be.true;

            expect(plugin.onScopeValidate.callCount).to.equal(2);
            expect(plugin.onScopeValidate.getCalls().map(
                x => (x.args[0] as OnScopeValidateEvent).scope.name
            ).sort()).to.eql(scopeNames);

            expect(plugin.afterScopeValidate.callCount).to.equal(2);
            expect(plugin.afterScopeValidate.calledWith(sourceScope)).to.be.true;
            expect(plugin.afterScopeValidate.calledWith(compScope)).to.be.true;
        });

        describe('custom types', () => {
            it('detects an unknown function return type', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    function a()
                        return invalid
                    end function

                    function b() as integer
                        return 1
                    end function

                    function c() as unknownType 'error
                        return 2
                    end function

                    class myClass
                        function myClassMethod() as unknownType 'error
                            return 2
                        end function
                    end class

                    function d() as myClass
                        return new myClass()
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.invalidFunctionReturnType('unknownType').message,
                    DiagnosticMessages.invalidFunctionReturnType('unknownType').message
                ]);
            });

            it('detects an unknown function parameter type', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    sub a(num as integer)
                    end sub

                    sub b(unknownParam as unknownType) 'error
                    end sub

                    class myClass
                        sub myClassMethod(unknownParam as unknownType) 'error
                        end sub
                    end class

                    sub d(obj as myClass)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.functionParameterTypeIsInvalid('unknownParam', 'unknownType').message,
                    DiagnosticMessages.functionParameterTypeIsInvalid('unknownParam', 'unknownType').message
                ]);
            });

            it('detects an unknown field parameter type', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    class myClass
                        foo as unknownType 'error
                    end class

                    class myOtherClass
                        foo as unknownType 'error
                        bar as myClass
                        buz as myOtherClass
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindType('unknownType').message,
                    DiagnosticMessages.cannotFindType('unknownType').message
                ]);
            });

            it('finds custom types inside namespaces', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class

                        function foo(param as MyClass) as MyClass
                        end function

                        function bar(param as MyNamespace.MyClass) as MyNamespace.MyClass
                        end function

                    end namespace

                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types from other namespaces', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class
                    end namespace

                    function foo(param as MyNamespace.MyClass) as MyNamespace.MyClass
                    end function
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('detects missing custom types from current namespaces', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class

                        function foo() as UnknownType
                        end function
                    end namespace
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.invalidFunctionReturnType('UnknownType').message
                ]);
            });

            it('finds custom types from other other files', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    function foo(param as MyClass) as MyClass
                    end function
                `);
                program.setFile({ src: s`${rootDir}/source/MyClass.bs`, dest: s`source/MyClass.bs` }, `
                    class MyClass
                    end class
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('finds custom types from other other files', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    function foo(param as MyNameSpace.MyClass) as MyNameSpace.MyClass
                    end function
                `);
                program.setFile({ src: s`${rootDir}/source/MyNameSpace.bs`, dest: s`source/MyNameSpace.bs` }, `
                    namespace MyNameSpace
                      class MyClass
                      end class
                    end namespace
                `);
                program.validate();

                expectZeroDiagnostics(program);
            });

            it('detects missing custom types from another namespaces', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class
                    end namespace

                    function foo() as MyNamespace.UnknownType
                    end function
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.invalidFunctionReturnType('MyNamespace.UnknownType')
                ]);
            });

            it('scopes types to correct scope', () => {
                program = new Program({ rootDir: rootDir });

                program.setFile('components/foo.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="foo" extends="Scene">
                        <script uri="foo.bs"/>
                    </component>
                `);
                program.setFile(s`components/foo.bs`, `
                    class MyClass
                    end class
                `);
                program.validate();

                expectZeroDiagnostics(program);

                program.setFile('components/bar.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="bar" extends="Scene">
                        <script uri="bar.bs"/>
                    </component>
                `);
                program.setFile(s`components/bar.bs`, `
                    function getFoo() as MyClass
                    end function
                `);
                program.validate();

                expectDiagnostics(program, [
                    DiagnosticMessages.invalidFunctionReturnType('MyClass').message
                ]);
            });

            it('can reference types from parent component', () => {
                program = new Program({ rootDir: rootDir });

                program.setFile('components/parent.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="parent" extends="Scene">
                        <script uri="parent.bs"/>
                    </component>
                `);
                program.setFile(s`components/parent.bs`, `
                    class MyClass
                    end class
                `);
                program.setFile('components/child.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="child" extends="parent">
                        <script uri="child.bs"/>
                    </component>
                `);
                program.setFile(s`components/child.bs`, `
                    function getFoo() as MyClass
                    end function
                `);

                program.validate();

                expectZeroDiagnostics(program);

            });
        });
    });

    describe('inheritance', () => {
        it('inherits callables from parent', () => {
            program = new Program({ rootDir: rootDir });

            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <script uri="child.brs"/>
                </component>
            `);
            program.setFile(s`components/child.brs`, ``);
            program.validate();
            let childScope = program.getComponentScope('child');
            expect(childScope.getAllCallables().map(x => x.callable.name)).not.to.include('parentSub');

            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="parent" extends="Scene">
                    <script uri="parent.brs"/>
                </component>
            `);
            program.setFile(s`components/parent.brs`, `
                sub parentSub()
                end sub
            `);
            program.validate();

            expect(childScope.getAllCallables().map(x => x.callable.name)).to.include('parentSub');
        });
    });

    describe('detachParent', () => {
        it('does not attach global to itself', () => {
            expect(program.globalScope.getParentScope()).not.to.exist;
        });
    });

    describe('getDefinition', () => {
        it('returns empty list when there are no files', () => {
            let file = program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
            let scope = program.getScopeByName('source');
            expect(scope.getDefinition(file, Position.create(0, 0))).to.be.lengthOf(0);
        });
    });

    describe('getCallablesAsCompletions', () => {
        it('returns documentation when possible', () => {
            let completions = program.globalScope.getCallablesAsCompletions(ParseMode.BrightScript);
            //it should find the completions for the global scope
            expect(completions).to.be.length.greaterThan(0);
            //it should find documentation for completions
            expect(completions.filter(x => !!x.documentation)).to.have.length.greaterThan(0);
        });
    });

    describe('buildNamespaceLookup', () => {
        it('does not crash when class statement is missing `name` prop', () => {
            program.setFile<BrsFile>('source/main.bs', `
                namespace NameA
                    class
                    end class
                end namespace
            `);
            program['scopes']['source'].buildNamespaceLookup();
        });

        it('does not crash when function statement is missing `name` prop', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                namespace NameA
                    function doSomething()
                    end function
                end namespace
            `);
            delete ((file.ast.statements[0] as NamespaceStatement).body.statements[0] as FunctionStatement).name;
            program['scopes']['source'].buildNamespaceLookup();
        });
    });

    describe('buildEnumLookup', () => {
        it('builds enum lookup', () => {
            const sourceScope = program.getScopeByName('source');
            //eslint-disable-next-line @typescript-eslint/no-floating-promises
            program.addOrReplaceFile('source/main.bs', `
                enum foo
                    bar1
                    bar2
                end enum

                namespace test
                    function fooFace2()
                    end function

                    class fooClass2
                    end class

                    enum foo2
                        bar2_1
                        bar2_2
                    end enum
                end namespace

                enum foo3
                    bar3_1
                    bar3_2
                end enum
            `);
            // program.validate();

            expect(
                [...sourceScope.getEnumMap().keys()]
            ).to.eql([
                'foo',
                'test.foo2',
                'foo3'
            ]);
        });
    });
});
