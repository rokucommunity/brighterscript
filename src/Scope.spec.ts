import { expect } from 'chai';
import * as sinonImport from 'sinon';
import { Position, Range } from 'vscode-languageserver';
import { standardizePath as s } from './util';
import { DiagnosticMessages } from './DiagnosticMessages';
import { Program } from './Program';
import { ParseMode } from './parser/Parser';
import PluginInterface from './PluginInterface';
import { expectZeroDiagnostics, trim } from './testHelpers.spec';
import { Logger } from './Logger';
import type { BrsFile } from './files/BrsFile';
import type { FunctionStatement, NamespaceStatement } from './parser';
import type { FunctionType } from './types/FunctionType';
import type { BrsFile } from './files/BrsFile';
import { isFloatType } from './astUtils/reflection';
import type { SymbolTable } from './SymbolTable';
import type { Scope } from './Scope';

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
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('flags parameter with same name as namespace', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
            end namespace
            sub main(nameA)
            end sub
        `);
        program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.eql(
            DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace('nameA').message
        );
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

            expect(sourceScope.getOwnFiles().map(x => x.srcPath).sort()).eql([
                s`${rootDir}/source/lib.brs`,
                s`${rootDir}/source/main.brs`
            ]);
            expect(program.getDiagnostics()).to.be.lengthOf(0);
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
            program.removeFile(file.srcPath);
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
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
        });
        it('resolves local-variable function calls', () => {
            program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                sub DoSomething()
                    sayMyName = function(name as string)
                    end function

                    sayMyName("hello")
                end sub`
            );
            program.validate();
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
            expect(program.getDiagnostics()).to.be.lengthOf(0);
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

            it('warns when local var has same name as built-in function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
            });

            it('warns when local var has same name as built-in function', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 6789
                        print str(12345) ' prints "12345" (i.e. our local variable did not override the callable global function)
                    end sub
                `);
                program.validate();
                let diagnostics = program.getDiagnostics();
                expect(diagnostics[0]?.message).not.to.exist;
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

        it('detects duplicate callables', () => {
            program.setFile('source/file.brs', `
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
            program.validate();
            //we should have the "DoA declared more than once" error twice (one for each function named "DoA")
            expect(program.getDiagnostics().map(x => x.message).sort()).to.eql([
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source').message,
                DiagnosticMessages.duplicateFunctionImplementation('DoA', 'source').message
            ]);
        });

        it('detects calls to unknown callables', () => {
            program.setFile('source/file.brs', `
                function DoA()
                    DoB()
                end function
            `);
            expect(program.getDiagnostics().length).to.equal(0);
            //validate the scope
            program.validate();
            expect(program.getDiagnostics()[0]).to.deep.include({
                code: DiagnosticMessages.callToUnknownFunction('DoB', '').code
            });
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
            expect(program.getDiagnostics().length).to.equal(0);
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
            expect(program.getDiagnostics().map(x => x.message)).to.eql([
                DiagnosticMessages.callToUnknownFunction('DoC', 'source').message
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
            expect(program.getDiagnostics().length).to.equal(0);
        });

        //We don't currently support someObj.callSomething() format, so don't throw errors on those
        it('does not fail on object callables', () => {
            expect(program.getDiagnostics().length).to.equal(0);
            program.setFile('source/file.brs', `
               function DoB()
                    m.doSomething()
                end function
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
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
            expect(program.getDiagnostics().map(x => x.message)).includes(
                DiagnosticMessages.mismatchArgumentCount(0, 1).message
            );
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
            expect(program.getDiagnostics().map(x => x.message)).to.includes(
                DiagnosticMessages.mismatchArgumentCount(1, 0).message
            );
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
            expect(program.getDiagnostics().length).to.equal(0);
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
            expect(program.getDiagnostics().map(x => x.message)).includes(
                DiagnosticMessages.mismatchArgumentCount('1-2', 0).message
            );
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
            expect(program.getDiagnostics().length).to.equal(0);
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
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.mismatchArgumentCount(1, 2).message
            );
        });

        it('Catches argument type mismatches on function calls', () => {
            program.setFile('source/file.brs', `
                sub a(age as integer)
                end sub
                sub b()
                    a("hello")
                end sub
            `);
            program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            );
        });

        it('Catches argument type mismatches on function calls for functions defined in another file', () => {
            program.setFile('source/file.brs', `
                sub a(age as integer)
                end sub
            `);
            program.setFile('source/file2.brs', `
                sub b()
                    a("hello")
                    foo = "foo"
                    a(foo)
                end sub
            `);
            program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            );
        });

        it('catches argument type mismatches on function calls within namespaces', () => {
            program.setFile('source/file.bs', `
                namespace Name.Space
                    sub a(param as integer)
                        print param
                    end sub

                    sub b()
                        a("hello")
                        foo = "foo"
                        a(foo)
                    end sub
                end namespace
                `);
            program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            );
        });

        it('catches argument type mismatches on function calls as arguments', () => {
            program.setFile('source/file1.bs', `
                    sub a(param as string)
                        print param
                    end sub

                    function getNum() as integer
                        return 1
                    end function

                    sub b()
                        a(getNum())
                    end sub
                `);
            program.validate();
            //should have an error
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            );
        });


        it('catches argument type mismatches on function calls within namespaces across files', () => {
            program.setFile('source/file1.bs', `
                namespace Name.Space
                    function getNum() as integer
                        return 1
                    end function

                    function getStr() as string
                        return "hello"
                    end function
                end namespace
                `);
            program.setFile('source/file2.bs', `
                namespace Name.Space
                    sub needsInt(param as integer)
                        print param
                    end sub

                    sub someFunc()
                        needsInt(getStr())
                        needsInt(getNum())
                    end sub
                end namespace
                `);
            program.validate();
            //should have an error
            expect(program.getDiagnostics().length).to.equal(1);
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            );
        });

        it('correctly validates correct parameters that are class members', () => {
            program.addOrReplaceFile('source/main.bs', `
            class PiHolder
                pi = 3.14
            end class

            sub takesFloat(fl as float)
            end sub

            sub someFunc()
                holder = new PiHolder()
                takesFloat(holder.pi)
            end sub`);
            program.validate();
            //should have no error
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('correctly validates wrong parameters that are class members', () => {
            program.addOrReplaceFile('source/main.bs', `
            class PiHolder
                pi = 3.14
                name = "hello"
            end class

            sub takesFloat(fl as float)
            end sub

            sub someFunc()
                holder = new PiHolder()
                takesFloat(holder.name)
            end sub`);
            program.validate();
            //should have error: holder.name is string
            expect(program.getDiagnostics().length).to.equal(1);
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('string', 'float').message
            );
        });

        it('allows conversions for arguments', () => {
            program.addOrReplaceFile('source/main.bs', `
            sub takesFloat(fl as float)
            end sub

            sub someFunc()
                takesFloat(1)
            end sub`);
            program.validate();
            //should have no error
            expect(program.getDiagnostics().length).to.equal(0);
        });

        it('allows subclasses as arguments', () => {
            program.addOrReplaceFile('source/main.bs', `

            class Animal
            end class

            class Dog extends Animal
            end class

            class Retriever extends Dog
            end class

            class Lab extends Retriever
            end class

            sub takesAnimal(thing as Animal)
            end sub

            sub someFunc()
                fido = new Lab()
                takesAnimal(fido)
            end sub`);
            program.validate();
            //should have no error
            expect(program.getDiagnostics().length).to.equal(0);
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
            expect(program.getDiagnostics()[0]?.message).not.to.exist;
        });

        it('Emits validation events', () => {
            const validateStartScope = sinon.spy();
            const validateEndScope = sinon.spy();
            program.setFile('source/file.brs', ``);
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                </component>
            `);
            program.setFile(s`components/comp.brs`, ``);
            const sourceScope = program.getScopeByName('source');
            const compScope = program.getScopeByName('pkg:/components/comp.xml');
            program.plugins = new PluginInterface([{
                name: 'Emits validation events',
                beforeScopeValidate: validateStartScope,
                afterScopeValidate: validateEndScope
            }], new Logger());
            program.validate();
            expect(validateStartScope.callCount).to.equal(2);
            expect(validateStartScope.getCalls()[0].args[0].scope).to.eql(sourceScope);
            expect(validateStartScope.getCalls()[1].args[0].scope).to.eql(compScope);
            expect(validateEndScope.callCount).to.equal(2);
            expect(validateEndScope.getCalls()[0].args[0].scope).to.eql(sourceScope);
            expect(validateEndScope.getCalls()[1].args[0].scope).to.eql(compScope);
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
                expect(program.getDiagnostics().map(x => x.message)).to.eql([
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
                expect(program.getDiagnostics().map(x => x.message)).to.eql([
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
                expect(program.getDiagnostics().map(x => x.message)).to.eql([
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

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
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

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
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

                expect(program.getDiagnostics().map(x => x.message)).to.eql([
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

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
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

                expect(program.getDiagnostics()[0]?.message).not.to.exist;
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

                expect(program.getDiagnostics().map(x => x.message)).to.eql([
                    DiagnosticMessages.invalidFunctionReturnType('MyNamespace.UnknownType').message
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

                expect(program.getDiagnostics()[0]?.message).not.to.exist;

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

                expect(program.getDiagnostics().map(x => x.message)).to.eql([
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

    describe('scope symbol tables', () => {
        it('adds symbols for the complete scope', () => {
            program.setFile('source/file.brs', `
                function funcInt() as integer
                    return 3
                end function

                function funcStr() as string
                    return "hello"
                end function
            `);
            program.setFile('source/file2.brs', `
                function funcBool() as boolean
                    return true
                end function

                function funcObject() as object
                    return {}
                end function
            `);
            const sourceSymbols = program.getScopeByName('source').symbolTable;

            expect((sourceSymbols.getSymbolType('funcInt') as FunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('funcStr') as FunctionType).returnType.toString()).to.equal('string');
            expect((sourceSymbols.getSymbolType('funcBool') as FunctionType).returnType.toString()).to.equal('boolean');
            expect((sourceSymbols.getSymbolType('funcObject') as FunctionType).returnType.toString()).to.equal('object');
        });

        it('adds updates symbol tables on invalidation', () => {
            program.setFile('source/file.brs', `
                function funcInt() as integer
                    return 3
                end function

                function funcStr() as string
                    return "hello"
                end function
            `);

            let sourceSymbols = program.getScopeByName('source').symbolTable;

            expect((sourceSymbols.getSymbolType('funcInt') as FunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('funcStr') as FunctionType).returnType.toString()).to.equal('string');
            program.getScopeByName('source').invalidate();

            program.setFile('source/file.brs', `
                function funcFloat() as float
                    return 3.14
                end function
            `);
            sourceSymbols = program.getScopeByName('source').symbolTable;

            expect(sourceSymbols.getSymbolType('funcInt')).to.be.undefined;
            expect(sourceSymbols.getSymbolType('funcStr')).to.be.undefined;
            expect((sourceSymbols.getSymbolType('funcFloat') as FunctionType).returnType.toString()).to.equal('float');
        });


        it('adds namespaced symbols tables to the scope', () => {
            program.setFile('source/file.brs', `
                function funcInt() as integer
                    return 1 + Name.Space.nsFunc2(1)
                end function
            `);
            program.setFile('source/namespace.brs', `
                namespace Name.Space
                    function nsFunc1() as integer
                        return 1
                    end function

                    function nsFunc2(num as integer) as integer
                        return num + Name.Space.nsFunc1()
                    end function
                end namespace
            `);
            const sourceScope = program.getScopeByName('source');
            const sourceSymbols = sourceScope.symbolTable;

            expect((sourceSymbols.getSymbolType('funcInt') as FunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('Name.Space.nsFunc1') as FunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('Name.Space.nsFunc2') as FunctionType).returnType.toString()).to.equal('integer');

        });

        it('merges namespace symbol tables in namespaceLookup', () => {
            program.setFile('source/ns1.brs', `
                namespace Name.Space
                    function nsFunc1() as integer
                        return 1
                    end function
                end namespace

                namespace Name
                    function outerNsFunc() as string
                        return "hello"
                    end function
                end namespace
            `);
            program.setFile('source/ns2.brs', `
                namespace Name.Space
                    function nsFunc2(num as integer) as integer
                        print Name.outerNsFunc()
                        return num + nsFunc1()
                    end function
                end namespace
            `);
            const sourceScope = program.getScopeByName('source');
            const mergedNsSymbolTable = sourceScope.namespaceLookup['name.space']?.symbolTable;
            expect(mergedNsSymbolTable).not.to.be.undefined;
            expect((mergedNsSymbolTable.getSymbolType('nsFunc1') as FunctionType).returnType.toString()).to.equal('integer');
            expect((mergedNsSymbolTable.getSymbolType('nsFunc2') as FunctionType).returnType.toString()).to.equal('integer');
            expect((mergedNsSymbolTable.getSymbolType('Name.Space.nsFunc2') as FunctionType).returnType.toString()).to.equal('integer');
            expect((mergedNsSymbolTable.getSymbolType('Name.outerNsFunc') as FunctionType).returnType.toString()).to.equal('string');
        });

        describe('lazytypes and scope', () => {
            const lazyTypeCode = `
                class KlassA
                    pi = 3.14

                    function getPi() as float
                        return m.pi
                    end function
                end class

                class KlassB
                    function getNewA() as KlassA
                       return new KlassA()
                    end function
                end class

                sub main()
                    a = new KlassA()
                    myPi = a.pi
                    myPiFromFunc = a.getPi()
                end sub
            `;
            let mainFile: BrsFile;
            let sourceScope: Scope;
            let mainSymbolTable: SymbolTable;

            beforeEach(() => {
                program.addOrReplaceFile('source/main.bs', lazyTypeCode);
                sourceScope = program.getScopeByName('source');
                mainFile = (sourceScope.getAllFiles()[0] as BrsFile);
                expect(mainFile).not.to.be.undefined;
                const mainFunc = mainFile.parser.references.functionStatementLookup.get('main').func;
                mainSymbolTable = mainFunc.symbolTable;
            });

            it('uses file context for lazyType field lookups', () => {
                const piSymbol = mainSymbolTable.getSymbolType('myPi', true, { file: mainFile, scope: sourceScope });
                expect(isFloatType(piSymbol)).to.be.true;
            });

            it('uses class members for lazyType method lookups', () => {
                const piSymbol = mainSymbolTable.getSymbolType('myPiFromFunc', true, { file: mainFile, scope: sourceScope });
                expect(isFloatType(piSymbol)).to.be.true;
            });

            it('uses class members for lazyType lookups on lookups', () => {
                const piSymbol = mainSymbolTable.getSymbolType('myPiFromFunc', true, { file: mainFile, scope: sourceScope });
                expect(isFloatType(piSymbol)).to.be.true;
            });
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
});
