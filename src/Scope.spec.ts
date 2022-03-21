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
import type { TypedFunctionType } from './types/TypedFunctionType';
import { isFloatType, isFunctionType } from './astUtils/reflection';
import type { SymbolTable } from './SymbolTable';
import type { Scope } from './Scope';
import { FunctionType } from './types/FunctionType';

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

            expect(sourceScope.getOwnFiles().map(x => x.srcPath).sort()).eql([
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
            expectZeroDiagnostics(program);
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

            it('warns when local var has same name as built-in function (shadow)', () => {
                program.setFile({ src: s`${rootDir}/source/main.brs`, dest: s`source/main.brs` }, `
                    sub main()
                        str = 12345
                        print str ' prints "12345" (i.e. our local variable is allowed to shadow the built-in function name)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('warns when local var has same name as built-in function (does not override)', () => {
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

        it('properly validates function chains on global callables', () => {
            program.setFile('source/file.brs', `
                sub testFunctionChainOnGlobalCallable()
                    print str(123).replace("1", "").trim()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('properly validates function chains on functions returning primitives', () => {
            program.setFile('source/file.brs', `
                function getStr(num as integer) as string
                    return num.toStr()
                end function

                sub testFunctionChainOnGlobalCallable()
                    print getStr(123).replace("1", "").trim()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
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

        it('does not fail on object callables', () => {
            expectZeroDiagnostics(program);
            program.setFile('source/file.brs', `
               function DoB()
                    m.doSomething = sub()
                    end sub
                    m.doSomething()
                end function
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expectZeroDiagnostics(program);
        });

        it('does not fail on primitive type callables', () => {
            expect(program.getDiagnostics().length).to.equal(0);
            program.setFile('source/file.brs', `
                sub takesInt(i as integer)
                end sub

                sub takesString(s as string)
                end sub

                function test()
                    myStr = "1234"
                    print myStr.toInt()
                    print myStr.toInt().toStr().trim()
                    takesString(myStr.toInt().toStr().trim())
                    myInt = 1234
                    print myInt.toStr()
                    print myInt.trim()
                    takesInt(myInt.trim().toInt())
                end function
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
        });

        it('does not fail on using fields of objects', () => {
            expect(program.getDiagnostics().length).to.equal(0);
            program.setFile('source/file.brs', `
                sub takesInt(i as integer)
                end sub

                sub takesObj(obj as object)
                  age = obj.age
                  takesInt(obj.age)
                  takesInt(age)
                end sub
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
        });


        it('does not fail on using array values ', () => {
            expect(program.getDiagnostics().length).to.equal(0);
            program.setFile('source/file.brs', `
                sub takesInt(i as integer)
                end sub

                sub takesArray(arr as object)
                    myArray = [1,2,3]
                    takesInt(arr[2])
                    takesInt(myArray[2])
                    arrVal = arr[2]
                    myArrayVal = myArray[2]
                    takesInt(arrVal)
                    takesInt(myArrayVal)
                end sub
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
        });

        it('does not fail on calling functions on objects', () => {
            expect(program.getDiagnostics().length).to.equal(0);
            program.setFile('source/file.brs', `
                sub takesObj(obj as object)
                  obj.someFunc()
                  obj.field.SomeFunc()
                end sub
            `);
            //validate the scope
            program.validate();
            //shouldn't have any errors
            expect(program.getDiagnostics().map(x => x.message)).to.eql([]);
        });

        it('does not fail on calling functions on array objects', () => {
            expect(program.getDiagnostics().length).to.equal(0);
            program.setFile('source/file.brs', `
                sub takesArray(arr as object)
                  arr.someFunc()
                  arr[0].anotherFunc()
                  arr[0].field.anotherFunc()
                end sub
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
            program.setFile('source/main.bs', `
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
            program.setFile('source/main.bs', `
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
            program.setFile('source/main.bs', `
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
            program.setFile('source/main.bs', `

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

        it('allows subclasses from namespaces as arguments', () => {
            program.setFile('source/main.bs', `

            class Outside
            end class

            class ChildOutExtendsInside extends NS.Inside
            end class

            namespace NS
                class Inside
                end class

                class ChildInExtendsOutside extends Outside
                end class

                class ChildInExtendsInside extends Inside
                    sub methodTakesInside(i as Inside)
                    end sub
                end class

                sub takesInside(klass as Inside)
                end sub

                sub testFuncInNamespace()
                    takesOutside(new Outside())
                    takesOutside(new NS.ChildInExtendsOutside())

                    ' These call NS.takesInside
                    takesInside(new NS.Inside())
                    takesInside(new Inside())
                    takesInside(new NS.ChildInExtendsInside())
                    takesInside(new ChildInExtendsInside())
                    takesInside(new ChildOutExtendsInside())

                    child = new ChildInExtendsInside()
                    child.methodTakesInside(new Inside())
                    child.methodTakesInside(new ChildInExtendsInside())
                    child.methodTakesInside(new ChildOutExtendsInside())
                end sub

            end namespace

            sub takesOutside(klass as Outside)
            end sub

            sub takesInside(klass as NS.Inside)
            end sub

            sub testFunc()
                takesOutside(new Outside())
                takesOutside(new NS.ChildInExtendsOutside())

                takesInside(new NS.Inside())
                takesInside(new NS.ChildInExtendsInside())
                takesInside(new ChildOutExtendsInside())

                NS.takesInside(new NS.Inside())
                NS.takesInside(new NS.ChildInExtendsInside())
                NS.takesInside(new ChildOutExtendsInside())

                child = new NS.ChildInExtendsInside()
                child.methodTakesInside(new NS.Inside())
                child.methodTakesInside(new NS.ChildInExtendsInside())
                child.methodTakesInside(new ChildOutExtendsInside())
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

            expect(plugin.onScopeValidate.callCount).to.equal(2);
            expect(plugin.onScopeValidate.getCalls().map(
                x => (x.args[0] as OnScopeValidateEvent).scope.name
            ).sort()).to.eql(scopeNames);

            expect(plugin.afterScopeValidate.callCount).to.equal(2);
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

            it('detects an unknown array type function parameter', () => {
                program.setFile({ src: s`${rootDir}/source/main.bs`, dest: s`source/main.bs` }, `
                    sub a(num as integer)
                    end sub

                    sub b(unknownParam as someType[]) 'error
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.functionParameterTypeIsInvalid('unknownParam', 'someType[]').message
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

            expect((sourceSymbols.getSymbolType('funcInt') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('funcStr') as TypedFunctionType).returnType.toString()).to.equal('string');
            expect((sourceSymbols.getSymbolType('funcBool') as TypedFunctionType).returnType.toString()).to.equal('boolean');
            expect((sourceSymbols.getSymbolType('funcObject') as TypedFunctionType).returnType.toString()).to.equal('object');
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

            expect((sourceSymbols.getSymbolType('funcInt') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('funcStr') as TypedFunctionType).returnType.toString()).to.equal('string');
            program.getScopeByName('source').invalidate();

            program.setFile('source/file.brs', `
                function funcFloat() as float
                    return 3.14
                end function
            `);
            sourceSymbols = program.getScopeByName('source').symbolTable;

            expect(sourceSymbols.getSymbolType('funcInt')).to.be.undefined;
            expect(sourceSymbols.getSymbolType('funcStr')).to.be.undefined;
            expect((sourceSymbols.getSymbolType('funcFloat') as TypedFunctionType).returnType.toString()).to.equal('float');
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

            expect((sourceSymbols.getSymbolType('funcInt') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('Name.Space.nsFunc1') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((sourceSymbols.getSymbolType('Name.Space.nsFunc2') as TypedFunctionType).returnType.toString()).to.equal('integer');

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
            const mergedNsSymbolTable = sourceScope.namespaceLookup.get('name.space')?.symbolTable;
            expect(mergedNsSymbolTable).not.to.be.undefined;
            expect((mergedNsSymbolTable.getSymbolType('nsFunc1') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((mergedNsSymbolTable.getSymbolType('nsFunc2') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((mergedNsSymbolTable.getSymbolType('Name.Space.nsFunc2') as TypedFunctionType).returnType.toString()).to.equal('integer');
            expect((mergedNsSymbolTable.getSymbolType('Name.outerNsFunc') as TypedFunctionType).returnType.toString()).to.equal('string');
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
                program.setFile('source/main.bs', lazyTypeCode);
                sourceScope = program.getScopeByName('source');
                mainFile = (sourceScope.getAllFiles()[0] as BrsFile);
                expect(mainFile).not.to.be.undefined;
                const mainFunc = mainFile.parser.references.functionStatementLookup.get('main').func;
                sourceScope.linkSymbolTable();
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

        it('can get fields on m from various files in component', () => {
            program = new Program({ rootDir: rootDir });

            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                    <script uri="comp.file1.brs"/>
                    <script uri="comp.file2.brs"/>
                    <script uri="comp.file3.brs"/>
                    <script uri="comp.helpers.brs"/>
                    <interface>
                      <field id="intField" type="integer" />
                      <function name="func1" />
                    </interface>
                    <children>
                      <Label id="myLabel" />
                    </children>
                </component>
            `);
            program.setFile(s`components/comp.brs`, `
                sub init()
                  m.name = "hello"
                  m.label = m.top.findNode("myLabel")
                  m.assignedTwice = "test"
                  m.someObj = {foo: "bar"}

                end sub
            `);
            program.setFile(s`components/comp.file1.brs`, `
                sub func1()
                  m.age = 13
                  m.pi = getPi()
                end sub
            `);
            program.setFile(s`components/comp.file2.brs`, `
                sub func2()
                  m.someObj.foo = getString()
                end sub

            `);
            program.setFile(s`components/comp.file3.brs`, `
                sub func3()
                  m.assignedTwice = 123
                end sub
            `);
            program.setFile(s`components/comp.helpers.brs`, `
                function getPi() as float
                    return 3.14
                end function

                function getString() as string
                    return "hello"
                end function
            `);

            program.validate();
            expectZeroDiagnostics(program);
            let result = program.getCompletions(`${rootDir}/components/comp.file3.brs`, Position.create(2, 20)); // completions on 'm.'
            let properties = result.map(x => x.label);
            expect(properties).to.contain('top');
            expect(properties).to.contain('name');
            expect(properties).to.contain('someObj');
            expect(properties).to.contain('assignedTwice');
            expect(properties).to.contain('label');
            expect(properties).to.contain('pi');

            let topResult = program.getCompletions(`${rootDir}/components/comp.brs`, Position.create(3, 34)); // completions on 'm.top.'
            let topProperties = topResult.map(x => x.label);
            expect(topProperties).to.contain('intField');
            expect(topProperties).not.to.contain('func1'); // TODO Types -  add functions from interface
        });


        it('can resolve self referential values', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile(s`source/main.brs`, `
                function trimName(name as string) as string
                    name = name.trim()
                    return name
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('can resolve self referential values in a loop', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile(s`source/main.brs`, `
                function trimName(names as object) as string
                    allNames = ""
                    for each name in names
                        name = name.trim()
                        allNames +=name
                    end for
                    return allNames
                end function

            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('handles when the same loop variable is used in multiple places from function calls', () => {
            program.setFile(s`source/main.brs`, `
            sub doLoop(someObj)
                for each datum in someObj.getArray()
                  print datum
                end for

                for each datum in someObj.getArray()
                  print datum
                end for
            end sub`);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('can call functions on object properties of m that extend from a parent', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile('components/child.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="child" extends="parent">
                    <script uri="child.brs"/>
                </component>
            `);
            program.setFile(s`components/child.brs`, `
                sub init()
                    m.name = getName()
                    m.pi = m.objProp.getPi()
                    print m.pi
                end sub

                function getName() as string
                    return "Bob"
                end function
            `);
            program.setFile('components/parent.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="parent" extends="Scene">
                    <script uri="parent.brs"/>
                </component>
            `);
            program.setFile(s`components/parent.brs`, `
                sub init()
                  m.objProp = getObj()
                end sub

                function getObj()
                    return {
                        getPi: function () as float
                          return 3.14
                        end function
                    }
                end function
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('can call functions on properties of m that extend from a parent', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.1.brs"/>
                    <script uri="comp.2.brs"/>
                </component>
            `);
            program.setFile(s`components/comp.1.brs`, `
                sub init()
                    m.pi = getPi()
                    piStr = m.pi.toStr()
                    print piStr
                end sub
            `);
            program.setFile(s`components/comp.2.brs`, `
                function getName()
                    return "Bob"
                end function

                function getPi()
                    return 3.14
                end function
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('can call functions on m.top', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Scene">
                    <script uri="comp.brs"/>
                    <children>
                      <Label id="myLabel" />
                    </children>
                </component>
            `);
            program.setFile(s`components/comp.brs`, `
                sub init()
                    m.label = m.top.findNode("myLabel")
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('can validate shared functions between components', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile('components/comp1.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp1" extends="Group">
                    <script uri="comp1.brs"/>
                    <script type="text/brightscript" uri="pkg:/source/helpers.brs" />
                    <children>
                      <Label id="myLabel" />
                    </children>
                </component>
            `);
            program.setFile(s`components/comp1.brs`, `
                sub init()
                    m.foo = "foo"
                    printFoo(3)
                end sub
            `);
            program.setFile('components/comp2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp2" extends="Group">
                    <script uri="comp2.brs"/>
                    <script type="text/brightscript" uri="pkg:/source/helpers.brs" />
                    <children>
                        <Label id="myLabel" />
                    </children>
                </component>
            `);
            program.setFile(s`components/comp2.brs`, `
                sub init()
                    m.foo ="bar"
                    printFoo(2)
                    printFoo("test") ' this is invalid
                end sub
            `);
            program.setFile(s`source/helpers.brs`, `
                sub printFoo(num as integer)
                    print lcase(m.foo)+num.toStr()
                end sub
            `);

            program.validate();
            const diagnostics = program.getDiagnostics();
            expect(diagnostics.length).to.equal(1);
            expect(diagnostics.map(x => x.message)).to.eql([
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message]);
        });

        it('can determine properties on m from grand-parent components', () => {
            program = new Program({ rootDir: rootDir });
            program.setFile('components/comp.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="comp" extends="Group">
                    <script uri="comp.brs"/>
                    <children>
                      <Label id="myLabel" />
                    </children>
                </component>
            `);
            program.setFile(s`components/comp.brs`, `
                sub init()
                    m.label = m.top.findNode("myLabel")
                end sub
            `);
            program.setFile('components/compChild.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="compChild" extends="comp">
                    <script uri="compChild.brs"/>
                </component>
            `);
            program.setFile(s`components/compChild.brs`, `
                sub init()
                    m.foo = "foo"
                end sub
            `);
            program.setFile('components/compGrandChild.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="compGrandChild" extends="CompChild">
                    <script uri="compGrandChild.brs"/>
                </component>
            `);
            program.setFile(s`components/compGrandChild.brs`, `
                sub init()
                    m.obj = {name: "Bill", age: 44}
                    m.label.callFunc("") ' below checks for completions on this line
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
            let result = program.getCompletions(`${rootDir}/components/compGrandChild.brs`, Position.create(3, 22)); // completions on 'm.'
            let properties = result.map(x => x.label);
            expect(properties).to.contain('top');
            expect(properties).to.contain('obj');
            expect(properties).to.contain('label');
            expect(properties).to.contain('foo');
        });

        it('allows `Function` param type to have zero or more parameters', () => {
            program.setFile('source/main.brs', `
                sub callFuncWithParam(func as Function, value)
                    func(value)
                end sub

                sub printValue(value)
                    print value
                end sub

                sub main()
                    callFuncWithParam(printValue, "hello world")
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows any functional param to match `as Function` ', () => {
            program.setFile('source/main.brs', `
                sub callFuncWithParam(func as Function)
                    print func
                end sub

                sub printValue(value)
                    print value
                end sub

                sub main()
                    callFuncWithParam(printValue)
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates a non-function being used where a function is expected as a parameter', () => {
            program.setFile('source/main.brs', `
                sub callFuncWithParam(func as Function)
                    func("helloWorld")
                end sub

                sub printValue(value)
                    print value
                end sub

                sub main()
                    myString = "hello"
                    callFuncWithParam(myString) ' error
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', (new FunctionType()).toString()).message
            ]);
        });

        it('allows a function result to be used as a parameter ', () => {
            program.setFile('source/main.brs', `
                sub callFuncWithParam(func as Function)
                    print func
                end sub

                function getFunc() as Function
                    return printValue
                end function

                sub printValue(value)
                    print value
                end sub

                sub main()
                    callFuncWithParam(getFunc())
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows a universal function result to be used as an assignment ', () => {
            program.setFile('source/main.brs', `
                sub callFuncWithParam(func as Function)
                    print func
                end sub

                function getFunc() as Function
                    return printValue
                end function

                sub printValue(value)
                    print value
                end sub

                sub main()
                    someFunc = getFunc()
                    callFuncWithParam(someFunc)
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
            const mainSymbolTable = (program.getScopeByName('source')?.getAllFiles()[0] as BrsFile)?.parser.references.functionStatementLookup.get('main')?.func.symbolTable;
            expect(mainSymbolTable).not.to.be.undefined;
            expect(isFunctionType(mainSymbolTable.getSymbolType('someFunc'))).to.be.true;
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
            program.setFile('source/main.bs', `
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
