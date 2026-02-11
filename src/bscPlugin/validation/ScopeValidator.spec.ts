import * as sinonImport from 'sinon';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Program } from '../../Program';
import { expectDiagnostics, expectDiagnosticsIncludes, expectTypeToBe, expectZeroDiagnostics, trim } from '../../testHelpers.spec';
import { expect } from 'chai';
import type { TypeCompatibilityData } from '../../interfaces';
import { IntegerType } from '../../types/IntegerType';
import { StringType } from '../../types/StringType';
import type { BrsFile } from '../../files/BrsFile';
import { FloatType, InterfaceType, TypedFunctionType, VoidType, BooleanType, ArrayType } from '../../types';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import undent from 'undent';
import * as fsExtra from 'fs-extra';
import { tempDir, rootDir } from '../../testHelpers.spec';
import { isReturnStatement } from '../../astUtils/reflection';
import { ScopeValidator } from './ScopeValidator';
import type { ReturnStatement } from '../../parser/Statement';
import { Logger } from '@rokucommunity/logger';

describe('ScopeValidator', () => {

    let sinon = sinonImport.createSandbox();
    let program: Program;

    beforeEach(() => {
        fsExtra.emptyDirSync(tempDir);
        program = new Program({
            rootDir: rootDir
        });
        program.createSourceScope();
    });

    afterEach(() => {
        sinon.restore();
        program.dispose();
    });

    it('validateReturnStatement does not crash', () => {
        program.options.autoImportComponentScript = true;
        program.setFile('components/Component.xml', trim`
            <component name="Test" extends="Group">
            </component>
        `);
        const file = program.setFile<BrsFile>('components/Component.bs', trim`
            function test()
                return {
                    method: function()
                        return true
                    end function
                }
            end function
        `);
        const returnStatement = file.ast.findChild<ReturnStatement>(isReturnStatement);
        delete returnStatement.parent;
        const validator = new ScopeValidator();
        //should not crash
        validator['validateReturnStatement'](file, returnStatement);
    });

    describe('mismatchArgumentCount', () => {
        it('detects calling functions with too many arguments', () => {
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

        it('detects calling class constructors with too many arguments', () => {
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

        it('detects calling functions with too few arguments', () => {
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


        it('allows any number of parameters in a function used as an argument', () => {
            program.setFile('source/file.brs', `
                    sub tryManyParams(someFunc as function)
                        someFunc(1, 2, "hello", "world")
                    end sub
                `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('checks for at least the number of non-optional args on variadic (callFunc) functions', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', `
                sub someFunc(input as object)
                    print input
                end sub
            `);
            program.setFile('source/util.bs', `
                sub useCallFunc(input as roSGNodeWidget)
                    input.callFunc()
                end sub
            `);
            program.validate();
            //should have an error
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount('1-63', 0)
            ]);
        });

        it('any number number of args on variadic (callFunc) functions', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', `
                sub someFunc(input as object)
                    print input
                end sub
            `);
            program.setFile('source/util.bs', `
                sub useCallFunc(input as roSGNodeWidget, funcToCall as string)
                    input.callFunc(funcToCall, 1, 2, 3, {})
                end sub
            `);
            program.validate();
            // no error, because we can't know what function you're actually calling
            expectZeroDiagnostics(program);
        });


        it('checks for target args count on callfunc', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.brs"/>
                    <interface>
                        <function name="someFunc" />
                    </interface>
                </component>
            `);
            program.setFile('components/Widget.brs', `
                sub someFunc(input as object)
                    print input
                end sub
            `);
            program.setFile('source/util.bs', `
                sub useCallFunc(input as roSGNodeWidget)
                    input.callFunc("someFunc", 1, 2, 3, {})
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(2, 5)
            ]);
        });

        it('validates against scope-defined func in inner namespace, when outer namespace has same named func', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub foo()
                    end sub

                    namespace beta
                        sub bar()
                            foo()
                        end sub
                    end namespace
                end namespace

                function foo(x as integer) as integer
                    return x
                end function
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(1, 0).message
            ]);
        });

        it('validates against functions defined in intersection types', () => {
            program.setFile('source/main.bs', `
                interface IFirst
                    num as integer
                end interface
                interface ISecond
                    function doThing2(a as integer, b as string) as void
                end interface

                sub main(thing as IFirst and ISecond)
                    thing.doThing2(thing.num)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(2, 1).message
            ]);
        });

        it('validates against typed functions types', () => {
            program.setFile('source/main.bs', `
                sub main(cb as function(num as integer, name as string) as void)
                    cb(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(2, 1).message
            ]);
        });

        it('validates against typed functions types from type statements', () => {
            program.setFile('source/main.bs', `
                type Callback = function(num as integer, name as string) as void
                sub main(cb as Callback)
                    cb(1)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount(2, 1).message
            ]);
        });
    });

    describe('argumentTypeMismatch', () => {
        it('param `as object` supports all known types', () => {
            program.setFile('source/file.bs', `
                sub main()
                    consoleLog(Direction.up)
                    consoleLog(true)
                    consoleLog(main)
                    consoleLog(1.2)
                    consoleLog({} as Video)
                    consoleLog("test")
                end sub

                sub consoleLog(thing as object)
                    print thing
                end sub

                interface Video
                    url as string
                end interface
                enum Direction
                    up = "up"
                    down = "down"
                end enum
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('`as object` var can be passed to various param types', () => {
            program.setFile('source/file.bs', `
                sub main()
                    obj = {} as object

                    printBoolean(obj)
                    printClass(obj)
                    printDouble(obj)
                    printEnum(obj)
                    printFloat(obj)
                    printFunction(obj)
                    printInteger(obj)
                    printInterface(obj)
                    printLongInteger(obj)
                    printString(obj)
                end sub

                sub printBoolean(value as boolean)
                    print value
                end sub

                class Person
                    name as string
                end class

                sub printClass(value as Person)
                    print value
                end sub

                sub printDouble(value as double)
                    print value
                end sub

                enum Direction
                    up = "up"
                end enum

                sub printEnum(value as Direction)
                    print value
                end sub

                sub printFloat(value as float)
                    print value
                end sub

                sub printFunction(value as function)
                    print value
                    print value(1)
                end sub

                interface Video
                    url as string
                end interface

                sub printInterface(value as Video)
                    print value
                end sub

                sub printInteger(value as integer)
                    print value
                end sub

                sub printLongInteger(value as LongInteger)
                    print value
                end sub

                sub printString(value as string)
                    print value
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('treats string enums as strings when assigned to string vars', () => {
            program.setFile('source/file.bs', `
                sub main()
                    printDirection(Direction.up)
                end sub

                sub printDirection(theDirection as string)
                    print theDirection
                end sub

                enum Direction
                    up = "up"
                    down = "down"
                end enum
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not treat strings as a string enum', () => {
            program.setFile('source/file.bs', `
                sub main()
                    printDirection("up")
                end sub

                sub printDirection(theDirection as Direction)
                    print theDirection
                end sub

                enum Direction
                    up = "up"
                    down = "down"
                end enum

            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'Direction').message
            ]);
        });

        it('supports passing enum type as enum type', () => {
            program.setFile('source/file.bs', `
                sub test(theDirection as Direction)
                    printDirection(theDirection)
                end sub

                sub printDirection(theDirection as Direction)
                    print theDirection
                end sub

                enum Direction
                    up = "up"
                    down = "down"
                end enum
            `);
            program.validate();
            expectDiagnostics(program, [
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
                    function getPi() as float
                        return m.pi
                    end function
                end class

                sub takesFloat(fl as float)
                end sub

                sub someFunc()
                    holder = new PiHolder()
                    takesFloat(holder.pi)
                    takesFloat(holder.getPI())
                end sub`);
            program.validate();
            //should have no error
            expectZeroDiagnostics(program);
        });

        it('correctly validates wrong parameters that are class members', () => {
            program.setFile('source/main.bs', `
                class PiHolder
                    pi = 3.14
                    name = "hello"
                    function getPi() as float
                        return m.pi
                    end function
                end class

                sub takesFloat(fl as float)
                end sub

                sub someFunc()
                    holder = new PiHolder()
                    takesFloat(holder.name)
                    takesFloat(Str(holder.getPI()))
                end sub`);
            program.validate();
            //should have error: holder.name is string
            expect(program.getDiagnostics().length).to.equal(2);
            expect(program.getDiagnostics().map(x => x.message)).to.include(
                DiagnosticMessages.argumentTypeMismatch('string', 'float').message
            );
        });

        it('correctly validates correct parameters that are interface members', () => {
            program.setFile('source/main.bs', `
                interface IPerson
                    height as float
                    name as string
                    function getWeight() as float
                    function getAddress() as string
                end interface

                sub takesFloat(fl as float)
                end sub

                sub someFunc(person as IPerson)
                    takesFloat(person.height)
                    takesFloat(person.getWeight())
                end sub`);
            program.validate();
            //should have no error
            expectZeroDiagnostics(program);
        });

        it('correctly validates wrong parameters that are interface members', () => {
            program.setFile('source/main.bs', `
                    interface IPerson
                        isAlive as boolean
                        function getAddress() as string
                    end interface

                    sub takesFloat(fl as float)
                    end sub

                    sub someFunc(person as IPerson)
                        takesFloat(person.isAlive)
                        takesFloat(person.getAddress())
                    end sub
                `);
            program.validate();
            //should have 2 errors: person.name is string (not float) and person.getAddress() is object (not float)
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('boolean', 'float').message,
                DiagnosticMessages.argumentTypeMismatch('string', 'float').message
            ]);
        });

        it('`as object` param allows all types', () => {
            program.setFile('source/main.bs', `
                    sub takesObject(obj as Object)
                    end sub

                    sub main()
                        takesObject(true)
                        takesObject(1)
                        takesObject(1.2)
                        takesObject(1.2#)
                        takesObject("text")
                        takesObject({})
                        takesObject([])
                    end sub
                `);
            program.validate();
            expectZeroDiagnostics(program);
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
            expectZeroDiagnostics(program);
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
            expectZeroDiagnostics(program);
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
            expectZeroDiagnostics(program);
        });

        it('respects union types', () => {
            program.setFile('source/main.bs', `
                sub takesStringOrKlass(p as string or Klass)
                end sub

                class Klass
                end class

                sub someFunc()
                    myKlass = new Klass()
                    takesStringOrKlass("test")
                    takesStringOrKlass(myKlass)
                    takesStringOrKlass(1)
                end sub`);
            program.validate();
            //should have error when passed an integer
            expect(program.getDiagnostics().length).to.equal(1);
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string or Klass').message
            ]);
        });


        it('validates functions assigned to variables', () => {
            program.setFile('source/main.bs', `
                sub someFunc()
                    myFunc = function(i as integer, s as string)
                        print i+1
                        print s.len()
                    end function
                    myFunc("hello", 2)
                end sub`);
            program.validate();
            //should have error when passed incorrect types
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message,
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });

        it('allows any parameter types in a function passed as an argument', () => {
            program.setFile('source/file.brs', `
                    function getStrLength(name as string) as integer
                        return len(name)
                    end function

                    sub tryManyParams(someFunc as function)
                        print someFunc(1, 2, "hello", "world")
                    end sub

                    sub test()
                        tryManyParams(getStrLength)
                    end sub
                `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('allows a inline function as an argument of type function', () => {
            program.setFile('source/file.brs', `
                    sub tryManyParams(someFunc as function)
                        print someFunc(1, 2, "hello", "world")
                    end sub

                    sub test()
                        tryManyParams(sub (i as integer)
                            print i
                        end sub)
                    end sub
                `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('validates when a non-function is used as an argument expecting a function', () => {
            program.setFile('source/file.brs', `
                    sub tryManyParams(someFunc as function)
                        print someFunc(1, 2, "hello", "world")
                    end sub

                    sub test()
                        notAFunction = 3.14
                        tryManyParams(notAFunction)
                    end sub
                `);
            program.validate();
            //should have an error that the argument is not a function
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'function').message
            ]);
        });

        it('allows a class constructor to be passed as arg to param typed `as function`', () => {
            program.setFile('source/file.bs', `
                sub callSomeFunc(someFunc as function)
                    someFunc()
                end sub

                class MyKlass
                end class

                sub doStuff()
                callSomeFunc(MyKlass)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows a namespaced class constructor to be passed as arg to param typed `as function`', () => {
            program.setFile('source/file.bs', `
                sub callSomeFunc(someFunc as function)
                    someFunc()
                end sub

                namespace Alpha
                    class MyKlass
                    end class

                    sub doStuff()
                        callSomeFunc(MyKlass)
                    end sub
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows any variable to passed as argument to an untyped param with default type invalid', () => {
            program.setFile('source/util.brs', `
                sub doSomething(x = invalid)
                    print x
                end sub

                sub tests()
                    doSomething(1)
                    doSomething(1.1)
                    doSomething("Hello")
                    doSomething(true)
                    doSomething({test: true})
                end sub
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('allows calling future function and save to same variable', () => {
            program.setFile('source/util.brs', `
                function getSomeInt() as integer
                    numVal = getUntypedNum()
                    numVal = cInt(numVal)
                    return numVal
                end function

                function getUntypedNum()
                    return 1
                end function
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('allows union types of all compatible types as arg', () => {
            program.setFile('source/util.bs', `
                sub printIntNum(num as float or double or integer)
                    print cInt(num)
                end sub
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('allows function calls of built-in members of primitives', () => {
            program.setFile('source/util.brs', `
                sub doSomething()
                    myStr = "Hello World"
                    myStr = myStr.replace("World", "You")
                    print myStr
                end sub
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('validates union types of all compatible types as arg - when some do not work', () => {
            program.setFile('source/util.bs', `
                sub printIntNum(maybeNum as float or string)
                    print cInt(maybeNum)
                end sub
            `);
            program.validate();
            //should have no errors
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float or string', 'float').message
            ]);
        });

        it('validates function calls of built-in members of primitives', () => {
            program.setFile('source/util.brs', `
                sub doSomething()
                    myStr = "Hello World"
                    notAString = 3.14
                    myStr = myStr.replace("World", notAString)
                    print myStr
                end sub
            `);
            program.validate();
            //should have error - 2nd param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'string').message
            ]);
        });

        it('validates method calls of classes', () => {
            program.setFile('source/util.bs', `
                class Klass
                    sub test(input as string)
                    end sub
                end class

                sub doSomething()
                    k = new Klass()
                    k.test(3.14)
                end sub
            `);
            program.validate();
            //should have error - param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'string').message
            ]);
        });

        it('validates inside method calls of classes', () => {
            program.setFile('source/util.bs', `
                class Klass
                    sub test(input as string)
                    end sub

                    sub otherTest()
                        m.test(3.14)
                    end sub
                end class
            `);
            program.validate();
            //should have error - param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'string').message
            ]);
        });

        it('validates calls of a constructor', () => {
            program.setFile('source/util.bs', `
                class Klass
                   sub new(name as string)
                   end sub
                end class

                sub createKlass()
                    k = new Klass(3.14)
                end sub
            `);
            program.validate();
            //should have error - param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'string').message
            ]);
        });

        it('validates super calls in a constructor', () => {
            program.setFile('source/util.bs', `
                class Klass
                   sub new(name as string)
                   end sub
                end class

                class SubKlass extends Klass
                    sub new()
                        super(3.14)
                    end sub
                end class
            `);
            program.validate();
            //should have error - param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'string').message
            ]);
        });

        it('validates super calls in a class methods', () => {
            program.setFile('source/util.bs', `
                class Klass
                   sub test(name as string)
                   end sub
                end class

                class SubKlass extends Klass
                    sub test2()
                        super.test(3.14)
                    end sub
                end class
            `);
            program.validate();
            //should have error - param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('float', 'string').message
            ]);
        });


        it('validates a function passed as an arg', () => {
            program.setFile('source/util.bs', `
                sub foo()
                    getPi = function()
                        return 3.14
                    end function
                    bar(getPi)
                end sub


                sub bar(num as integer)
                    print num
                end sub
            `);
            program.validate();
            //should have error - param should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('function () as dynamic', 'integer').message
            ]);
        });


        it('allows AAs that match an interface to be passed as args', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    takesMyIface({beta: "hello", charlie: "world"})
                end sub

                sub takesMyIface(iFace as MyIFace)
                end sub

                interface MyIFace
                    beta as string
                    charlie as string
                end interface
            `);
            program.validate();
            //should have error
            expectZeroDiagnostics(program);
        });

        it('validates empty AAs that are passed as args to param expecting interface', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    takesMyIface({})
                end sub

                sub takesMyIface(iFace as MyIFace)
                end sub

                interface MyIFace
                    beta as string
                    charlie as string
                end interface
            `);
            program.validate();
            //should have error
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'MyIFace', {
                    missingFields: [{ name: 'beta', expectedType: StringType.instance }, { name: 'charlie', expectedType: StringType.instance }]
                }).message
            ]);
        });

        it('includes data on missing fields', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    takesMyIface({charlie: "hello"})
                end sub

                sub takesMyIface(iFace as MyIFace)
                end sub

                interface MyIFace
                    beta as string
                    charlie as integer
                end interface
            `);
            program.validate();

            //should have error
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'MyIFace', {
                    missingFields: [{ name: 'beta', expectedType: StringType.instance }],
                    fieldMismatches: [{ name: 'charlie', expectedType: IntegerType.instance, actualType: StringType.instance }]
                }).message
            ]);

            //The aa should have 'beta' and 'charlie' properties of type string and integer
            const diagnostics = program.getDiagnostics();
            expect(diagnostics.length).to.eq(1);
            const data: TypeCompatibilityData = diagnostics[0].data;
            expect(data.missingFields.length).to.eq(1);
            expect(data.missingFields[0].name).to.eq('beta');
            expectTypeToBe(data.missingFields[0].expectedType, StringType);
            expect(data.fieldMismatches.length).to.eq(1);
            expect(data.fieldMismatches[0].name).to.eq('charlie');
            expectTypeToBe(data.fieldMismatches[0].expectedType, IntegerType);
            expectTypeToBe(data.fieldMismatches[0].actualType, StringType);
        });

        it('allows interfaces that have a superset of properties', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    takesMyIface({alpha: true, beta: "hello", charlie: 1})
                end sub

                sub takesMyIface(iFace as MyIFace)
                end sub

                interface MyIFace
                    beta as string
                    charlie as integer
                end interface
            `);
            program.validate();

            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('allows interfaces that have a superset of properties', () => {
            program.setFile('source/util.bs', `
                sub doStuff(otherFace as MyOtherFace)
                    takesMyIface(otherFace)
                end sub

                sub takesMyIface(iFace as MyIFace)
                end sub

                interface MyIFace
                    beta as string
                    charlie as integer
                end interface

                interface MyOtherFace
                    alpha as boolean
                    beta as string
                    charlie as integer
                end interface
            `);
            program.validate();

            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('includes data on missing fields', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    takesMyIface({charlie: "hello"})
                end sub

                sub takesMyIface(iFace as MyIFace)
                end sub

                interface MyIFace
                    beta as string
                    charlie as integer
                end interface
            `);
            program.validate();

            //should have error
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'MyIFace', {
                    missingFields: [{ name: 'beta', expectedType: StringType.instance }],
                    fieldMismatches: [{ name: 'charlie', expectedType: IntegerType.instance, actualType: StringType.instance }]
                }).message
            ]);

            //The aa should have 'beta' and 'charlie' properties of type string and integer
            const diagnostics = program.getDiagnostics();
            expect(diagnostics.length).to.eq(1);
            const data: TypeCompatibilityData = diagnostics[0].data;
            expect(data.missingFields.length).to.eq(1);
            expect(data.missingFields[0].name).to.eq('beta');
            expectTypeToBe(data.missingFields[0].expectedType, StringType);
            expect(data.fieldMismatches.length).to.eq(1);
            expect(data.fieldMismatches[0].name).to.eq('charlie');
            expectTypeToBe(data.fieldMismatches[0].expectedType, IntegerType);
            expectTypeToBe(data.fieldMismatches[0].actualType, StringType);
        });

        it('allows a non-built-in void function as an argument', () => {
            program.setFile<BrsFile>('source/main.bs', `
                sub voidFunc() as void
                end sub

                sub doPrint(x)
                    print x
                end sub

                sub useVoidAsArg()
                    doPrint(voidFunc()) ' will print "invalid"
                end sub
                `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates a built-in void function as an argument', () => {
            program.setFile<BrsFile>('source/main.bs', `
                sub doPrint(x)
                    print x
                end sub

                sub useVoidAsArg()
                    arr = [1,2,3]
                    doPrint(arr.push(4))
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('uninitialized', 'dynamic').message
            ]);
        });

        describe('default params', () => {
            it('generalizes EnumMembers to their parent types', () => {
                program.setFile('source/util.bs', `
                    sub takesEnum(enumVal = Direction.South)
                        print enumVal
                    end sub

                    sub callTestFunc()
                        takesEnum(Direction.North)
                    end sub

                    enum Direction
                        North
                        South
                    end enum
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('works with future declared types', () => {
                program.setFile('source/util.bs', `
                    sub takesKlass(klassInstance = new Klass())
                        print klassInstance
                    end sub

                    sub callTestFunc()
                        takesKlass()
                        myKlass = new Klass()
                        takesKlass(myKlass)
                    end sub

                    class Klass
                        name as string
                    end class
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('validates against future declared types', () => {
                program.setFile('source/util.bs', `
                    sub takesKlass(klassInstance = new Klass())
                        print klassInstance
                    end sub

                    sub callTestFunc()
                        myOKlass = new OtherKlass()
                        takesKlass(myOKlass)
                    end sub

                    class Klass
                        name as string
                    end class

                     class OtherKlass
                        name as integer
                    end class
                `);
                program.validate();
                //should have no errors
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('OtherKlass', 'Klass').message
                ]);
            });

            it('validates against future declared types in different namespace', () => {
                program.setFile('source/util.bs', `
                    sub takesKlass(klassInstance = new alpha.beta.Klass())
                        print klassInstance
                    end sub

                    sub callTestFunc()
                        myOKlass = new alpha.beta.OtherKlass()
                        takesKlass(myOKlass)
                    end sub

                    namespace alpha.beta
                        class Klass
                            name as string
                        end class

                        class OtherKlass
                            name as integer
                        end class
                    end namespace
                `);
                program.validate();
                //should have no errors
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('alpha.beta.OtherKlass', 'alpha.beta.Klass').message
                ]);
            });

            it('should correctly be able to modify an array with enum initial values', () => {
                program.setFile<BrsFile>('source/util.bs', `
                    function alsoGoEast(path = [Direction.North, Direction.South])
                        path.Push(Direction.East) ' "path" should be typed as Array<Direction>
                        return path
                    end function

                    enum Direction
                        North = "North"
                        South = "South"
                        East = "East"
                        West = "West"
                    end  enum
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        describe('array compatibility', () => {
            it('accepts dynamic when assigning to a roArray', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as roArray)
                    end sub

                    sub doStuff(someArray)
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('accepts roArray when assigning to a roArray', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as roArray)
                    end sub

                    sub doStuff(someArray as roArray)
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('accepts typed arrays when assigning to a roArray', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as roArray)
                    end sub

                    sub doStuff(someArray as dynamic[])
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });


            it('accepts roArray when assigning to dynamic[]', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as dynamic[])
                    end sub

                    sub doStuff(someArray as roArray)
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('accepts roArray when assigning to typed array', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as string[])
                    end sub

                    sub doStuff(someArray as roArray)
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('validates when typed array types are incompatible', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as string[])
                    end sub

                    sub doStuff(someArray as integer[])
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have errors
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('Array<integer>', 'Array<string>').message
                ]);
            });

            it('accepts when typed array types are compatible', () => {
                program.setFile('source/util.bs', `
                    sub takesArray(arr as float[])
                    end sub

                    sub doStuff(someArray as integer[])
                        takesArray(someArray)
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });
        });

        describe('interface with optional properties', () => {

            it('allows using interfaces with optional props', () => {
                program.setFile('source/util.bs', `
                    function takesIFace(iface as MyIFace) as string
                        if invalid <> iface.name
                            return iface.name
                        else if invalid <> iface.data
                            return FormatJson(iface.data)
                        end if
                        return "no"
                    end function

                    sub doStuff(iface as MyIFace)
                        print takesIFace(iface)
                    end sub

                    interface MyIFace
                        optional name as string
                        optional data
                    end interface
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows using passing AAs with missing optional properties', () => {
                program.setFile('source/util.bs', `
                    function takesIFace(iface as MyIFace) as string
                        if invalid <> iface.name
                            return iface.name
                        else if invalid <> iface.data
                            return FormatJson(iface.data)
                        end if
                        return "no"
                    end function

                    sub doStuff(iface as MyIFace)
                        print takesIFace({name: "Hello"})
                    end sub

                    interface MyIFace
                        optional name as string
                        optional data
                    end interface
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('disallows using AAs with bad types for optional properties', () => {
                program.setFile('source/util.bs', `
                    function takesIFace(iface as MyIFace) as string
                        if invalid <> iface.name
                            return iface.name
                        else if invalid <> iface.data
                            return FormatJson(iface.data)
                        end if
                        return "no"
                    end function

                    sub doStuff(iface as MyIFace)
                        print takesIFace({name: 3.14})
                    end sub

                    interface MyIFace
                        optional name as string
                        optional data
                    end interface
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'MyIFace', {
                        fieldMismatches: [{ name: 'name', expectedType: StringType.instance, actualType: FloatType.instance }]
                    }).message
                ]);
            });

            it('disallows passing classes with bad types for optional properties', () => {
                program.setFile('source/util.bs', `
                    function takesIFace(iface as MyIFace) as string
                        if invalid <> iface.name
                            return iface.name
                        else if invalid <> iface.data
                            return FormatJson(iface.data)
                        end if
                        return "no"
                    end function

                    sub doStuff(iface as MyIFace)
                        k = new MyKlass()
                        print takesIFace(k)
                    end sub

                    interface MyIFace
                        optional name as string
                        optional data
                    end interface

                    class MyKlass
                        name as float
                    end class
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('MyKlass', 'MyIFace', {
                        fieldMismatches: [{ name: 'name', expectedType: StringType.instance, actualType: FloatType.instance }]
                    }).message
                ]);
            });

            it('allows passing classes as args for interfaces with optional properties', () => {
                program.setFile('source/util.bs', `
                    function takesIFace(iface as MyIFace) as string
                        if invalid <> iface.name
                            return iface.name
                        else if invalid <> iface.data
                            return FormatJson(iface.data)
                        end if
                        return "no"
                    end function

                    sub doStuff(iface as MyIFace)
                        k = new MyKlass()
                        k2 = new MyKlass2()
                        print takesIFace(k)
                        print takesIFace(k2)
                    end sub

                    interface MyIFace
                        optional name as string
                        optional data
                    end interface

                    class MyKlass
                        data = {}
                    end class

                    class MyKlass2
                        data = "test"
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        it('recursive types are allowed', () => {
            program.setFile('source/util.bs', `
                interface ChainNode
                    name as string
                    next as ChainNode
                end interface

                function getChain(cNode as ChainNode) as string
                    output = cNode.name
                    if cNode.next <> invalid
                        output += " - " + getChain(cNode.next)
                    end if
                    return output
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('recursive types are allowed as array members', () => {
            program.setFile('source/util.bs', `
                interface ChainNode
                    name as string
                    nextItems as ChainNode[]
                end interface

                function getChain(cNode as ChainNode) as string
                    output = cNode.name
                    for each item in cNode.nextItems
                        output += " - " + getChain(item)
                    end for
                    return output
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('deeply recursive types are allowed', () => {
            program.setFile('source/util.bs', `
                interface ChainNode
                    name as string
                    nextItem as ChainNodeWrapper
                end interface

                interface ChainNodeWrapper
                    node as ChainNode
                end interface

                function getChain(cNode as ChainNode) as string
                    output = cNode.name
                    if cNode.nextItem <> invalid
                        output += " - " + getChain(cNode.nextItem.node)
                    end if
                    return output
                end function

                sub useChain()
                    chain3 = {name: "C", nextItem: invalid}
                    wrapper3 = {node: chain3}
                    chain2 = {name: "B", nextItem: wrapper3}
                    wrapper2 = {node: chain2}
                    chain1 = {name: "A", nextItem: wrapper2}

                    print getChain(chain1)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('allowed arg type conversions', () => {
            it('allows numbers passed to a function that accepts booleans', () => {
                program.setFile('source/util.bs', `
                    sub takesBool(input as boolean)
                    end sub

                    sub tryNums()
                        pi = 3.14
                        takesBool(1)
                        takesBool(-1)
                        takesBool(123.456)
                        takesBool(23!)
                        takesBool(&hABCD)
                        takesBool(1.22#)
                        takesBool(pi)
                        takesBool(0)
                        takesBool(true)
                        takesBool(false)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

        it('allows boxed types', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function takesBoxedLongInt(x as roLongInteger)
                    return 123456& + x
                end function

                function takesLongInt(x as longInteger)
                    return 123456& + x
                end function

                sub test()
                    long = 123456&
                    boxedLong = createObject("roLongInteger")
                    print takesBoxedLongInt(long)
                    print takesBoxedLongInt(boxedLong)
                    print takesLongInt(long)
                    print takesLongInt(boxedLong)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('AA args with string literal keys', () => {
            it('finds keys with string literal names', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    interface Data
                        id
                    end interface

                    sub takesData(datum as Data)
                    end sub

                    sub usesData()
                    takesData({"id": 1234})
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates keys with string literal names, but type is incorrect', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    interface Data
                        id as string
                    end interface

                    sub takesData(datum as Data)
                    end sub

                    sub usesData()
                    takesData({"id": 1234})
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'Data', {
                        fieldMismatches: [{ name: 'id', expectedType: StringType.instance, actualType: IntegerType.instance }]
                    }).message
                ]);
            });
        });

        describe('inline interfaces', () => {
            it('allows function param with compatible interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    sub takesInline(datum as {name as string})
                    end sub

                    sub callsTakesInline()
                        takesInline({age: 123, name: "test"})
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates function param with incompatible interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    sub takesInline(datum as {name as string})
                    end sub

                    sub callsTakesInline()
                        takesInline({name: 123})
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', '{name as string}', {
                        fieldMismatches: [{ name: 'name', expectedType: StringType.instance, actualType: IntegerType.instance }]
                    }).message
                ]);
            });
        });

        describe('type statement types', () => {
            it('allows compatible type statement types to be passed to functions expecting normal types', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    type number = integer or float

                    sub takesNumber(x as number)
                        takesInteger(x)
                    end sub

                    sub takesInteger(x as integer)
                        print x
                      end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('disallows incompatible type statement types to be passed to functions expecting normal types', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    type whatever = float or string

                    sub takesNumber(x as whatever)
                        takesInteger(x)
                    end sub

                    sub takesInteger(x as integer)
                        print x
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('whatever', 'integer').message
                ]);
            });
        });

        it('allows using invalid as argument for typed array params', () => {
            program.setFile<BrsFile>('source/main.bs', `
                sub takesIntArray(arr as integer[])
                end sub

                sub takesStrArray(arr as string[])
                end sub

                sub test()
                    takesIntArray(invalid)
                    takesStrArray(invalid)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('intersection types', () => {

            it('validates against functions defined in intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    sub main(thing as IFirst and ISecond)
                        thing.doThing2(thing.num, false) ' b should be a string
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('boolean', 'string').message
                ]);
            });

            it('allows passing AAs that satisfy intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    sub main()
                        thing = {
                            num: 123,
                            doThing2: function(a as integer, b as string) as void
                                print a
                                print b
                            end function
                        }
                        usesThing(thing)
                    end sub

                    sub usesThing(thing as IFirst and ISecond)
                        thing.doThing2(thing.num, "hello")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates passing AAs that do not satisfy intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    sub main()
                        thing = {
                            num: false,
                            doThing2: function(a as integer, b as boolean) as void
                                print a
                                print b
                            end function
                        }
                        usesThing(thing)
                    end sub

                    sub usesThing(thing as IFirst and ISecond)
                    end sub
                `);
                program.validate();
                const expectedDoThing2 = new TypedFunctionType(VoidType.instance);
                expectedDoThing2.name = 'doThing2';
                expectedDoThing2.addParameter('a', IntegerType.instance, false);
                expectedDoThing2.addParameter('b', StringType.instance, false);

                const actualDoThing2 = new TypedFunctionType(VoidType.instance);
                actualDoThing2.addParameter('a', IntegerType.instance, false);
                actualDoThing2.addParameter('b', BooleanType.instance, false);
                expectDiagnostics(program,
                    [
                        DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'IFirst and ISecond', {
                            fieldMismatches: [
                                { name: 'num', expectedType: IntegerType.instance, actualType: BooleanType.instance },
                                { name: 'doThing2', expectedType: expectedDoThing2, actualType: actualDoThing2 }
                            ]
                        }).message
                    ]);
            });

            it('accepts a valid intersection when parameter is a union with an intersection', () => {
                program.setFile('source/main.bs', `
                    sub fooA(x as {a as integer} and {b as string} or {c as float})
                        ' noop
                    end sub


                    sub fooB(y as object)
                        fooA({a: 32, b: y})
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates an incomplete intersection when parameter is a union with an intersection', () => {
                program.setFile('source/main.bs', `
                    sub fooA(x as {a as integer} and {b as string} or {c as float})
                        ' noop
                    end sub


                    sub fooB(y as object)
                        fooA({a: 32})
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', '({a as integer} and {b as string}) or {c as float}', {
                        missingFields: [
                            { name: 'b', expectedType: StringType.instance },
                            { name: 'c', expectedType: FloatType.instance }
                        ]
                    }).message
                ]);
            });

            it('accepts a valid intersection when parameter is an intersection with a union', () => {
                program.setFile('source/main.bs', `
                    sub fooA(x as {a as integer} and ({b as string} or {c as float}))
                        ' noop
                    end sub


                    sub fooB(y as dynamic)
                        fooA({a: 32, b: y}) ' meets first half of union
                        fooA({a: 32, c: y}) ' meets second half of union
                        fooA({a: 32, b: "hello", c: 2.178}) ' meets both halves of union
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates an incomplete intersection when parameter is an intersection with a union', () => {
                program.setFile('source/main.bs', `
                    sub fooA(x as {a as integer} and ({b as string} or {c as float}))
                        ' noop
                    end sub


                    sub fooB(y as object)
                        fooA({a: 32})
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', '{a as integer} and ({b as string} or {c as float})', {
                        missingFields: [
                            { name: 'b', expectedType: StringType.instance },
                            { name: 'c', expectedType: FloatType.instance }
                        ]
                    }).message
                ]);
            });
        });

        describe('for loops', () => {
            it('allows using the loop variable inside the loop', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        for each item in [1, 2, 3]
                            x as integer = item + 2
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates the loop variable usage', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        for each item in ["test"]
                            x as integer = item
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates assignment of for loop variable to non-number', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        for i = "test" to 8 ' can't set loop var to string
                            print i
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates for loop step of non-number', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        for i = 1 to 8 step "two"' can't set step to string
                            print i
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates for loop final value of non-number', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        for i = 1 to "eight" step 2 ' can't set final value to string
                            print i
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates for loop with types from different places', () => {
                program.setFile('source/main.bs', `

                    function getInt() as integer
                        return 2
                    end function

                    namespace TestNamespace
                        const ONE = 1
                    end namespace

                    sub main(data as string[])
                        for i = TestNamespace.ONE to data.count() step getInt()
                            print i
                        end for
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });


            it('validates assignment of for each loop variable for array literal', () => {
                program.setFile('source/main.bs', `
                    sub main()
                        for each item as integer in ["test"] 'can't set loop var to integer, if given string
                            print item
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates assignment of for each loop variable for typed array', () => {
                program.setFile('source/main.bs', `
                    sub main(data as string[])
                        for each item as integer in data 'can't set loop var to integer, if given string
                            print item
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates assignment of for each loop variable for roByteArray', () => {
                program.setFile('source/main.bs', `
                    sub main(data as roByteArray)
                        for each item as string in data 'can't set loop var to string, byte arrays are integers
                            print item
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
                ]);
            });

            it('validates assignment of for each loop variable for AAs', () => {
                program.setFile('source/main.bs', `
                    sub main(data as roAssociativeArray)
                        for each item as integer in data 'can't set loop var to integer, associative arrays give keys
                            print item
                        end for
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
                ]);
            });
        });

        describe('typed function type expressions', () => {
            it('allows using typed function type expressions correctly', () => {
                program.setFile('source/main.bs', `
                    sub main(myFunc as function(num as integer) as string)
                        print myFunc(123)
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates using typed function type expressions incorrectly', () => {
                program.setFile('source/main.bs', `
                    sub main(myFunc as function(num as integer) as string)
                        print myFunc("123")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates using typed function type expressions from type statements', () => {
                program.setFile('source/main.bs', `
                    type MyFuncType = function(num as integer) as string

                    sub main(myFunc as MyFuncType)
                        print myFunc("123")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates using typed function type expressions from type statements', () => {
                program.setFile('source/main.bs', `
                    type MyFuncType = function(num as integer) as string

                    sub main(myFunc as MyFuncType)
                        print myFunc("123")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates using typed function type expressions returned from other functions', () => {
                program.setFile('source/main.bs', `
                    function getFunc() as function(num as integer) as string
                        return function(x as integer) as string
                            return "hello " + x.toStr()
                        end function
                    end function

                    sub main()
                        myFunc = getFunc()
                        print myFunc("123")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
                ]);
            });

            it('validates using typed function type expressions with complex arguments', () => {
                program.setFile('source/main.bs', `
                    type MyFuncType = function(arg1 as {id as integer}, arg2 as IFace) as string

                    interface IFace
                        name as string
                        data as float[]
                    end interface

                    sub main(myFunc as MyFuncType)
                        print myFunc({id: "123"}, {name: false})
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', '{id as integer}', {
                        fieldMismatches: [
                            { name: 'id', expectedType: IntegerType.instance, actualType: StringType.instance }
                        ]
                    }).message,
                    DiagnosticMessages.argumentTypeMismatch('roAssociativeArray', 'IFace', {
                        fieldMismatches: [
                            { name: 'name', expectedType: StringType.instance, actualType: BooleanType.instance }
                        ],
                        missingFields: [
                            { name: 'data', expectedType: new ArrayType(FloatType.instance) }
                        ]
                    }).message
                ]);
            });

            it('validates passing an incompatible typed function type expression as an argument', () => {
                program.setFile('source/main.bs', `
                    sub useFunc(myFunc as function(num as integer) as string)
                        print myFunc(123)
                    end sub

                    sub otherFunc()
                        useFunc(function(a, b) as void
                                print a
                                print b
                            end function)
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.argumentTypeMismatch('function (a as dynamic, b as dynamic) as void', 'function (num as integer) as string', {
                        expectedParamCount: 1,
                        actualParamCount: 2
                    }).message
                ]);
            });

            it('allows passing a function with additional optional parameters', () => {
                program.setFile('source/main.bs', `
                    type MyFuncType1 = function(num as integer) as string
                    sub useFunc(myFunc as MyFuncType1)
                        print myFunc(123)
                    end sub
                    sub otherFunc()
                        useFunc(function(a as integer,  b = "" as string) as string
                                print a
                                print b
                                return "hello"
                            end function)
                    end sub
               `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });
    });

    describe('cannotFindName', () => {

        it('finds variables from assignments from member functions of primitive types', () => {
            program.setFile('source/util.brs', `
                function lcaseTrim(str)
                    trimmedLowerStr = lcase(str).trim()
                    print trimmedLowerStr
                end function
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('validates when lhs of compound assignment does not exist', () => {
            program.setFile('source/util.brs', `
                sub main()
                    expected += chr(10) + " version=""2.0"""
                end sub
            `);
            program.validate();
            //should have error - cannot find "expected"
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('expected').message
            ]);
        });

        it('does not have a diagnostic for using a variable the result of an assignment with unresolved value', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    myValue = UndeclaredValue
                    if myValue > 0
                        print "hello"
                    end if
                end sub
            `);
            program.validate();
            //should have only 1 error - cannot find "UndeclaredValue"
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('UndeclaredValue').message
            ]);
        });

        it('detects assigning to an unknown field in a class', () => {
            program.setFile('source/main.bs', `
                class Klass
                    sub new()
                        m.unknown = "hello"
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('unknown', 'Klass.unknown', 'Klass')
            ]);
        });

        it('detects assigning to an unknown field in a primitive', () => {
            program.setFile('source/main.bs', `
                sub main()
                    myStr = "hello"
                    myStr.length = 2
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('length', 'string.length', 'string')
            ]);
        });

        it('allows assigning to an unknown field in an AA', () => {
            program.setFile('source/main.bs', `
                sub main()
                    myAA = {}
                    myAA.unknown = 4
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows setting a member of an overriden member of an aa', () => {
            program.setFile('source/main.bs', `
                sub makeAA()
                    myAA = {}
                    addItemsToAA(myAA)
                    myAA.items.value = "other string"
                end sub

                sub addItemsToAA(someAA)
                    someAA.items = {value: "some string"}
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows accessing a member of an overriden member of an aa', () => {
            program.setFile('source/main.bs', `
                sub makeAA()
                    myAA = {}
                    addItemsToAA(myAA)
                    print myAA.items.value.len()
                end sub

                sub addItemsToAA(someAA)
                    someAA.items = {value: "some string"}
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows using a member of an overriden member of an aa in a different way', () => {
            program.setFile('source/main.bs', `
                sub makeAA()
                    myAA = {}
                    addItemsToAA(myAA)
                    for each item in myAA.items 'bs:disable-line not-iterable
                        print item
                    end for
                end sub

                sub addItemsToAA(someAA)
                    someAA.items = [0, 1, 2, 3]
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not show a diagnostic when using a function param with unknown type', () => {
            program.setFile('source/main.bs', `
                function test(item as Whatever)
                    return {data: item}
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Whatever')
            ]);
        });

        it('does not show a diagnostic when using a variable declared with unknown type cast', () => {
            program.setFile('source/main.bs', `
                function test()
                    item = {} as Whatever
                    return {data: item}
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Whatever')
            ]);
        });

        it('does not show a diagnostic when using a variable declared with unknown type', () => {
            program.setFile('source/main.bs', `
                function test()
                    item as Whatever = {}
                    return {data: item}
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Whatever')
            ]);
        });

        it('allows function default params to reference earlier params', () => {
            program.setFile('source/main.bs', `
                function test(param1 as integer, param2 = param1 + 2)
                    print param1; param2
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has diagnostic when function default params reference unknown', () => {
            program.setFile('source/main.bs', `
                function test(param1 as integer, param2 = paramX + 2)
                    print param1; param2
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('paramX').message
            ]);
        });

        it('has diagnostic when function default params reference variable from inside function', () => {
            program.setFile('source/main.bs', `
                function test(param1 as integer, param2 = paramX + 2)
                    paramX = 3
                    print param1; param2
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('paramX').message
            ]);
        });

        it('has diagnostic when trying to use a method on an union that does not exist in one type', () => {
            program.setFile('source/main.bs', `
                function typeHoverTest(x as string or integer)
                    value = x.len()
                    return value
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindFunction('len', null, '(string or integer)').message
            ]);
        });

        it('does not have diagnostic when accessing unknown member of union in Brightscript mode, when variable is a param', () => {
            program.setFile('source/main.brs', `
                function typeHoverTest(x as string)
                    x = x.len()
                    return x
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not have diagnostic when accessing unknown member of union in Brightscript mode, when variable is defined in block', () => {
            program.setFile('source/main.brs', `
                function typeHoverTest()
                    x = "hello"
                    x = x.len()
                    return x
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not have diagnostic when accessing unknown member of node in Brightscript mode', () => {
            program.setFile('source/main.brs', `
                ' @param {roSGNode} node
                function testNodeMember(node)
                    x = node.whatever
                    return x
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not have diagnostic when accessing unknown member of contentnode in Brightscript mode', () => {
            program.setFile('source/main.brs', `
                ' @param {roSgNodeCOntentNode} node
                function testNodeMember(node)
                    x = node.whatever
                    return x
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not have diagnostic when accessing unknown member of created node  in Brightscript mode', () => {
            program.setFile('source/main.brs', `
                ' @param {string} nodeSubtype
                function testNodeMember(nodeSubtype)
                    x = createObject("roSgNode",nodeSubtype)
                    x.whatever = true
                    return x
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows anything on m in an anonymous function', () => {
            program.setFile('source/main.bs', `
                function test()
                    stub = function()
                        m.something = true
                    end function
                    return stub
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows anything on m in an anonymous function in a class method', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    function test()
                        stub = function()
                            m.something = true
                        end function
                        return stub
                    end function
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has error when referencing something in outer namespace directly', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub foo()
                    end sub

                    namespace beta
                        sub bar()
                            foo()
                        end sub
                    end namespace
                end namespace
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindFunction('foo').message
            ]);
        });

        it('allows referencing something in outer namespace with namespace in front', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub foo()
                    end sub

                    namespace beta
                        sub bar()
                            alpha.foo()
                        end sub
                    end namespace
                end namespace
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows referencing scope-defined func in inner namespace, when outer namespace has same named func', () => {
            program.setFile('source/main.bs', `
                namespace alpha
                    sub foo()
                    end sub

                    namespace beta
                        sub bar()
                            foo(1)
                        end sub
                    end namespace
                end namespace

                function foo(x as integer) as integer
                    return x
                end function
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has an diagnostic when using a variable defined in parent function', () => {
            program.setFile('source/main.bs', `
                function parentFunction()
                    parentVar = "test"

                    innerFunction = sub()
                        ' Attempting to use parentVar from the parent function scope
                        print parentVar ' This should trigger a diagnostic
                        otherFunc() ' this is fine
                    end sub

                    innerFunction()
                end function

                sub otherFunc()
                    print "hello"
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('parentVar')
            ]);
        });

        it('has an diagnostic when using a param from  parent function', () => {
            program.setFile('source/main.bs', `
                function parentFunction(outerVal)
                    parentVar = "test"

                    innerFunction = sub(inner)
                        print inner + outer
                    end sub

                    innerFunction(2)
                end function
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('outer')
            ]);
        });

        it('allows method call on hex literal', () => {
            program.setFile('source/main.bs', `
                function test()
                    x = &HFF.toStr()
                    return x
                end function
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });


        it('allows method call on hex literal', () => {
            program.setFile('source/main.bs', `
                function test()
                    x = &HFF.toStr()
                    return x
                end function
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has no validation errors with print statement with hex followed by dot <number>', () => {
            program.setFile('source/main.bs', `
                sub test()
                    print &hFF.123.456.5678
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows access of properties of union with invalid', () => {
            program.setFile<BrsFile>('source/main.bs', `
                sub test()
                    channel = invalid
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);

        });

        it('sets default arg of invalid as dynamic', () => {
            program.setFile<BrsFile>('source/main.bs', `
                sub test(channel = invalid)
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);

        });

        it('sets assignment of function returning invalid as dynamic', () => {
            program.setFile<BrsFile>('source/main.bs', `
                sub test()
                    channel = noReturn()
                    if true
                        channel = {
                            height: 123
                        }
                    end if

                    height = 0
                    if channel <> invalid then
                        height += channel.height
                    end if
                end sub

                sub noReturn()
                    print "hello"
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates accessing a bad member on a type statement type', () => {
            program.setFile<BrsFile>('source/main.bs', `
                type numberOrString = integer or string

                function test(x as numberOrString)
                    print x.nonExistentMember
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('nonExistentMember', 'numberOrString.nonExistentMember', 'numberOrString')
            ]);
        });

        describe('inline interfaces', () => {
            it('finds members of inline interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    sub takesInline(datum as {name as string})
                        print datum.name.split(",")
                    end sub

                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates using invalid member name', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    sub takesInline(datum as {name as string})
                        print datum.notThere.split(",")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('notThere', '{name as string}.notThere', '{name as string}')
                ]);
            });
        });

        describe('intersection types', () => {
            it('finds members from intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    sub main(thing as IFirst and ISecond)
                        print thing.num
                        thing.doThing2(thing.num, "hello")
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('finds random members of intersections with AA types', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    sub printData(data as {customData as string} and roAssociativeArray)
                        x = data.someDynamicKey
                        y = data.customData
                        print x
                        print y
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });


            it('handles type statements that are intersections of classes and AA', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    sub printData(data as MyKlassAA)
                        x = data.customData
                        data.append({
                            newKey: "newValue"
                        })
                        print x
                        y = data.newKey
                        print y
                    end sub


                    type MyKlassAA = MyKlass and roAssociativeArray

                    class MyKlass
                        customData as string
                    end class
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates missing members from intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    sub main(thing as IFirst and ISecond)
                        print thing.nonExistentMember
                        thing.doThing2(thing.num, "hello")
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.cannotFindName('nonExistentMember', '(IFirst and ISecond).nonExistentMember', '(IFirst and ISecond)')
                ]);
            });
        });
    });

    describe('itemCannotBeUsedAsVariable', () => {
        it('detects assigning to a member of a namespace outside the namespace', () => {
            program.setFile('source/main.bs', `
                namespace Alpha
                    const Name = "Alpha"
                end namespace

                sub main()
                    Alpha.name = "Beta"
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.itemCannotBeUsedAsVariable('namespace')
            ]);
        });

        it('validates when trying to print a namespace', () => {
            program.setFile('source/main.bs', `
                namespace Alpha
                    const Name = "Alpha"
                end namespace

                sub main()
                    print alpha
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.itemCannotBeUsedAsVariable('namespace')
            ]);
        });

        it('validates when trying to pass a namespace as an arg', () => {
            program.setFile('source/main.bs', `
                namespace Alpha
                    const Name = "Alpha"
                end namespace

                sub main()
                    someFunc(alpha)
                end sub

                sub someFunc(arg)
                    print sub
                end sub
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.itemCannotBeUsedAsVariable('namespace')
            ]);
        });

        it('detects assigning to a member of a namespace inside the namespace', () => {
            program.setFile('source/main.bs', `
                namespace Alpha
                    const Name = "Alpha"

                    sub inAlpha()
                        alpha.name = "Beta"
                    end sub
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.itemCannotBeUsedAsVariable('namespace')
            ]);
        });


        it('detects assigning to a member of a namespace outside the namespace', () => {
            program.setFile('source/main.bs', `
                namespace Alpha
                    class Klass
                    end class
                end namespace

                sub main()
                    myKlass = new Alpha.Klass()
                    Alpha.klass = myKlass
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.itemCannotBeUsedAsVariable('namespace')
            ]);
        });

        it('detects assigning to a member of a namespace outside the namespace', () => {
            program.setFile('source/main.bs', `
                namespace Alpha
                    class Klass
                        function new()
                        end function

                        function init()
                            Alpha.innerFunc = someFunc
                        end function
                    end class

                    sub innerFunc()
                    end sub
                end namespace

                sub someFunc()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.itemCannotBeUsedAsVariable('namespace')
            ]);
        });

        it('validates when a class member is accessed from a class directly', () => {
            program.setFile('source/util.bs', `
                class Klass
                    name as string
                end class

                sub doStuff()
                    print klass.name ' only valid use of "Klass" is as a constructor: "new Klass()", or as a function
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('name', 'function.name', 'function')
            ]);
        });

        it('validates when a class member is accessed from a class directly when class has a namespace', () => {
            program.setFile('source/util.bs', `
                namespace Alpha
                    class Klass
                        name as string
                    end class
                end namespace

                sub doStuff()
                    print alpha.klass.name ' only valid use of "Klass" is as a constructor: "new Klass()"
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('name', 'function.name', 'function')
            ]);
        });

        it('validates when new is is used on a class instance', () => {
            program.setFile('source/util.bs', `
                class Klass
                    name as string
                end class

                sub doStuff(someKlass as Klass)
                    print new someKlass()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.expressionIsNotConstructable('someKlass')
            ]);
        });

        it('allows when a class name is used as field name', () => {
            program.setFile('source/util.bs', `
                class Klass
                    name as string
                end class

                class OtherKlass
                    klass as Klass

                    sub foo()
                        print m.klass.name
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows when a class name from a namespace is used as field name', () => {
            program.setFile('source/util.bs', `
                namespace Alpha
                    class Klass
                        name as string
                    end class
                end namespace

                class OtherKlass
                    klass as Alpha.Klass

                    sub foo()
                        m.klass = new Alpha.Klass()
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('returnTypeMismatch', () => {
        it('finds when a function returns a type that is not what was declared', () => {
            program.setFile('source/util.bs', `
                function getPi() as float
                    return "apple" ' get it?
                end function
            `);
            program.validate();
            //should have error - return value should be a float, not a string
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('string', 'float').message
            ]);
        });

        it('finds all return statements that do not match', () => {
            program.setFile('source/util.bs', `
                function getPi(kind as integer) as float
                    if kind = 1
                        return "apple"
                    else if kind = 2
                        return false
                    else if kind = 3
                        return new Pie("lemon")
                    end if
                    return 3.14
                end function

                class Pie
                   kind as string
                   sub new(kind as string)
                       m.kind = kind
                   end sub
                end class
            `);
            program.validate();
            //should have error - return value should be a float, not whatever else
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('string', 'float').message,
                DiagnosticMessages.returnTypeMismatch('boolean', 'float').message,
                DiagnosticMessages.returnTypeMismatch('Pie', 'float').message
            ]);
        });


        it('allows returning compatible types', () => {
            program.setFile('source/util.bs', `
                function getPi() as float
                    return 3 ' integers are compatible with floats
                end function

                function getPie() as Pie
                    return new Tart("lemon") ' Tart extends Pie
                end function

                class Pie
                    kind as string
                    sub new(kind as string)
                        m.kind = kind
                    end sub
                end class

                class Tart extends Pie
                    size = "small"
                end class
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('detects return types on void functions (subs)', () => {
            program.setFile('source/util.bs', `
                sub sayHello(name as string)
                    return "hello " + name ' return should be void in subs
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.voidFunctionMayNotReturnValue('sub').message,
                DiagnosticMessages.returnTypeMismatch('string', 'void').message
            ]);
        });

        it('detects return types on void functions', () => {
            program.setFile('source/util.bs', `
                function sayHello(name as string) as void
                    return "hello " + name ' return should be void in subs
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('string', 'void').message,
                DiagnosticMessages.voidFunctionMayNotReturnValue('function').message
            ]);
        });

        it('allows returning enums with the default type that matches the declared return type', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1
                    val2
                end enum

                function getInt() as integer
                    return MyEnum.val1
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows returning enums passed as a param with the default type that matches the declared return type', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1
                    val2
                end enum

                function getInt(enumVal as MyEnum) as integer
                    return enumVal
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows returning enums with the default type that matches the declared return type for string enums', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1 = "hello"
                    val2 = "world"
                end enum

                function getInt() as string
                    return MyEnum.val1
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('flags returning enums with the default type that does not matches the declared return type', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1 = "hello"
                    val2 = "world"
                end enum

                function getInt() as integer
                    return MyEnum.val1
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('MyEnum', 'integer').message
            ]);
        });

        it('flags returning enums passed as params with the default type that does not matches the declared return type', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1 = "hello"
                    val2 = "world"
                end enum

                function getInt(enumVal as MyEnum) as integer
                    return enumVal
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('MyEnum', 'integer').message
            ]);
        });

        it('flags returning enums type', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1 = "hello"
                    val2 = "world"
                end enum


                function getInt() as integer
                    return MyEnum
                end function
            `);
            program.validate();
            expect(program.getDiagnostics().length).to.be.greaterThan(0);
        });

        it('allows returning an Enum', () => {
            program.setFile('source/util.bs', `
                enum MyEnum
                    val1 = "hello"
                    val2 = "world"
                end enum


                function getInt() as MyEnum
                    return MyEnum.val1
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('allows AA with overidden props to meet interface', () => {
            program.setFile('source/code.bs', `
                namespace alpha.beta
                    interface Stream
                        thumbnailTiler as Thumbnail
                    end interface

                    interface Thumbnail
                        count as integer
                    end interface

                    function createStreamObject() as Stream
                        return {
                            thumbnailTiler: {
                                count: 1
                            }
                        }
                    end function
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows AA with inside AA to be validated properly', () => {
            program.setFile('source/code.bs', `
                namespace alpha.beta
                    interface Stream
                        thumbnailTiler as Thumbnail
                    end interface

                    interface Thumbnail
                        count as integer
                    end interface

                    function createStreamObject() as Stream
                        return {
                            thumbnailTiler: {
                                count: "hello"
                            }
                        }
                    end function
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('roAssociativeArray', 'alpha.beta.Stream', {
                    fieldMismatches: [{ name: 'thumbnailTiler', expectedType: new InterfaceType('alpha.beta.Thumbnail'), actualType: new AssociativeArrayType() }]
                }).message
            ]);
        });

        it('allows function with no return types with void return value', () => {
            program.setFile('source/util.bs', `
                function doSomething()
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nonVoidFunctionMustReturnValue('function').message
            ]);
        });

        it('allows function with dynamic return types with void return value ', () => {
            program.setFile('source/util.bs', `
                function doSomething() as dynamic
                    return
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.nonVoidFunctionMustReturnValue('function').message
            ]);
        });


        it('validates for sub with return types with no return value', () => {
            program.setFile('source/util.bs', `
                sub doSomething() as integer
                    return
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('void', 'integer').message,
                DiagnosticMessages.nonVoidFunctionMustReturnValue('sub').message
            ]);
        });

        it('validates for function with void return types with non-void return value', () => {
            program.setFile('source/util.bs', `
                function doSomething() as void
                    return 123
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('integer', 'void').message,
                DiagnosticMessages.voidFunctionMayNotReturnValue('function').message
            ]);
        });

        it('allows empty return when return as void', () => {
            program.setFile('source/util.bs', `
                function doNothing1() as void
                    return
                end function

                sub doNothing2() as void
                    return
                end sub

                sub doNothing3() as void
                end sub

                sub doNothing4()
                    return
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows boxed types', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function getBoxedLongInt() as roLongInteger
                    return 123456&
                end function

                function getLongInt() as longInteger
                    x = createObject("roLongInteger")
                    return x
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows returning a function call', () => {
            const spy = sinon.spy(Logger.prototype, 'error');
            program.setFile<BrsFile>('source/main.bs', `
                function abc(func as function) as dynamic
                    return func()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(
                spy.getCalls().map(x => (x.args?.[0] as string)?.toString()).filter(x => x?.includes('Error when calling plugin'))
            ).to.eql([]);
        });

        it('allows returning a roFunction call', () => {
            const spy = sinon.spy(Logger.prototype, 'error');
            program.setFile<BrsFile>('source/main.bs', `
                function abc(func as roFunction) as dynamic
                    return func()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(
                spy.getCalls().map(x => (x.args?.[0] as string)?.toString()).filter(x => x?.includes('Error when calling plugin'))
            ).to.eql([]);
        });

        it('allows returning a call on an object type', () => {
            const spy = sinon.spy(Logger.prototype, 'error');
            program.setFile<BrsFile>('source/main.bs', `
                function abc(func as object) as dynamic
                    return func()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(
                spy.getCalls().map(x => (x.args?.[0] as string)?.toString()).filter(x => x?.includes('Error when calling plugin'))
            ).to.eql([]);
        });

        it('allows calling func returned from other func', () => {
            const spy = sinon.spy(Logger.prototype, 'error');
            program.setFile<BrsFile>('source/calc.bs', `
                sub otherFuncFirst()
                  ' forces getOperation to be referenceType called from ReferenceType
                end sub

                function calc(a as dynamic, b as dynamic, op as string) as dynamic
                    op = getOperation(op)
                    return op(1, 2)
                end function

                function getOperation(name as string) as object
                    return {
                        "sum": function(a as dynamic, b as dynamic) as dynamic
                            return a + b
                        end function
                    }[name]
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(
                spy.getCalls().map(x => (x.args?.[0] as string)?.toString()).filter(x => x?.includes('Error when calling plugin'))
            ).to.eql([]);
        });

        it('allows returning something that matches a type statement type', () => {
            program.setFile('source/util.bs', `
                interface Person
                    name as string
                    age as integer
                end interface

                type Wrapped = Person

                function getWrapped() as Wrapped
                    return {
                        name: "Alice",
                        age: 30
                    }
                 end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('inline interfaces', () => {
            it('allows returning an Associative Array that meets the interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    function takesInline() as  {id as string}
                        return { id: "test" }
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows returning a Node that meets the interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    function takesInline() as  {id as string}
                        return createObject("roSGNode", "Poster")
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates returning an AA that does not meet the interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    function takesInline() as {id as integer}
                        return {id: "hello"}
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.returnTypeMismatch('roAssociativeArray', '{id as integer}', {
                        fieldMismatches: [{ name: 'id', expectedType: IntegerType.instance, actualType: StringType.instance }]
                    }).message
                ]);
            });
        });
        it('allows returning invalid instead of typed array', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function getNumbers() as integer[]
                    return invalid
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        describe('intersection types', () => {

            it('validates when type is intersection of primitive', () => {
                program.setFile('source/main.bs', `
                    function foo() as {id as string} and string
                        return {id: "test"}
                    end function
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.returnTypeMismatch('roAssociativeArray', '{id as string} and string').message
                ]);
            });

            it('allows passing AAs that satisfy intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    function getThing() as IFirst and ISecond
                        thing = {
                            num: 123,
                            doThing2: function(a as integer, b as string) as void
                                print a
                                print b
                            end function
                        }
                        return thing
                    end function
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates passing AAs that do not satisfy intersection types', () => {
                program.setFile('source/main.bs', `
                    interface IFirst
                        num as integer
                    end interface
                    interface ISecond
                        function doThing2(a as integer, b as string) as void
                    end interface

                    function getThing() as IFirst and ISecond
                        thing = {
                            num: false,
                            doThing2: function(a as integer, b as boolean) as void
                                print a
                                print b
                            end function
                        }
                        return thing
                    end function
                `);
                program.validate();
                const expectedDoThing2 = new TypedFunctionType(VoidType.instance);
                expectedDoThing2.name = 'doThing2';
                expectedDoThing2.addParameter('a', IntegerType.instance, false);
                expectedDoThing2.addParameter('b', StringType.instance, false);

                const actualDoThing2 = new TypedFunctionType(VoidType.instance);
                actualDoThing2.addParameter('a', IntegerType.instance, false);
                actualDoThing2.addParameter('b', BooleanType.instance, false);
                expectDiagnostics(program,
                    [
                        DiagnosticMessages.returnTypeMismatch('roAssociativeArray', 'IFirst and ISecond', {
                            fieldMismatches: [
                                { name: 'num', expectedType: IntegerType.instance, actualType: BooleanType.instance },
                                { name: 'doThing2', expectedType: expectedDoThing2, actualType: actualDoThing2 }
                            ]
                        }).message
                    ]);
            });
        });
    });

    describe('returnTypeCoercionMismatch', () => {
        it('allows functions, subs, and "function as void/dynamic" to not have return statements', () => {
            program.setFile('source/util.bs', `
                function noTypeSpecified()
                end function

                function voidTypeSpecified() as void
                end function

                sub subVoidTypeSpecified()
                end sub

                function dynamicTypeSpecified() as dynamic
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('detects when a function does not have a return statement', () => {
            program.setFile('source/util.bs', `
                function doSomething() as string
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeCoercionMismatch().message
            ]);
        });

        it('allows when a function does not have a return statement, but type coercsion is okay', () => {
            program.setFile('source/util.bs', `
                interface Whatever
                    name as string
                end interface

                function doSomething() as Whatever
                end function

                function doSomething2() as object
                end function

                function doSomething3() as integer
                end function

                function doSomething4() as float
                end function

                function doSomething5() as boolean
                end function

            `);
            program.validate();
            // all these are ok
            expectZeroDiagnostics(program);
        });

        it('detects when a namespaced function does not have a return statement', () => {
            program.setFile('source/util.bs', `
                namespace alpha
                    function doSomething() as string
                    end function
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeCoercionMismatch().message
            ]);
        });

        it('detects when an inline function does not have a return statement', () => {
            program.setFile('source/util.bs', `
                function outer() as string
                    inner = function () as string
                        print "no return!"
                    end function
                    return inner()
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeCoercionMismatch().message
            ]);
        });

        it('detects when an outer function does not have a return statement', () => {
            program.setFile('source/util.bs', `
                function outer() as string
                    inner = function() as string
                        return "abc"
                    end function
                    print inner()
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeCoercionMismatch().message
            ]);
        });

        it('detects when a outer function has a return statement in a branch', () => {
            program.setFile('source/util.bs', `
                function hasBranch(x) as string
                    if x = 1
                        return "1"
                    else
                        return "2"
                    end if
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('works for sub with return types with missing return', () => {
            program.setFile('source/util.bs', `
                sub doSomething() as string
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeCoercionMismatch().message
            ]);
        });


        it('works for sub with return types', () => {
            program.setFile('source/util.bs', `
                sub doSomething() as string
                    return "1"
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('ignores .d.bs files', () => {
            program.setFile('source/util.d.bs', `
                function doSomething() as string
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('assignmentTypeMismatch', () => {
        it('finds when the type of the lhs is not compatible with the expected type', () => {
            program.setFile('source/util.bs', `
                sub doStuff(thing as iThing)
                    thing.name = 123
                end sub

                interface iThing
                    name as string
                end interface
            `);
            program.validate();
            //should have error - assignment value should be a string, not a float
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);
        });


        it('allows setting a member with correct type that is a union type', () => {
            program.setFile('source/util.bs', `
                sub doStuff(thing as iThing)
                    thing.name = 123
                end sub

                interface iThing
                    name as string or integer
                end interface
            `);
            program.validate();
            //should have no error - assignment value should be a string, not a float
            expectZeroDiagnostics(program);
        });

        it('finds when the rhs type is not compatible with the lhs, which is a union type', () => {
            program.setFile('source/util.bs', `
                sub doStuff(thing as iThing)
                    thing.name = false
                end sub

                interface iThing
                    name as string or integer
                end interface
            `);
            program.validate();
            //should have error - assignment value should be a string or integer, not a boolean
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('boolean', 'string or integer').message
            ]);
        });

        it('validates when trying to assign to a class method', () => {
            program.setFile('source/util.bs', `
                sub doStuff(myThing as Thing)
                    myThing.getPi = 3.14
                end sub

                class Thing
                    function getPi() as float
                        return 3.14
                    end function
                end class
            `);
            program.validate();
            //should have error
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('float', 'function getPi() as float').message
            ]);
        });

        it('disallows adding new properties to a class', () => {
            program.setFile('source/util.bs', `
                sub doStuff(myThing as Thing)
                    myThing.getPi = 3.14
                end sub

                class Thing
                end class
            `);
            program.validate();
            expectDiagnostics(program, [DiagnosticMessages.cannotFindName('getPi', 'Thing.getPi', 'Thing')]);
        });

        it('validates class constructors', () => {
            program.setFile('source/util.bs', `
                class Video
                    sub new(url as integer)
                        m.url = url 'this should be a compile error
                    end sub
                    public url as string
                end class
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);
        });

        it('validates when assigning to a sgNode', () => {
            program.setFile('source/util.bs', `
                sub setLabelText(label as roSGNodeLabel)
                    label.text = 1234
                end sub

            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);
        });

        it('allows an assignment to a variable when the declared type does match the rhs type', () => {
            program.setFile('source/util.bs', `
                sub setX(value)
                    x as integer = value ' value is dynamic
                end sub

                sub setY()
                    y as integer = len("hello") ' len returns an integer
                end sub
            `);
            program.validate();
            //should have errors
            expectZeroDiagnostics(program);
        });

        it('validates an assignment to a variable when the declared type does not match the rhs type', () => {
            program.setFile('source/util.bs', `
                sub setLabelText(label as roSGNodeLabel)
                    x as integer = label.text
                end sub
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('string', 'integer').message
            ]);
        });


        it('allows an assignment to a class field with enum initial value', () => {
            program.setFile('source/util.bs', `
                sub setDirection(k as Klass, d as Direction)
                    k.dir = Direction.South
                    k.dir = d
                end sub

                class Klass
                    dir = Direction.north
                end class

                enum Direction
                    north
                    south
                end enum
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('validates an assignment to a class field with enum initial value', () => {
            program.setFile('source/util.bs', `
                sub setDirection(k as Klass)
                    k.dir = "NOT a direction"
                end sub

                class Klass
                    dir = Direction.north
                end class

                enum Direction
                    north
                    south
                end enum
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('string', 'Direction').message
            ]);
        });

        describe('Component fields', () => {
            it('allows assigning string to font fields', () => {
                program.setFile('source/util.bs', `
                    sub setLabelFont(label as roSGNodeLabel)
                        label.font = "font:LargeSystemFont"
                        label.font.size = 50
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('allows assigning strings to node fields', () => {
                program.setFile('source/util.bs', `
                    sub setPosterPosition(node as roSGNodePoster)
                        node.translation = "[100, 200]"
                        node.bitmapMargins = "this is not an aa" ' TODO: this *should* be a diagnostic
                    end sub
                `);
                program.validate();
                //should have no errors
                expectZeroDiagnostics(program);
            });

            it('disallows assigning non-correct type to node fields', () => {
                program.setFile('source/util.bs', `
                    sub setId(node as roSgNode)
                        node.id = 123
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
                ]);
            });

            it('allows assigning arrays to appropriate node fields', () => {
                program.setFile('source/util.bs', `
                    sub setPosition(node as roSGNodePoster)
                        node.translation = [100, 200]
                        node.bitmapMargins = {left: 0, right: 100, top: 0, bottom: 200}
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });


            it('allows assigning to rect2d fields', () => {
                program.setFile('components/widget.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget" extends="Group">
                        <interface>
                            <field id="rectangle" type="rect2d" />
                        </interface>
                    </component>
                `);

                program.setFile('source/util.bs', `
                    sub test()
                        node = createObject("roSGNode", "Widget")
                        myRectangle =  {x: 0, y: 0, width: 100, height: 100}
                        node.rectangle = myRectangle
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows assigning to rect2dArray fields', () => {
                program.setFile('components/widget.xml', trim`
                    <?xml version="1.0" encoding="utf-8" ?>
                    <component name="Widget" extends="Group">
                        <interface>
                            <field id="rectangles" type="rect2dArray" />
                        </interface>
                    </component>
                `);

                program.setFile('source/util.bs', `
                    sub test()
                        node = createObject("roSGNode", "Widget")
                        myRectangles =  [
                            {x: 0, y: 0, width: 100, height: 100},
                            {x: 100, y: 100, width: 200, height: 200},
                        ]
                        node.rectangles = myRectangles
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('allows assigning to roSGNodeTargetSet.targetRects fields', () => {
                program.setFile('source/util.bs', `
                    sub test()
                        targetSet = createObject("roSGNode", "TargetSet")
                        targets = [
                            {x: 0, y: 0, width: 100, height: 100},
                            {x: 100, y: 100, width: 200, height: 200},
                        ]
                        targetSet.targetRects = targets
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('has diagnostic if invalid data is assigned to roSGNodeTargetSet.targetRects fields', () => {
                program.setFile('source/util.bs', `
                    sub test()
                        targetSet = createObject("roSGNode", "TargetSet")
                        targets = ["hello", "world"]
                        targetSet.targetRects = targets
                    end sub
                `);

                // make up the assignability data for the diagnostic:
                const rectType = new AssociativeArrayType();
                rectType.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
                rectType.addMember('width', null, FloatType.instance, SymbolTypeFlag.runtime);
                rectType.addMember('x', null, FloatType.instance, SymbolTypeFlag.runtime);
                rectType.addMember('y', null, FloatType.instance, SymbolTypeFlag.runtime);
                const typeCompatData = {} as TypeCompatibilityData;
                rectType.isTypeCompatible(StringType.instance, typeCompatData);
                typeCompatData.actualType = StringType.instance;
                typeCompatData.expectedType = rectType;

                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('Array<string>', 'Array<roAssociativeArray>', typeCompatData).message
                ]);
            });
        });

        describe('inline interfaces', () => {
            it('allows assigning an Associative Array that meets the interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    interface Iface
                        inlineMember as {name as string}
                    end interface

                    sub takesInline(someIface as Iface)
                        someIface.inlineMember = {name: "test"}
                    end sub
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });

            it('validates assigning an AA that does not meet the interface', () => {
                program.setFile<BrsFile>('source/main.bs', `
                    interface Iface
                        inlineMember as {name as string}
                    end interface

                    sub takesInline(someIface as Iface)
                        someIface.inlineMember = {name: 123}
                    end sub
                `);
                program.validate();
                expectDiagnostics(program, [
                    DiagnosticMessages.assignmentTypeMismatch('roAssociativeArray', '{name as string}', {
                        fieldMismatches: [{ name: 'name', expectedType: StringType.instance, actualType: IntegerType.instance }]
                    }).message
                ]);
            });
            it('allows assigning invalid to typed arrays', () => {
                program.setFile<BrsFile>('source/main.bs', `
                sub test()
                    intArray as integer[] = invalid
                    strArray as string[] = invalid
                end sub
            `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });
    });

    describe('operatorTypeMismatch', () => {
        it('finds when the type of the lhs is not compatible with the rhs type', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    a = 1 + true
                    b = "hello" * 2
                end sub

            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('+', 'integer', 'boolean').message,
                DiagnosticMessages.operatorTypeMismatch('*', 'string', 'integer').message
            ]);
        });

        it('allows when the type of the lhs is compatible with the rhs type', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    a = 10 << 1
                    b = "hello" + "world"
                    c = 78 / 34
                    d = 100 \\ 5
                    thing = new Klass()
                    e = thing <> invalid
                end sub

                class Klass
                end class
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('allows tests against invalid', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    thing = new Klass()
                    x = thing <> invalid
                end sub

                class Klass
                end class
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('disallows equality tests of classes', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    thing = new Klass()
                    thing2 = new Klass()
                    x = thing = thing2
                end sub

                class Klass
                end class
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('=', 'Klass', 'Klass').message
            ]);
        });

        it('disallows operations between dynamic and custom types', () => {
            program.setFile('source/util.bs', `
                sub doStuff(input)
                    thing = new Klass()
                    x = thing + input
                end sub

                class Klass
                end class
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('+', 'Klass', 'dynamic').message
            ]);
        });

        it('allows valid operations on enum members', () => {
            program.setFile('source/util.bs', `
                sub makeEasterly(d as Direction)
                    print d + "e"
                    print Direction.north + "east"
                end sub

                function getTax(itemAmt as ItemCost) as Float
                    return itemAmt * 1.15
                end function

                enum Direction
                    north = "n"
                    south = "s"
                end enum

                enum ItemCost
                    x = 99.99
                    y = 29.99
                end enum

            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('finds invalid operations on enum members', () => {
            program.setFile('source/util.bs', `
                enum Direction
                    north = "n"
                    south = "s"
                end enum

                sub makeEasterly(d as Direction)
                    print d + 2
                    print 3.14 * Direction.north
                end sub
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('+', 'Direction', 'integer').message,
                DiagnosticMessages.operatorTypeMismatch('*', 'float', 'Direction').message
            ]);
        });

        it('validates unary operators', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    x = - "hello world"
                end sub
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('-', 'string').message
            ]);
        });

        it('allows unary on dynamic and union types', () => {
            program.setFile('source/util.bs', `
                sub doStuff(x)
                    y = -x
                    print y
                end sub

                sub doOtherStuff(x as float or integer)
                    y = -x
                    print y
                end sub

                sub doEventMoreStuff(x as boolean or dynamic)
                    if not x
                        print "ok"
                    end if
                end sub
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
        });

        it('validates augmented assignments', () => {
            program.setFile('source/util.bs', `
                sub doStuff(x as integer)
                    x += "hello"
                    print x
                end sub
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('+=', 'integer', 'string').message
            ]);
        });

        it('validates increment statements', () => {
            program.setFile('source/util.bs', `
                sub doStuff(x as string)
                    x++
                    print x
                end sub
            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('++', 'string').message
            ]);
        });

        it('deals with adding int, bool and invalid', () => {
            program.setFile('source/util.bs', `
                sub doStuff()
                    print 1 + (true + invalid)
                end sub

            `);
            program.validate();
            //should have errors
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('+', 'boolean', 'invalid').message
            ]);
        });

        it('allows using return of a void func as a variable', () => {
            program.setFile<BrsFile>('source/main.brs', `
                sub voidFunc() as void
                end sub

                sub test()
                    x = voidFunc()
                    if x = invalid
                        print "invalid"
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates using return of a built-in void func as a variable', () => {
            program.setFile<BrsFile>('source/main.brs', `
                sub test()
                    arr = [1,2,3]
                    x = arr.push(4)
                    if x = invalid
                        print "invalid"
                    end if
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('=', 'uninitialized', 'invalid').message
            ]);
        });

        it('allows string comparisons with object', () => {
            program.setFile<BrsFile>('source/main.brs', `
                sub test(x as object)
                    if x <> "test"
                        print x
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows boxed types', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function math(a as rolonginteger, b as longinteger)
                    c = a + b
                    c = a - b
                    c = a * b
                    c = a / b
                    c = a \\ b

                    d = a mod b
                    d = a ^ b

                    a++
                    a--
                    a += 1
                    a -= 1
                    a *= 1
                    a /= 1
                    a \= 1
                    a <<= 1
                    a >>= 1

                    ? 1 << (2 as roInt)
                    ? (1 as roInt) << 2
                    ? a and b
                    ? a or b

                    j = a = b
                    j = a <> b
                    j = a < b
                    j = a <= b
                    j = a > b
                    j = a >= b
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows unions of compatible types', () => {
            program.setFile<BrsFile>('source/main.bs', `
                function test(s as string or roString, i as integer or longinteger)
                    s1 = s + "test"
                    s2 = "test" + s

                    i1 = i + 5
                    i2 = 5 + i
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows type statement type of compatible types', () => {
            program.setFile<BrsFile>('source/main.bs', `
                type number = integer or float
                type MyString = string or roString

                function test(s as MyString, i as number)
                    s1 = s + "test"
                    s2 = "test" + s

                    i1 = i + 5
                    i2 = 5 + i
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('memberAccessibilityMismatch', () => {
        it('should flag when accessing a private member', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    private name as string
                end class

                sub foo(x as SomeKlass)
                    print x.name
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('name', SymbolTypeFlag.private, 'SomeKlass')
            ]);
        });


        it('should allow accessing a private member in a class', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    private name as string

                    sub foo(x as SomeKlass)
                        print x.name
                        print m.name
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should flag when calling a private method outside the class', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    private sub sayHello()
                        print "Hello"
                    end sub
                end class

                sub foo(x as SomeKlass)
                    x.sayHello()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('sayHello', SymbolTypeFlag.private, 'SomeKlass')
            ]);
        });

        it('should allow calling a private method in a class', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    private sub sayHello()
                        print "Hello"
                    end sub

                    sub foo(x as SomeKlass)
                        x.sayHello()
                        m.sayHello()
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should not allow accessing a private member in a subclass', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    private name as string
                end class

                class SubKlass extends SomeKlass
                    sub foo()
                        print m.name
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('name', SymbolTypeFlag.private, 'SomeKlass')
            ]);
        });

        it('should flag when setting a value on a private member', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    private name as string
                end class

                sub foo(x as SomeKlass)
                    x.name = "foo"
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('name', SymbolTypeFlag.private, 'SomeKlass')
            ]);
        });

        it('should flag when accessing a protected member', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected name as string
                end class

                sub foo(x as SomeKlass)
                    print x.name
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('name', SymbolTypeFlag.protected, 'SomeKlass')
            ]);
        });

        it('should allow accessing a protected member in a class', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected name as string

                    sub foo(x as SomeKlass)
                        print x.name
                        print m.name
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should flag when calling a protected method outside the class', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected sub sayHello()
                        print "Hello"
                    end sub
                end class

                class SubKlass extends SomeKlass
                end class

                sub foo(x as SomeKlass, y as SubKlass)
                    x.sayHello()
                    y.sayHello()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('sayHello', SymbolTypeFlag.protected, 'SomeKlass'),
                DiagnosticMessages.memberAccessibilityMismatch('sayHello', SymbolTypeFlag.protected, 'SomeKlass')
            ]);
        });

        it('should allow calling a protected method in a class', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected sub sayHello()
                        print "Hello"
                    end sub
                end class

                class SubKlass extends SomeKlass
                    sub foo(x as SomeKlass, y as SubKlass)
                        m.sayHello()
                        x.sayHello()
                        y.sayHello()
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should allow accessing a protected member in a subclass', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected name as string
                end class

                class SubKlass extends SomeKlass
                    sub foo()
                        print m.name
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should flag when setting a value on a protected member', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected name as string
                end class

                class SubKlass extends SomeKlass
                end class

                sub foo(x as SubKlass)
                    x.name = "foo"
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('name', SymbolTypeFlag.protected, 'SomeKlass')
            ]);
        });

        it('should flag when trying to use an inaccessible member in the middle of a chain', () => {
            program.setFile('source/main.bs', `
                class SomeKlass
                    protected name as string
                end class

                sub foo(x as SomeKlass)
                    print x.name.len()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.memberAccessibilityMismatch('name', SymbolTypeFlag.protected, 'SomeKlass')
            ]);
        });

        describe('with namespaces', () => {
            it('protected members are accessible', () => {
                program.setFile('source/main.bs', `
                    namespace AccessibilityTest
                        class MyClass
                            private data as roAssociativeArray = {}
                            sub new()
                                m.data.AddReplace("key", "value")
                            end sub

                            protected sub printData()
                                print m.data
                            end sub
                        end class

                        class SubClass extends MyClass
                            sub foo()
                                m.printData()
                            end sub
                        end class
                    end namespace
                `);
                program.validate();
                expectZeroDiagnostics(program);
            });
        });

    });

    describe('cannotFindTypeInDocComment', () => {
        it('validates types it cannot find in @param', () => {
            program.setFile<BrsFile>('source/main.brs', `
                    ' @param {TypeNotThere} info
                    function sayHello(info)
                        print "Hello " + info.prop
                    end function
                `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('TypeNotThere').message
            ]);
        });

        it('validates types it cannot find in @return', () => {
            program.setFile<BrsFile>('source/main.brs', `
                    ' @return {TypeNotThere} info
                    function sayHello(info)
                        return {data: info.prop}
                    end function
                `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('TypeNotThere').message
            ]);
        });

        it('validates types it cannot find in @type', () => {
            program.setFile<BrsFile>('source/main.brs', `
                    function sayHello(info)
                        ' @type {TypeNotThere}
                        value = info.prop
                    end function
                `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('TypeNotThere').message
            ]);
        });

    });

    describe('circularReferenceDetected', () => {
        it('finds circular references in consts', () => {
            program.setFile<BrsFile>('source/main.bs', `
                const A = B ' this is circular-reference
                const B = C ' this is circular-reference
                const C = A ' this is circular-reference
                sub main()
                    print A ' this is circular-reference
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.circularReferenceDetected(['B', 'C', 'B']).message,
                DiagnosticMessages.circularReferenceDetected(['B', 'C', 'B']).message,
                DiagnosticMessages.circularReferenceDetected(['B', 'C', 'B']).message,
                DiagnosticMessages.circularReferenceDetected(['C', 'B', 'C']).message
            ]);
        });
    });

    describe('revalidation', () => {

        it('revalidates when a enum defined in a different namespace changes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace Alpha
                    function printEnum(enumVal as Alpha.Beta.Charlie.SomeEnum) as string
                        return enumVal.toStr()
                    end function
                end namespace
            `);

            program.setFile<BrsFile>('source/file2.bs', `
                namespace Alpha.Beta.Charlie
                    enum SomeEnum
                        val1 = 1
                        val2 = 2
                    end enum
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            program.setFile<BrsFile>('source/file2.bs', `
                namespace Alpha.Beta.Charlie
                    enum ChangedEnum
                        val1 = 1
                        val2 = 2
                    end enum
                end namespace
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [DiagnosticMessages.cannotFindName('SomeEnum', null, 'Alpha.Beta.Charlie', 'namespace').message]);
        });

        it('revalidates when a class defined in a different namespace changes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                namespace Alpha
                    function printEnum(myKlass as Alpha.Beta.Charlie.SomeClass) as string
                        return myKlass.getValue()
                    end function
                end namespace
            `);

            program.setFile<BrsFile>('source/file2.bs', `
                namespace Alpha.Beta.Charlie
                    class SomeClass
                        private myValue as string
                        function getValue() as string
                            return m.myValue
                        end function
                    end class
                end namespace
            `);
            program.validate();
            expectZeroDiagnostics(program);
            program.setFile<BrsFile>('source/file2.bs', `
                namespace Alpha.Beta.Charlie
                    class SomeClass
                        private myValue as string
                        function getValue(lowerCase as boolean) as string
                            if lowerCase
                                return lcase(m.myValue)
                            end if
                            return m.myValue
                        end function
                    end class
                end namespace
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [DiagnosticMessages.mismatchArgumentCount(1, 0).message]);
        });

        it('validates only parts of files that need revalidation on scope validation', () => {
            function validateFile(file: BrsFile) {
                const validateFileEvent = {
                    program: program,
                    file: file
                };
                //emit an event to allow plugins to contribute to the file validation process
                program.plugins.emit('validateFile', validateFileEvent);
                program.plugins.emit('afterValidateFile', validateFileEvent);
            }

            const commonContents = `
                sub noValidationForEachScope()
                    k = new KlassInSameFile()
                    print k.value
                end sub

                class KlassInSameFile
                    value = 1
                end class
            `;

            let commonBs: BrsFile = program.setFile('source/common.bs', commonContents);
            validateFile(commonBs);
            expect(commonBs.validationSegmenter.segmentsForValidation.length).to.eq(2); // 1 func,  1 classField
            expect(commonBs.validationSegmenter.unresolvedSegmentsSymbols.size).to.eq(0);
            commonBs.validationSegmenter.validatedSegments.forEach(x => expect(x).to.be.false);
            expect(commonBs.validationSegmenter.singleValidationSegments.size).to.eq(2); // no references needed to other files

            let common2Contents = `
                sub doesValidationForEachScope()
                    k = new KlassInDiffFile()
                    print k.value
                end sub

                function alsoNoValidationForEachScope() as integer
                    return 1
                end function
            `;
            let common2Bs: BrsFile = program.setFile('source/common2.bs', common2Contents);
            validateFile(common2Bs);
            expect(common2Bs.validationSegmenter.segmentsForValidation.length).to.eq(2); // 2 func
            expect(common2Bs.validationSegmenter.unresolvedSegmentsSymbols.size).to.eq(1);
            commonBs.validationSegmenter.validatedSegments.forEach(x => expect(x).to.be.false);
            expect(common2Bs.validationSegmenter.singleValidationSegments.size).to.eq(1); // alsoNoValidationForEachScope() does not reference other files

            let klassContents = `
                class KlassInDiffFile
                    value = 2
                end class
            `;

            let klassBs: BrsFile = program.setFile('source/klass.bs', klassContents);
            validateFile(klassBs);
            expect(klassBs.validationSegmenter.segmentsForValidation.length).to.eq(1); //  1 classField
            expect(klassBs.validationSegmenter.unresolvedSegmentsSymbols.size).to.eq(0);
            klassBs.validationSegmenter.validatedSegments.forEach(x => expect(x).to.be.false);
            expect(klassBs.validationSegmenter.singleValidationSegments.size).to.eq(1); // does not reference other files

            const widgetFileContents = `
                sub init()
                    noValidationForEachScope()
                    doesValidationForEachScope()
                end sub

                sub anotherFunction()
                    print "hello"
                end sub
            `;
            let widgetBs: BrsFile = program.setFile('components/Widget.bs', widgetFileContents);

            validateFile(widgetBs);
            expect(widgetBs.validationSegmenter.segmentsForValidation.length).to.eq(2); // 2 funcs
            expect(widgetBs.validationSegmenter.unresolvedSegmentsSymbols.size).to.eq(1); // 1 func (init)
            widgetBs.validationSegmenter.validatedSegments.forEach(x => expect(x).to.be.false);
            expect(widgetBs.validationSegmenter.singleValidationSegments.size).to.eq(1); // 1 func (anotherFunction)

            const diffKlassContent = `
                class KlassInDiffFile
                    value = 3
                end class
            `;
            let diffKlassBs: BrsFile = program.setFile('components/diffKlass.bs', diffKlassContent);
            validateFile(diffKlassBs);
            expect(diffKlassBs.validationSegmenter.segmentsForValidation.length).to.eq(1); //  1 classField
            expect(diffKlassBs.validationSegmenter.unresolvedSegmentsSymbols.size).to.eq(0);
            diffKlassBs.validationSegmenter.validatedSegments.forEach(x => expect(x).to.be.false);
            expect(diffKlassBs.validationSegmenter.singleValidationSegments.size).to.eq(1);


            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <script uri="pkg:/source/common.bs"/>
                    <script uri="pkg:/source/common2.bs"/>
                    <script uri="diffKlass.bs"/>
                </component>
            `);

            //reset files
            commonBs = program.setFile('source/common.bs', commonContents);
            common2Bs = program.setFile('source/common2.bs', common2Contents);
            klassBs = program.setFile('source/klass.bs', klassContents);
            widgetBs = program.setFile('components/Widget.bs', widgetFileContents);
            diffKlassBs = program.setFile('components/diffKlass.bs', diffKlassContent);

            program.validate();
            // all segments should be validated
            [commonBs, common2Bs, klassBs, widgetBs, diffKlassBs].forEach(file => {
                expect(file.validationSegmenter.validatedSegments.size).to.gte(file.validationSegmenter.segmentsForValidation.length);
                file.validationSegmenter.validatedSegments.forEach(x => expect(x).to.be.true);
            });

            expectZeroDiagnostics(program);
            program.setFile('components/Widget.bs', widgetFileContents);
            program.validate();
            // Widget.bs has changed. it needs to totally re-validated
            // and other files in the scope need to revalidate only the unresolved segments - should be source/common2.bs
            // TODO: how to test this?
            program.validate();
            program.setFile('components/diffKlass.bs', diffKlassContent);
            // diffKlass.bs has changed. it needs to totally re-validated
            // no other files in scope reference it .. no other files need revalidation
            // TODO: how to test this?
            program.validate();
            program.setFile('source/common.bs', commonContents);
            // common.bs has changed. it needs to totally re-validated
            // in source scope, common2.bs still has unresolves, it needs revalidation
            // in widget scope, widget.bs references it
            // TODO: how to test this?
            program.validate();
        });

        it('diagnostics stay when file changes', () => {
            program.options.autoImportComponentScript = true;
            program.setFile('components/playerInterfaces.bs', `
                interface MediaObject
                    optional url as string
                end interface
            `);
            program.setFile('components/player.xml', `
                <component name="Player" extends="Group">
                </component>
            `);
            program.setFile('components/player.bs', `
                import "playerInterfaces.bs"
                import "playerUtils.bs"
                sub test()
                    media = {} as MediaObject
                    print media.missingBool1
                end sub
            `);
            const playerUtilsCode = `
                import "playerInterfaces.bs"
                function test1(media as MediaObject) as boolean
                    print media.missingBool2
                    return true
                end function
            `;

            program.setFile('components/playerUtils.bs', playerUtilsCode);
            program.validate();
            //we have both diagnostics
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('missingBool1', undefined, 'MediaObject').message,
                DiagnosticMessages.cannotFindName('missingBool2', undefined, 'MediaObject').message
            ]);

            //add the last file again with no changes thus "opening" it.
            program.setFile('components/playerUtils.bs', playerUtilsCode);
            program.validate();
            //we STILL have both diagnostics
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('missingBool1', undefined, 'MediaObject').message,
                DiagnosticMessages.cannotFindName('missingBool2', undefined, 'MediaObject').message
            ]);
        });

        it('rechecks source when member type of import changes', () => {
            // notice that width is wrongly typed as a boolean
            program.setFile('source/type1.bs', `
                interface SubType
                    value as string
                end interface
            `);

            program.setFile('source/type2.bs', `
                interface ParentType
                    child as Subtype
                end interface
            `);

            program.setFile('source/main.bs', `
                sub foo(input as ParentType)
                    input.child.value = 1
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'string').message
            ]);

            // fix width field type to integer
            program.setFile('source/type1.bs', `
                interface SubType
                    value as integer
                end interface
            `);
            program.validate();

            // there should be no more errors
            expectZeroDiagnostics(program);
        });

        it('rechecks component source when xml changes', () => {
            // notice that width is wrongly typed as a boolean
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <field id="width" type="boolean" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                interface IWidget
                    top as roSGNodeWidget
                    data as roAssociativeArray
                end interface

                sub init()
                    (m as IWidget).top.width =  100
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'boolean').message
            ]);

            // fix width field type to integer
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <field id="width" type="integer" />
                    </interface>
                </component>
            `);
            program.validate();

            // there should be no more errors
            expectZeroDiagnostics(program);
        });

        it('rechecks complete file when type of typecasted m changes indirectly', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <interface>
                        <field id="width" type="boolean" />
                    </interface>
                </component>
            `);


            // notice that width is wrongly typed as a boolean
            program.setFile('components/WidgetContainer.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="WidgetContainer" extends="Group">
                    <script uri="WidgetContainer.bs"/>
                </component>
            `);
            program.setFile('components/WidgetContainerTypes.bs', `
                interface IWidgetContainer
                    top as roSGNodeWidgetContainer
                    widget as roSGNodeWidget
                end interface
            `);

            program.setFile('components/WidgetContainer.bs', `
                import "WidgetContainerTypes.bs"
                typecast m as IWidgetContainer

                sub init()
                    m.widget.width =  100
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'boolean').message
            ]);

            // fix width field type to integer
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <interface>
                        <field id="width" type="integer" />
                    </interface>
                </component>
            `);
            program.validate();

            // there should be no more errors
            expectZeroDiagnostics(program);
        });

        it('rechecks file using callfunc when exported function type of xml changes', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="foo" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                sub foo(input as string)
                    print input
                end sub
            `);


            program.setFile('source/callFoo.bs', `
                sub callFoo(widget as roSGNodeWidget)
                    widget@.foo(123) ' foo expects string
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);

            // fix function
            program.setFile('components/Widget.bs', `
                sub foo(input as integer)
                    print input
                end sub
            `);
            program.validate();

            // there should be no more errors
            expectZeroDiagnostics(program);
        });

        it('rechecks complete file when type of typecasted m  in same file changes indirectly', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <interface>
                        <field id="width" type="boolean" />
                    </interface>
                </component>
            `);


            // notice that width is wrongly typed as a boolean
            program.setFile('components/WidgetContainer.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="WidgetContainer" extends="Group">
                    <script uri="WidgetContainer.bs"/>
                </component>
            `);

            program.setFile('components/WidgetContainer.bs', `
                typecast m as IWidgetContainer

                 interface IWidgetContainer
                    top as roSGNodeWidgetContainer
                    widget as roSGNodeWidget
                end interface

                sub init()
                    m.widget.width =  100
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.assignmentTypeMismatch('integer', 'boolean').message
            ]);

            // fix width field type to integer
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <interface>
                        <field id="width" type="integer" />
                    </interface>
                </component>
            `);
            program.validate();

            // there should be no more errors
            expectZeroDiagnostics(program);
        });

        it('recognizes when the type of a for-each loop variable changes', () => {
            program.setFile<BrsFile>('source/file1.bs', `
                interface FooFace
                    prop as string
                end interface
            `);

            program.setFile<BrsFile>('source/file2.bs', `
                function loopFooFace(input as FooFace[])
                    out = ""
                    for each ff in input
                        out += ff.prop
                    end for
                    return out
                end function
            `);
            program.validate();
            //currently no error
            expectZeroDiagnostics(program);

            // change FooFace.prop to not work in other file
            program.setFile<BrsFile>('source/file1.bs', `
                interface FooFace
                    prop as integer
                end interface
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.operatorTypeMismatch('+=', 'string', 'integer')
            ]);

            // change FooFace.prop to back to working
            program.setFile<BrsFile>('source/file1.bs', `
                interface FooFace
                    prop as string
                end interface
            `);
            program.validate();
            //currently no error
            expectZeroDiagnostics(program);
        });
    });


    describe('preprocessor', () => {
        it('should process class inheritance correctly', () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, undent`
                bs_const=DEBUG=true
            `);
            program.setFile('source/myClass.bs', `
                namespace MyNamespace
                    class MyClass1
                        function new()
                        end function
                    end class
                end namespace
            `);

            program.setFile('source/myClass2.bs', `
                #if DEBUG
                    namespace MyNamespace
                        class MyClass2 extends MyClass1
                            function new()
                                super()
                            end function
                        end class
                    end namespace
                #end if
            `);

            program.setFile('source/main.bs', `
                sub main()
                    #if DEBUG
                        m.test = new MyNamespace.MyClass2()
                    #end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('should find assignments in conditional compile blocks', () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, undent`
                bs_const=DEBUG=true
            `);

            program.setFile('source/main.bs', `
                sub main()
                    dbg = invalid
                    #if DEBUG
                        dbg = "DEBUG"
                    #end if

                    print dbg
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('should find types defined in condition compile blocks', () => {
            fsExtra.outputFileSync(`${rootDir}/manifest`, undent`
                bs_const=DEBUG=true
            `);
            program.setFile('source/debugInterfaces.bs', `
                #if DEBUG
                    interface DebugInfo
                        name as string
                    end interface
                #end if
            `);

            program.setFile('source/main.bs', `
                sub main()
                    #if DEBUG
                        info as DebugInfo = {name: "main.bs"}
                        printDebugInfo(info)
                    #else
                        printDebugInfo(info)
                    #end if
                end sub

                #if DEBUG
                    sub printDebugInfo(info as DebugInfo)
                        print info.name
                    end sub
                #end if
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('notCallable', () => {
        it('finds when trying to call on a non-function', () => {
            program.setFile('source/test.bs', `
                sub someFunc(widget as roSGNodePoster)
                    print widget.width()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.notCallable('widget.width').message
            ]);
        });

        it('allows trying to call a dynamic', () => {
            program.setFile('source/test.bs', `
                sub someFunc(widget)
                    print widget()
                    print widget.whatever()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows trying to call a function param', () => {
            program.setFile('source/test.bs', `
                sub someFunc(widget as function)
                    print widget()
                    print widget().whatever()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('finds other non-callables', () => {
            program.setFile('source/test.bs', `
                sub someFunc(input as float)
                    print input()
                    a = "hello"
                    print a()
                    print 12345()
                    print "string"()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.notCallable('input').message,
                DiagnosticMessages.notCallable('a').message,
                DiagnosticMessages.notCallable('12345').message,
                DiagnosticMessages.notCallable('"string"').message
            ]);
        });

        it('allows calling an object type', () => {
            program.setFile<BrsFile>('source/calc.bs', `
                function someFunc(otherFunc as object) as dynamic
                    return otherFunc()
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });
    });

    describe('callFunc', () => {
        it('allows access to member of return type when return type is custom node', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getOther" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getOther(name as string) as roSgNodeOther
                    other =  createObject("roSgNode", "Other")
                    other.myValue = name
                    return other
                end function
            `);

            program.setFile('components/Other.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Other" extends="Group">
                    <interface>
                        <field id="myValue" type="string" />
                    </interface>
                </component>
            `);


            program.setFile('components/MainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <script uri="MainScene.bs"/>
                </component>
            `);

            program.setFile('components/MainScene.bs', `
                sub someFunc(widget as roSGNodeWidget)
                    otherNode = widget@.getOther("3.14")
                    print otherNode.myValue
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows access to member of return type when return type is custom type', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getOther" />
                    </interface>
                </component>
            `);
            program.setFile('components/types.bs', `
                interface SomeIFace
                   myValue as string
                end interface
            `);

            program.setFile('components/Widget.bs', `
                import "pkg:/components/types.bs"

                function getOther(name as string) as SomeIFace
                    other = {myValue: name} as SomeIface
                    other.myValue = name
                    return other
                end function
            `);

            program.setFile('components/MainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <script uri="MainScene.bs"/>
                </component>
            `);

            program.setFile('components/MainScene.bs', `
                sub someFunc(widget as roSGNodeWidget)
                    otherNode = widget@.getOther("3.14")
                    print otherNode.myValue
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows access to custom type member of return type when return type is custom type', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getOther" />
                    </interface>
                </component>
            `);
            program.setFile('components/types.bs', `
                interface SomeIFace
                   subFace as SubIface
                end interface

                interface SubIface
                    myValue as string
                end interface
            `);

            program.setFile('components/Widget.bs', `
                import "pkg:/components/types.bs"

                function getOther(name as string) as SomeIFace
                    other = {subFace: {myValue: name}} as SomeIface
                    return other
                end function
            `);

            program.setFile('components/MainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <script uri="MainScene.bs"/>
                </component>
            `);

            program.setFile('components/MainScene.bs', `
                sub someFunc(widget as roSGNodeWidget)
                    otherNode = widget@.getOther("3.14")
                    print otherNode.subFace.myValue
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('correctly finds error with using unknown member of callfunc return type when return type is custom type', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getOther" />
                    </interface>
                </component>
            `);
            program.setFile('components/types.bs', `
                interface SomeIFace
                   subFace as SubIface
                end interface

                interface SubIface
                    myValue as string
                end interface
            `);

            program.setFile('components/Widget.bs', `
                import "pkg:/components/types.bs"

                function getOther(name as string) as SomeIFace
                    other = {subFace: {myValue: name}} as SomeIface
                    return other
                end function
            `);

            program.setFile('components/MainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <script uri="MainScene.bs"/>
                </component>
            `);

            program.setFile('components/MainScene.bs', `
                sub someFunc(widget as roSGNodeWidget)
                    otherNode = widget@.getOther("3.14")
                    print otherNode.subFace.notIncluded
                end sub
            `);

            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('notIncluded', 'SubIface.notIncluded', 'SubIface').message
            ]);
        });

        it('catches when a non-component type has callfunc invocation', () => {
            program.setFile('source/test.bs', `
                sub printName(widget as integer)
                    print widget@.toStr()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('toStr', 'integer@.toStr', 'integer').message
            ]);
        });

        it('allows to types that reference themselves', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getList" />
                    </interface>
                </component>
            `);
            program.setFile('components/types.bs', `
                interface LinkedList
                    value as integer
                    optional data as roAssociativeArray
                    optional next as LinkedList
                end interface
            `);

            program.setFile('components/Widget.bs', `
                import "pkg:/components/types.bs"

                function getList() as LinkedList
                    list  = {
                        value: 1,
                        next: {
                            value: 2,
                            next: {
                                value: 3
                            }
                        }
                    } as LinkedList
                    return list
                end function
            `);

            program.setFile('components/MainScene.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="MainScene" extends="Scene">
                    <script uri="MainScene.bs"/>
                </component>
            `);

            program.setFile('components/MainScene.bs', `
                sub someFunc(widget as roSGNodeWidget)
                    list = widget@.getList()
                    print list.next.next.value
                end sub
            `);

            program.validate();
            expectZeroDiagnostics(program);
        });

        it('finds invalid func name of callfunc()', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('source/test.bs', `
                sub printName(widget as roSGNodeWidget)
                    print widget.callFunc("whatever")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('whatever', 'roSGNodeWidget@.whatever', 'roSGNodeWidget').message
            ]);
        });

        it('finds invalid func name of @ callfunc invocation', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('source/test.bs', `
                sub printName(widget as roSGNodeWidget)
                    print widget@.whatever()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('whatever', 'roSGNodeWidget@.whatever', 'roSGNodeWidget').message
            ]);
        });

        it('catches func name of callfunc() with spaces', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('source/test.bs', `
                sub printName(widget as roSGNodeWidget)
                    print widget.callFunc("whatever the name is")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('whatever the name is', 'roSGNodeWidget@.whatever the name is', 'roSGNodeWidget').message
            ]);
        });

        it('validates arg type of callfunc()', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName(name as string, count as integer) as string
                    return "John Doe"
                end function
            `);

            program.setFile('source/test.bs', `
                sub printName(widget as roSGNodeWidget)
                    print widget.callFunc("getName", 12, "not int")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('has no error on plain roSGNode', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(nodeName as string)
                    node = createObject("roSgNode", nodeName)
                    node.callfunc("someFunc", 1, 2, 3)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('has error on regular builtIn types', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc()
                    node = createObject("roSgNode", "Rectangle")
                    node.callfunc("someFunc", 1, 2, 3)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', 'roSGNodeRectangle@.someFunc', 'roSGNodeRectangle')
            ]);
        });

        it('allows callfunc on flexible types', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(obj as object, dyn as dynamic, node as roSGNode)
                    obj.callfunc("testFunc")
                    obj@.testFunc()

                    dyn.callfunc("testFunc")
                    dyn@.testFunc()

                    node.callfunc("testFunc")
                    node@.testFunc()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows callfunc on components from component library', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc()
                    fromComponentLibrary = CreateObject("roSGNode", "library:SomeComponent")
                    fromComponentLibrary@.someFunc()
                    fromComponentLibrary.callfunc("someFunc")
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows callfunc on the dynamic result of a function call', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(nodeName)
                    getNode(nodeName)@.someCallFunc(1,2,3)
                end sub

                function getNode(nodeType)
                    return CreateObject("roSGNode", nodeType)
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates callfunc on a known result of a function call', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName(name as string, count as integer) as string
                    return "John Doe"
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc()
                    getWidget()@.getName("someStr", "not an int")
                end sub

                function getWidget() as roSGNodeWidget
                    return CreateObject("roSGNode", "Widget")
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('validates callfunc on a known result of a callfunc call', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                        <function name="getSelf" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName(name as string, count as integer) as string
                    return "John Doe"
                end function

                function getSelf() as roSGNodeWidget
                    return m.top
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(widget as roSGNodeWidget)
                    widget@.getSelf()@.getName("someStr", "not an int")
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('respects return value of as callfunc functions', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getInt" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                sub getInt() as integer
                    return 1
                end sub
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(widget as roSGNodeWidget)
                    takesInt(widget@.getInt())
                end sub

                sub takesInt(number as integer)
                    print number
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('respects return value of as callfunc functions - negative case', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getInt" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                sub getInt() as integer
                    return 1
                end sub
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(widget as roSGNodeWidget)
                    takesString(widget@.getInt())
                end sub

                sub takesString(word as string)
                    print word
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message
            ]);
        });

        it('allows return value of as void functions to be dynamic', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="noop" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                sub noop()
                end sub
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(widget as roSGNodeWidget)
                    takesAny(widget@.noop())
                end sub

                sub takesAny(anything)
                    print anything
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows callfunc operator on dynamic type', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(anything)
                    anything@.someFunc()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows callfunc operator on roSGNode type', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNode)
                    node@.someFunc()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });


        it('disallows callfunc operator on non-callfuncable type', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(i as integer, s as string, b as boolean)
                    i@.someFunc()
                    s@.someFunc()
                    b@.someFunc()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'integer').message,
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'string').message,
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'boolean').message
            ]);
        });


        it('disallows callfunc operator on non-callfuncable type', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc(i as integer, s as string, b as boolean)
                    i@.someFunc()
                    s@.someFunc()
                    b@.someFunc()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'integer').message,
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'string').message,
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'boolean').message
            ]);
        });

        it('allows callfunc operator on union of dynamic types', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc()
                    u = invalid
                    if rnd(0) > 0.5
                        u = getComponent1()
                    else
                        u = getComponent2()
                    end if

                    u@.someFunc()
                end sub
            `);

            program.setFile('source/test2.bs', `
                function getComponent1() as dynamic
                    return 2 ' unknown to be integer outside of function
                end function
            `);

            program.setFile('source/test3.bs', `
                function getComponent2() as dynamic
                    return 3 ' unknown to be integer outside of function
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('disallows callfunc operator on union of non-callfuncable types', () => {
            program.setFile('source/test.bs', `
                sub doCallfunc()
                    if rnd(0) > 0.5
                        u = 1
                    else
                        u = "hello"
                    end if

                    u@.someFunc()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('someFunc', null, 'integer or string').message
            ]);
        });

        it('allows callfunc on union of known components, with valid func', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNodeWidget or roSGNodeWidget2)
                    node@.getName()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('disallows callfunc on union of known components, with invalid func', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="getNumber" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                function getNumber() as float
                    return 3.14
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNodeWidget or roSGNodeWidget2)
                    node@.getName()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindCallFuncFunction('getName', '', 'roSGNodeWidget or roSGNodeWidget2').message
            ]);
        });

        it('uses return type of union of functions', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getData" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getData() as string
                    return "John Doe"
                end function
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="getData" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                function getData() as float
                    return 3.14
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNodeWidget or roSGNodeWidget2)
                    takesFloat(node@.getData())
                end sub

                sub takesFloat(x as float)
                    print x
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('string or float', 'float').message
            ]);
        });

        it('disallows callfunc on union with incompatible func types', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="doStuff" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                sub doStuff(input as string)
                    print "hello " + input
                end sub
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="doStuff" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                sub doStuff(input as float)
                    print input + 3.14
                end sub
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNodeWidget or roSGNodeWidget2, input)
                    node@.doStuff(input)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.incompatibleSymbolDefinition('node@.doStuff', {
                    isUnion: true,
                    data: {
                        expectedType: new TypedFunctionType(VoidType.instance).setName('doStuff').setSub(true).addParameter('input', FloatType.instance, false),
                        actualType: new TypedFunctionType(VoidType.instance).setName('doStuff').setSub(true).addParameter('input', FloatType.instance, false),
                        parameterMismatches: [{ index: 0, data: { expectedType: StringType.instance, actualType: FloatType.instance } }]
                    }
                }).message
            ]);
        });

        it('disallows callfunc on union with incompatible func types, that have the same signature', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="doStuff" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                interface MyStuff
                    data as boolean
                end interface

                sub doStuff(input as MyStuff)
                    print "hello " + input.data.toStr()
                end sub
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="doStuff" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                interface MyStuff
                    data as integer
                end interface

                sub doStuff(input as MyStuff)
                    print input.data + 3.14
                end sub
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNodeWidget or roSGNodeWidget2, input)
                    node@.doStuff(input)
                end sub
            `);
            program.validate();
            const stuff1IFace = new InterfaceType('MyStuff');
            const stuff2IFace = new InterfaceType('MyStuff');

            expectDiagnostics(program, [
                DiagnosticMessages.incompatibleSymbolDefinition('node@.doStuff', {
                    isUnion: true,
                    data: {
                        expectedType: new TypedFunctionType(VoidType.instance).setName('doStuff').setSub(true).addParameter('input', stuff1IFace, false),
                        actualType: new TypedFunctionType(VoidType.instance).setName('doStuff').setSub(true).addParameter('input', stuff2IFace, false),
                        parameterMismatches: [{ index: 0, data: { expectedType: stuff1IFace, actualType: stuff2IFace } }]
                    }
                }).message
            ]);
        });

        it('allows callfunc on intersection of callfuncable types', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName() as string
                    return "John Doe"
                end function
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="getName" />
                        <function name="getAge" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                function getName() as string
                    return "John Doe"
                end function

                function getAge() as integer
                    return 42
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSGNodeWidget and roSGNodeWidget2)
                    n = node@.getName()
                    a = node@.getAge()
                    takesStringAndInt(n, a)
                end sub

                sub takesStringAndInt(name as string, age as integer)
                    print name + age.toStr()
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('validates callfunc on intersection', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName(s as string) as string
                    return "John Doe" + s
                end function
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="getAge" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                function getAge(y as integer) as integer
                    return 42 + y
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSgNodeWidget and roSgNodeWidget2)
                    n = node@.getName(123)
                    a = node@.getAge("123")
                    takesStringAndInt(n, a)
                end sub

                sub takesStringAndInt(name as string, age as integer)
                    print name + age.toStr()
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.argumentTypeMismatch('integer', 'string').message,
                DiagnosticMessages.argumentTypeMismatch('string', 'integer').message
            ]);
        });

        it('validates callfunc on intersection of nodes with incompatible functions', () => {
            program.setFile('components/Widget.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget" extends="Group">
                    <script uri="Widget.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget.bs', `
                function getName(s as string) as string
                    return "John Doe" + s
                end function
            `);

            program.setFile('components/Widget2.xml', trim`
                <?xml version="1.0" encoding="utf-8" ?>
                <component name="Widget2" extends="Group">
                    <script uri="Widget2.bs"/>
                    <interface>
                        <function name="getName" />
                    </interface>
                </component>
            `);

            program.setFile('components/Widget2.bs', `
                function getName(y as integer) as integer
                    return 42 + y
                end function
            `);

            program.setFile('source/test.bs', `
                sub doCallfunc(node as roSgNodeWidget and roSgNodeWidget2)
                    n = node@.getName(123)
                end sub
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.notCallable('node@.getName').message
            ]);
        });
    });

    describe('notIterable', () => {
        it('allows iteration over array', () => {
            program.setFile('source/test.bs', `
                sub doStuff()
                    arr = [1, 2, 3]
                    for each item in arr
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows iteration over roArray', () => {
            program.setFile('source/test.bs', `
                sub doStuff()
                    arr = createObject("roArray", 10, true)
                    for each item in arr
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows iteration over roList', () => {
            program.setFile('source/test.bs', `
                sub doStuff()
                    list = createObject("roList")
                    for each item in list
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows iteration over AA', () => {
            program.setFile('source/test.bs', `
                sub doStuff()
                    aa = { a: 1, b: 2, c: 3 }
                    for each item in aa
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows iteration over byteArray', () => {
            program.setFile('source/test.bs', `
                sub doStuff(bytes as roByteArray)
                    for each item in bytes
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows iteration over roXMLList', () => {
            program.setFile('source/test.bs', `
                sub doStuff(list as roXMLList)
                    for each item in list
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('reports error when using for each on non-iterable type', () => {
            program.setFile('source/test.bs', `
                sub doStuff()
                    for each item in 123
                        print item
                    end for
                end sub
            `);
            program.validate();
            expectDiagnostics(program.diagnostics, [
                DiagnosticMessages.notIterable('integer').message
            ]);
        });
    });
});
