import { expect } from 'chai';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import { standardizePath as s } from './util';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import { ParseMode } from './parser/Parser';
import PluginInterface from './PluginInterface';

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

    it('does not mark namespace functions as collisions with stdlib', async () => {
        await program.addOrReplaceFile({
            src: `${rootDir}/source/main.bs`,
            dest: `source/main.bs`
        }, `
            namespace a
                function constructor()
                end function
            end namespace
        `);

        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('flags parameter with same name as namespace', async () => {
        await program.addOrReplaceFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main(nameA)
            end sub
        `);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.eql(
            DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace('nameA').message
        );
    });

    it('flags assignments with same name as namespace', async () => {
        await program.addOrReplaceFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main()
                namea = 2
                NAMEA += 1
            end sub
        `);
        await program.validate();
        expect(
            program.getDiagnostics().map(x => x.message)
        ).to.eql([
            DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('namea').message,
            DiagnosticMessages.variableMayNotHaveSameNameAsNamespace('NAMEA').message
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
        const actual = source.getDiagnostics();
        expect(actual).to.deep.equal(expected);
    });

    it('allows getting all scopes', () => {
        const scopes = program.getScopes();
        expect(scopes.length).to.equal(2);
    });

    describe('addFile', () => {
        it('detects callables from all loaded files', async () => {
            const sourceScope = program.getScopeByName('source');

            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub Main()

                end sub

                sub ActionA()
                end sub
            `);
            await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.brs`, dest: s`source/lib.brs` }, `
                sub ActionB()
                end sub
            `);

            await program.validate();

            expect(sourceScope.getOwnFiles().map(x => x.pathAbsolute).sort()).eql([
                s`${rootDir}/source/lib.brs`,
                s`${rootDir}/source/main.brs`
            ]);
            expect(program.getDiagnostics()).to.be.lengthOf(0);
            expect(sourceScope.getOwnCallables()).is.lengthOf(3);
            expect(sourceScope.getAllCallables()).is.length.greaterThan(3);
        });

        it('picks up new callables', async () => {
            await program.addOrReplaceFile('source/file.brs', '');
            //we have global callables, so get that initial number
            let originalLength = program.getScopeByName('source').getAllCallables().length;

            await program.addOrReplaceFile('source/file.brs', `
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
        it('removes callables from list', async () => {
            //add the file
            let file = await program.addOrReplaceFile(`source/file.brs`, `
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
        it('marks the scope as validated after validation has occurred', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
               sub main()
               end sub
            `);
            let lib = await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
               sub libFunc()
               end sub
            `);
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;
            await program.validate();
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.true;
            lib = await program.addOrReplaceFile({ src: s`${rootDir}/source/lib.bs`, dest: s`source/lib.bs` }, `
                sub libFunc()
                end sub
            `);

            //scope gets marked as invalidated
            expect(program.getScopesForFile(lib)[0].isValidated).to.be.false;

        });

        it('does not mark same-named-functions in different namespaces as an error', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                namespace NameA
                    sub alert()
                    end sub
                end namespace
                namespace NameB
                    sub alert()
                    end sub
                end namespace
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });
        it('resolves local-variable function calls', async () => {
            await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName()
                end sub`
            );
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });

        describe('function shadowing', () => {
            it('warns when local var function has same name as stdlib function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = function(p)
                            return "override"
                        end function
                        print str(12345) 'prints "12345" (i.e. our local function is never used)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib').message,
                    range: Range.create(2, 24, 2, 27)
                });
            });

            it('warns when local var has same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('warns when local var has same name as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 6789
                        print str(12345) ' prints "12345" (i.e. our local variable did not override the callable global function)
                    end sub
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('detects local function with same name as scope function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
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
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarFunctionShadowsParentFunction('scope').message,
                    range: Range.create(2, 24, 2, 32)
                });
            });

            it('detects local function with same name as scope function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        getHello = "override"
                        print getHello ' prints <Function: gethello> (i.e. local variable override does NOT work for same-scope-defined methods)
                    end sub
                    function getHello()
                        return "hello"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.localVarShadowedByScopedFunction().message,
                    range: Range.create(2, 24, 2, 32)
                });
            });

            it('flags scope function with same name (but different case) as built-in function', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        print str(12345) ' prints 12345 (i.e. our str() function below is ignored)
                    end sub
                    function STR(num)
                        return "override"
                    end function
                `);
                await program.validate();
                let diagnostics = program.getDiagnostics().map(x => {
                    return {
                        message: x.message,
                        range: x.range
                    };
                });
                expect(diagnostics[0]).to.exist.and.to.eql({
                    message: DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction().message,
                    range: Range.create(4, 29, 4, 32)
                });
            });
        });

        it('detects duplicate callables', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                function DoA()
                    print "A"
                end function

                 function DoA()
                     print "A"
                 end function
            `);
            expect(
                program.getDiagnostics().length
            ).to.equal(0);
            //validate the scope
            await program.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(program.getDiagnostics().map(x => x.message).sort()).to.eql([
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source').message,
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source').message
            ]);
        });

        it('detects calls to unknown callables', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
            `);
            expect(program.getDiagnostics().length).to.equal(0);
            //validate the scope
            await program.validate();
            expect(program.getDiagnostics()[0]).to.deep.include({
                code: DiagnosticMessages.callToUnknownFunction('DoB', '').code
            });
        });

        it('recognizes known callables', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
                function DoB()
                    DoC()
                end function
            `);
            //validate the scope
            await program.validate();
            expect(program.getDiagnostics().map(x => x.message)).to.eql([
                DiagnosticMessages.callToUnknownFunction('DoC', 'source').message
            ]);
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', async () => {
            expect(program.getDiagnostics().length).to.equal(0);
            await program.addOrReplaceFile('source/file.brs', `
               function DoB()
                    m.doSomething()
                end function
            `);
            //validate the scope
            await program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
        });

        it('detects calling functions with too many parameters', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a()
                end sub
                sub b()
                    a(1)
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().map(x => x.message)).includes(
                DiagnosticMessages.mismatchArgumentCount(0, 1).message
            );
        });

        it('detects calling functions with too many parameters', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(name)
                end sub
                sub b()
                    a()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().map(x => x.message)).to.includes(
                DiagnosticMessages.mismatchArgumentCount(1, 0).message
            );
        });

        it('allows skipping optional parameter', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            await program.validate();
            //should have an error
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('shows expected parameter range in error message', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a()
                end sub
            `);
            await program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).includes(
                DiagnosticMessages.mismatchArgumentCount('1-2', 0).message
            );
        });

        it('handles expressions as arguments to a function', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(age, name="Bob")
                end sub
                sub b()
                    a("cat" + "dog" + "mouse")
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('Catches extra arguments for expressions as arguments to a function', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub a(age)
                end sub
                sub b()
                    a(m.lib.movies[0], 1)
                end sub
            `);
            await program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.mismatchArgumentCount(1, 2).message
            );
        });

        it('handles JavaScript reserved names', async () => {
            await program.addOrReplaceFile('source/file.brs', `
                sub constructor()
                end sub
                sub toString()
                end sub
                sub valueOf()
                end sub
                sub getPrototypeOf()
                end sub
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
        });

        it('Emits validation events', async () => {
            const validateStartScope = sinon.spy();
            const validateEndScope = sinon.spy();
            await program.addOrReplaceFile('source/file.brs', ``);
            await program.addOrReplaceFile('components/comp.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                </component>
            `);
            await program.addOrReplaceFile(s`components/comp.brs`, ``);
            const sourceScope = program.getScopeByName('source');
            const compScope = program.getScopeByName('components/comp.xml');
            program.plugins = new PluginInterface([{
                name: 'Emits validation events',
                beforeScopeValidate: validateStartScope,
                afterScopeValidate: validateEndScope
            }], undefined);
            await program.validate();
            expect(validateStartScope.callCount).to.equal(2);
            expect(validateStartScope.calledWith(sourceScope)).to.be.true;
            expect(validateStartScope.calledWith(compScope)).to.be.true;
            expect(validateEndScope.callCount).to.equal(2);
            expect(validateEndScope.calledWith(sourceScope)).to.be.true;
            expect(validateEndScope.calledWith(compScope)).to.be.true;
        });

        describe('custom types', () => {
            it('detects an unknown function return type', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
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
                await program.validate();
                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.invalidFunctionReturnType('unknownType').message,
                    DiagnosticMessages.invalidFunctionReturnType('unknownType').message
                ]);
            });

            it('detects an unknown function parameter type', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
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
                await program.validate();
                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.functionParameterTypeIsInvalid('unknownParam', 'unknownType').message,
                    DiagnosticMessages.functionParameterTypeIsInvalid('unknownParam', 'unknownType').message
                ]);
            });

            it('detects an unknown field parameter type', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    class myClass
                        foo as unknownType 'error
                    end class

                    class myOtherClass
                        foo as unknownType 'error
                        bar as myClass
                        buz as myOtherClass
                    end class
                `);
                await program.validate();
                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.expectedValidTypeToFollowAsKeyword().message,
                    DiagnosticMessages.expectedValidTypeToFollowAsKeyword().message
                ]);
            });

            it('finds custom types inside namespaces', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class

                        function foo(param as MyClass) as MyClass
                        end function

                        function bar(param as MyNamespace.MyClass) as MyNamespace.MyClass
                        end function

                    end namespace

                `);
                await program.validate();

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
            });

            it('finds custom types from other namespaces', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class
                    end namespace

                    function foo(param as MyNamespace.MyClass) as MyNamespace.MyClass
                    end function
                `);
                await program.validate();

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
            });

            it('detects missing custom types from current namespaces', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class

                        function foo() as UnknownType
                        end function
                    end namespace
                `);
                await program.validate();

                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.invalidFunctionReturnType('UnknownType').message
                ]);
            });

            it('finds custom types from other other files', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    function foo(param as MyClass) as MyClass
                    end function
                `);
                await program.addOrReplaceFile({ src: s`${rootDir}/source/MyClass.bs`, dest: s`source/MyClass.bs` }, `
                    class MyClass
                    end class
                `);
                await program.validate();

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
            });

            it('finds custom types from other other files', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    function foo(param as MyNameSpace.MyClass) as MyNameSpace.MyClass
                    end function
                `);
                await program.addOrReplaceFile({ src: s`${rootDir}/source/MyNameSpace.bs`, dest: s`source/MyNameSpace.bs` }, `
                    namespace MyNameSpace
                      class MyClass
                      end class
                    end namespace
                `);
                await program.validate();

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
            });

            it('detects missing custom types from another namespaces', async () => {
                await program.addOrReplaceFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    namespace MyNamespace
                        class MyClass
                        end class
                    end namespace

                    function foo() as MyNamespace.UnknownType
                    end function
                `);
                await program.validate();

                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.invalidFunctionReturnType('MyNamespace.UnknownType').message
                ]);
            });

            it('scopes types to correct scope', async () => {
                program = new Program({ rootDir: rootDir });

                await program.addOrReplaceFile('components/foo.xml', `
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="foo" extends="Scene">
                        <script uri="foo.bs"/>
                    </component>
                `);
                await program.addOrReplaceFile(s`components/foo.bs`, `
                    class MyClass
                    end class
                `);
                await program.validate();

                expect(program.getDiagnostics()[0]?.message).not.to.exist;

                await program.addOrReplaceFile('components/bar.xml', `
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="bar" extends="Scene">
                        <script uri="bar.bs"/>
                    </component>
                `);
                await program.addOrReplaceFile(s`components/bar.bs`, `
                    function getFoo() as MyClass
                    end function
                `);
                await program.validate();

                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.invalidFunctionReturnType('MyClass').message
                ]);
            });

            it('can reference types from parent component', async () => {
                program = new Program({ rootDir: rootDir });

                await program.addOrReplaceFile('components/parent.xml', `
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="parent" extends="Scene">
                        <script uri="parent.bs"/>
                    </component>
                `);
                await program.addOrReplaceFile(s`components/parent.bs`, `
                    class MyClass
                    end class
                `);
                await program.addOrReplaceFile('components/child.xml', `
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="child" extends="parent">
                        <script uri="child.bs"/>
                    </component>
                `);
                await program.addOrReplaceFile(s`components/child.bs`, `
                    function getFoo() as MyClass
                    end function
                `);

                await program.validate();

                expect(program.getDiagnostics()[0]?.message).not.to.exist;

            });
        });
    });

    describe('inheritance', () => {
        it('inherits callables from parent', async () => {
            program = new Program({ rootDir: rootDir });

            await program.addOrReplaceFile('components/child.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <script uri="child.brs"/>
                </component>
            `);
            await program.addOrReplaceFile(s`components/child.brs`, ``);
            await program.validate();
            let childScope = program.getComponentScope('child');
            expect(childScope.getAllCallables().map(x => x.callable.name)).not.to.include('parentSub');

            await program.addOrReplaceFile('components/parent.xml', `
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="parent" extends="Scene">
                    <script uri="parent.brs"/>
                </component>
            `);
            await program.addOrReplaceFile(s`components/parent.brs`, `
                sub parentSub()
                end sub
            `);
            await program.validate();

            expect(childScope.getAllCallables().map(x => x.callable.name)).to.include('parentSub');
        });
    });

    describe('detachParent', () => {
        it('does not attach global to itself', () => {
            expect(program.globalScope.getParentScope()).not.to.exist;
        });
    });

    describe('getDefinition', () => {
        it('returns empty list when there are no files', async () => {
            let file = await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, '');
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
});
