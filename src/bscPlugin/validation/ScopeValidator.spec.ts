import * as sinonImport from 'sinon';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import { Program } from '../../Program';
import { expectDiagnostics, expectZeroDiagnostics } from '../../testHelpers.spec';
import { expect } from 'chai';

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
                DiagnosticMessages.argumentTypeMismatch('string', 'Direction')
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

        it('allows adding new properties to a class (but why would you want to?)', () => {
            program.setFile('source/util.bs', `
                sub doStuff(myThing as Thing)
                    myThing.getPi = 3.14
                end sub

                class Thing
                end class
            `);
            program.validate();
            //should have no errors
            expectZeroDiagnostics(program);
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
});
