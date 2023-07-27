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
});
