import * as sinonImport from 'sinon';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Program } from '../../Program';
import { expectDiagnostics, expectDiagnosticsIncludes, expectTypeToBe, expectZeroDiagnostics, trim } from '../../testHelpers.spec';
import { expect } from 'chai';
import type { TypeCompatibilityData } from '../../interfaces';
import { IntegerType } from '../../types/IntegerType';
import { StringType } from '../../types/StringType';
import type { BrsFile } from '../../files/BrsFile';
import { FloatType } from '../../types';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';

describe('ScopeValidator', () => {

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
            program.setFile('source/util.brs', `
                sub useCallFunc(input as roSGNodeWidget)
                    input.callFunc()
                end sub
            `);
            program.validate();
            //should have an error
            expectDiagnostics(program, [
                DiagnosticMessages.mismatchArgumentCount('1-32', 0)
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
            program.setFile('source/util.brs', `
                sub useCallFunc(input as roSGNodeWidget)
                    input.callFunc("someFunc", 1, 2, 3, {})
                end sub
            `);
            program.validate();
            //TODO: do a better job of handling callFunc() invocations!
            //should have an error
            expectZeroDiagnostics(program);
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
                DiagnosticMessages.cannotFindName('unknown', 'Klass.unknown')
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
                DiagnosticMessages.cannotFindName('length', 'string.length')
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
                    for each item in myAA.items
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
                DiagnosticMessages.cannotFindName('name', 'function.name')
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
                DiagnosticMessages.cannotFindName('name', 'function.name')
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
                DiagnosticMessages.returnTypeMismatch('string', 'void').message
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
            expectDiagnostics(program, [DiagnosticMessages.cannotFindName('getPi', 'Thing.getPi')]);
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
            expectDiagnosticsIncludes(program, [DiagnosticMessages.cannotFindName('SomeEnum').message]);
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
                program.plugins.emit('onFileValidate', validateFileEvent);
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

    });
});
