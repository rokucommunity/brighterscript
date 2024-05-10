import * as sinonImport from 'sinon';

import { Program } from '../Program';
import type { BrsFile } from './BrsFile';
import { expect } from '../chai-config.spec';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { Range } from 'vscode-languageserver';
import { ParseMode } from '../parser/Parser';
import { expectDiagnostics, expectDiagnosticsIncludes, expectZeroDiagnostics, getTestTranspile, trim } from '../testHelpers.spec';
import { standardizePath as s } from '../util';
import * as fsExtra from 'fs-extra';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { doesNotThrow } from 'assert';
import type { ClassStatement, MethodStatement } from '../parser/Statement';
import { tempDir, rootDir, stagingDir } from '../testHelpers.spec';
import { isClassStatement } from '../astUtils/reflection';
import { WalkMode } from '../astUtils/visitors';

let sinon = sinonImport.createSandbox();

describe('BrsFile BrighterScript classes', () => {
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.emptyDirSync(tempDir);
        program = new Program({ rootDir: rootDir, stagingDir: stagingDir });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
        fsExtra.ensureDirSync(tempDir);
        fsExtra.emptyDirSync(tempDir);
    });

    function addFile(relativePath: string, text: string) {
        return program.setFile<BrsFile>({ src: `${rootDir}/${relativePath}`, dest: relativePath }, text);
    }

    it('detects all classes after parse', () => {
        let file = program.setFile<BrsFile>({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
            end class
            class Duck


            end class
        `);
        const classStatements = file.ast.findChildren<ClassStatement>(isClassStatement);
        expect(classStatements.map(x => x.getName(ParseMode.BrighterScript)).sort()).to.eql(['Animal', 'Duck']);
    });

    it('does not cause errors with incomplete class statement', () => {
        program.setFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class
        `);
        program.validate();
        //if no exception was thrown, this test passes
    });

    it('catches child class missing super call in constructor', () => {
        program.setFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Person
                sub new()
                end sub
            end class
            class Infant extends Person
                sub new()
                end sub
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.classConstructorMissingSuperCall()
        ]);
    });

    it('allows class named `optional`', () => {
        program.setFile('source/main.bs', `
            class optional
                thing = 1
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('supports optional fields', () => {
        program.setFile('source/main.bs', `
            class Movie
                name as string
                optional subtitles as string
                public optional isRepeatEnabled as boolean
                private optional wasPlayed
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('access modifier is option for override', () => {
        let file = program.setFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                sub move()
                end sub
            end class

            class Duck extends Animal
                override sub move()
                end sub
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
        let duckClass = file.ast.findChildren<ClassStatement>(isClassStatement, { walkMode: WalkMode.visitStatements }).find(x => x.tokens.name.text.toLowerCase() === 'duck');
        expect(duckClass).to.exist;
        expect(duckClass!.memberMap['move']).to.exist;
    });

    it('supports various namespace configurations', () => {
        program.setFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                sub new()
                    bigBird = new Birds.Bird()
                    donald = new Birds.Duck()
                end sub
            end class

            namespace Birds
                class Bird
                    sub new()
                        dog = new Animal()
                        donald = new Duck()
                    end sub
                end class
                class Duck
                end class
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });
    describe('super', () => {
        it('always requires super call in child constructor', () => {
            program.setFile('source/main.bs', `
                class Bird
                end class
                class Duck extends Bird
                    sub new()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.classConstructorMissingSuperCall()
            ]);
        });

        it('requires super call in child when parent has own `new` method', () => {
            program.setFile('source/main.bs', `
                class Bird
                    sub new()
                    end sub
                end class
                class Duck extends Bird
                    sub new()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.classConstructorMissingSuperCall()
            ]);
        });

        it('allows non-`m` expressions and statements before the super call', () => {
            program.setFile('source/main.bs', `
                class Bird
                    sub new(name)
                    end sub
                end class
                class Duck extends Bird
                    sub new(name)
                        thing = { m: "m"}
                        print thing.m
                        name = "Donald" + "Duck"
                        super(name)
                    end sub
                end class
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('allows non-`m` expressions and statements before the super call', () => {
            program.setFile('source/main.bs', `
                class Bird
                    name as string
                    sub new(name as string)
                        m.name = name
                    end sub
                end class
                class Duck extends Bird
                    sub new()
                        m.name = m.name + "Duck"
                        super("Flappy")
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.classConstructorIllegalUseOfMBeforeSuperCall(),
                range: Range.create(9, 24, 9, 25)
            }, {
                ...DiagnosticMessages.classConstructorIllegalUseOfMBeforeSuperCall(),
                range: Range.create(9, 33, 9, 34)
            }]);
        });
    });

    describe('transpile', () => {
        it('does not mess with AST when injecting `super()` call', async () => {
            const file = program.setFile<BrsFile>('source/classes.bs', `
                class Parent
                end class

                class Child extends parent
                    sub new()
                        super()
                    end sub
                end class
            `);
            expect(
                (file.ast as any).statements[1].body[0].func.body.statements[0].expression.callee.tokens.name.text
            ).to.eql('super');
            await program.getTranspiledFileContents(file.srcPath);
            expect(
                (file.ast as any).statements[1].body[0].func.body.statements[0].expression.callee.tokens.name.text
            ).to.eql('super');
        });

        it('follows correct sequence for property initializers', async () => {
            await testTranspile(`
                class Animal
                    species1 = "Animal"
                    sub new()
                        print "From Animal: " + m.species1
                    end sub
                end class
                class Duck extends Animal
                    species2 = "Duck"
                    sub new()
                        super()
                        print "From Duck: " + m.species2
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                        m.species1 = "Animal"
                        print "From Animal: " + m.species1
                    end sub
                    return instance
                end function
                function Animal()
                    instance = __Animal_builder()
                    instance.new()
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                        m.species2 = "Duck"
                        print "From Duck: " + m.species2
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });

        it('allows comments as first line of constructor', async () => {
            await testTranspile(`
                class Animal
                end class
                class Duck extends Animal
                    sub new()
                        'comment should not cause double super call
                        super()
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Animal()
                    instance = __Animal_builder()
                    instance.new()
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        'comment should not cause double super call
                        m.super0_new()
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `);
        });

        it('does not inject a call to super if one exists', async () => {
            await testTranspile(`
                class Animal
                end class
                class Duck extends Animal
                    sub new()
                        print "I am a statement which does not use m"
                        super()
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Animal()
                    instance = __Animal_builder()
                    instance.new()
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        print "I am a statement which does not use m"
                        m.super0_new()
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `);
        });

        it('handles class inheritance inferred constructor calls', async () => {
            await testTranspile(`
                class Animal
                    className1 = "Animal"
                end class
                class Duck extends Animal
                    className2 = "Duck"
                end class
                class BabyDuck extends Duck
                    className3 = "BabyDuck"
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                        m.className1 = "Animal"
                    end sub
                    return instance
                end function
                function Animal()
                    instance = __Animal_builder()
                    instance.new()
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                        m.className2 = "Duck"
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
                function __BabyDuck_builder()
                    instance = __Duck_builder()
                    instance.super1_new = instance.new
                    instance.new = sub()
                        m.super1_new()
                        m.className3 = "BabyDuck"
                    end sub
                    return instance
                end function
                function BabyDuck()
                    instance = __BabyDuck_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('works with namespaces', async () => {
            await testTranspile(`
                namespace Birds.WaterFowl
                    class Duck
                    end class
                    class BabyDuck extends Duck
                    end class
                end namespace
            `, `
                function __Birds_WaterFowl_Duck_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Birds_WaterFowl_Duck()
                    instance = __Birds_WaterFowl_Duck_builder()
                    instance.new()
                    return instance
                end function
                function __Birds_WaterFowl_BabyDuck_builder()
                    instance = __Birds_WaterFowl_Duck_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                    end sub
                    return instance
                end function
                function Birds_WaterFowl_BabyDuck()
                    instance = __Birds_WaterFowl_BabyDuck_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('works for simple  class', async () => {
            await testTranspile(`
                class Duck
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('registers the constructor and properly handles its parameters', async () => {
            await testTranspile(`
                class Duck
                    sub new(name as string, age as integer)
                    end sub
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub(name as string, age as integer)
                    end sub
                    return instance
                end function
                function Duck(name as string, age as integer)
                    instance = __Duck_builder()
                    instance.new(name, age)
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('properly handles child class constructor override and super calls', async () => {
            await testTranspile(`
                class Animal
                    sub new(name as string)
                    end sub

                    sub DoSomething()
                    end sub
                end class

                class Duck extends Animal
                    sub new(name as string, age as integer)
                        super(name)
                        super.DoSomething()
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub(name as string)
                    end sub
                    instance.DoSomething = sub()
                    end sub
                    return instance
                end function
                function Animal(name as string)
                    instance = __Animal_builder()
                    instance.new(name)
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub(name as string, age as integer)
                        m.super0_new(name)
                        m.super0_DoSomething()
                    end sub
                    return instance
                end function
                function Duck(name as string, age as integer)
                    instance = __Duck_builder()
                    instance.new(name, age)
                    return instance
                end function
            `, undefined, 'source/main.bs');
        });

        it('transpiles super in nested blocks', async () => {
            await testTranspile(`
                class Creature
                    sub new(name as string)
                    end sub
                    function sayHello(text)
                    ? text
                    end function
                end class

                class Duck extends Creature
                    override function sayHello(text)
                        text = "The duck says " + text
                        if text <> invalid
                            super.sayHello(text)
                        end if
                    end function
                end class
            `, `
                function __Creature_builder()
                    instance = {}
                    instance.new = sub(name as string)
                    end sub
                    instance.sayHello = function(text)
                        ? text
                    end function
                    return instance
                end function
                function Creature(name as string)
                    instance = __Creature_builder()
                    instance.new(name)
                    return instance
                end function
                function __Duck_builder()
                    instance = __Creature_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                    end sub
                    instance.super0_sayHello = instance.sayHello
                    instance.sayHello = function(text)
                        text = "The duck says " + text
                        if text <> invalid
                            m.super0_sayHello(text)
                        end if
                    end function
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs'
            );
        });

        it('properly transpiles classes from outside current namespace', async () => {
            addFile('source/Animals.bs', `
                namespace Animals
                    class Duck
                    end class
                end namespace
                class Bird
                end class
            `);
            await testTranspile(`
                namespace Animals
                    sub init()
                        donaldDuck = new Duck()
                        daffyDuck = new Animals.Duck()
                        bigBird = new Bird()
                    end sub
                end namespace
            `, `
                sub Animals_init()
                    donaldDuck = Animals_Duck()
                    daffyDuck = Animals_Duck()
                    bigBird = Bird()
                end sub
            `, undefined, 'source/main.bs');
        });

        it('properly transpiles new statement for missing class ', async () => {
            await testTranspile(`
                sub main()
                    bob = new Human()
                end sub
            `, `
                sub main()
                    bob = Human()
                end sub
            `, undefined, 'source/main.bs', false);
        });

        it('new keyword transpiles correctly', async () => {
            addFile('source/Animal.bs', `
                class Animal
                    sub new(name as string)
                    end sub
                end class
            `);
            await testTranspile(`
                sub main()
                    a = new Animal("donald")
                end sub
            `, `
                sub main()
                    a = Animal("donald")
                end sub
            `, undefined, 'source/main.bs');
        });

        it('calls super ', async () => {
            const { file } = await testTranspile(`
                class Parent
                    sub new()
                    end sub
                end class
                class Child extends Parent
                    sub new()
                    end sub
                end class
            `, `
                function __Parent_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Parent()
                    instance = __Parent_builder()
                    instance.new()
                    return instance
                end function
                function __Child_builder()
                    instance = __Parent_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                    end sub
                    return instance
                end function
                function Child()
                    instance = __Child_builder()
                    instance.new()
                    return instance
                end function
            `, undefined, undefined, false);
            //the AST should not be permanently modified
            const constructor = (file as any).ast.statements[0].body[0] as MethodStatement;
            expect(constructor.func.body.statements).to.be.lengthOf(0);
        });

        it('adds field initializers', async () => {
            const { file } = await testTranspile(`
                class Person
                    sub new()
                    end sub
                    name = "Bob"
                end class
            `, `
                function __Person_builder()
                    instance = {}
                    instance.new = sub()
                        m.name = "Bob"
                    end sub
                    return instance
                end function
                function Person()
                    instance = __Person_builder()
                    instance.new()
                    return instance
                end function
            `);
            //the AST should not be permanently modified
            const constructor = (file as any).ast.statements[0].body[0] as MethodStatement;
            expect(constructor.func.body.statements).to.be.lengthOf(0);
        });

        it('does not screw up local variable references', async () => {
            await testTranspile(`
                class Animal
                    sub new(name as string)
                        m.name = name
                    end sub

                    name as string

                    sub move(distanceInMeters as integer)
                        print m.name + " moved " + distanceInMeters.ToStr() + " meters"
                    end sub
                end class

                class Duck extends Animal
                    override sub move(distanceInMeters as integer)
                        print "Waddling..."
                        super.move(distanceInMeters)
                    end sub
                end class

                class BabyDuck extends Duck
                    override sub move(distanceInMeters as integer)
                        super.move(distanceInMeters)
                        print "Fell over...I'm new at this"
                    end sub
                end class

                sub Main()
                    smokey = new Animal("Smokey")
                    smokey.move(1)
                    '> Bear moved 1 meters

                    donald = new Duck("Donald")
                    donald.move(2)
                    '> Waddling...\\nDonald moved 2 meters

                    dewey = new BabyDuck("Dewey")
                    dewey.move(3)
                    '> Waddling...\\nDewey moved 2 meters\\nFell over...I'm new at this
                end sub
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub(name as string)
                        m.name = invalid
                        m.name = name
                    end sub
                    instance.move = sub(distanceInMeters as integer)
                        print m.name + " moved " + distanceInMeters.ToStr() + " meters"
                    end sub
                    return instance
                end function
                function Animal(name as string)
                    instance = __Animal_builder()
                    instance.new(name)
                    return instance
                end function
                function __Duck_builder()
                    instance = __Animal_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                    end sub
                    instance.super0_move = instance.move
                    instance.move = sub(distanceInMeters as integer)
                        print "Waddling..."
                        m.super0_move(distanceInMeters)
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
                function __BabyDuck_builder()
                    instance = __Duck_builder()
                    instance.super1_new = instance.new
                    instance.new = sub()
                        m.super1_new()
                    end sub
                    instance.super1_move = instance.move
                    instance.move = sub(distanceInMeters as integer)
                        m.super1_move(distanceInMeters)
                        print "Fell over...I'm new at this"
                    end sub
                    return instance
                end function
                function BabyDuck()
                    instance = __BabyDuck_builder()
                    instance.new()
                    return instance
                end function

                sub Main()
                    smokey = Animal("Smokey")
                    smokey.move(1)
                    '> Bear moved 1 meters

                    donald = Duck("Donald")
                    donald.move(2)
                    '> Waddling...\\nDonald moved 2 meters

                    dewey = BabyDuck("Dewey")
                    dewey.move(3)
                    '> Waddling...\\nDewey moved 2 meters\\nFell over...I'm new at this
                end sub
            `, 'trim', 'source/main.bs');
        });

        it('calculates the proper super index', async () => {
            await testTranspile(`
                class Duck
                    public sub walk(meters as integer)
                        print "Walked " + meters.ToStr() + " meters"
                    end sub
                end class

                class BabyDuck extends Duck
                    public override sub walk(meters as integer)
                        print "Tripped"
                        super.walk(meters)
                    end sub
                end class
            `, `
                function __Duck_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    instance.walk = sub(meters as integer)
                        print "Walked " + meters.ToStr() + " meters"
                    end sub
                    return instance
                end function
                function Duck()
                    instance = __Duck_builder()
                    instance.new()
                    return instance
                end function
                function __BabyDuck_builder()
                    instance = __Duck_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new()
                    end sub
                    instance.super0_walk = instance.walk
                    instance.walk = sub(meters as integer)
                        print "Tripped"
                        m.super0_walk(meters)
                    end sub
                    return instance
                end function
                function BabyDuck()
                    instance = __BabyDuck_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });


        it('adds namespacing to constructors on field definitions', async () => {
            await testTranspile(`
                namespace MyNS
                    class KlassOne
                        other = new KlassTwo()
                    end class

                    class KlassTwo
                    end class
                end namespace
            `, `
                function __MyNS_KlassOne_builder()
                    instance = {}
                    instance.new = sub()
                        m.other = MyNS_KlassTwo()
                    end sub
                    return instance
                end function
                function MyNS_KlassOne()
                    instance = __MyNS_KlassOne_builder()
                    instance.new()
                    return instance
                end function
                function __MyNS_KlassTwo_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function MyNS_KlassTwo()
                    instance = __MyNS_KlassTwo_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });

        it('works with enums as field initial values inside a namespace', async () => {
            await testTranspile(`
                namespace MyNS
                    class HasEnumKlass
                        enumValue = MyEnum.A
                    end class
                    enum MyEnum
                        A = "A"
                        B = "B"
                    end enum
                end namespace
            `, `
                function __MyNS_HasEnumKlass_builder()
                    instance = {}
                    instance.new = sub()
                        m.enumValue = "A"
                    end sub
                    return instance
                end function
                function MyNS_HasEnumKlass()
                    instance = __MyNS_HasEnumKlass_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });

        it('allows enums as super args inside a namespace', async () => {
            await testTranspile(`
                namespace MyNS
                    class SubKlass extends SuperKlass
                        sub new()
                            super(MyEnum.B)
                        end sub
                    end class

                    class SuperKlass
                        sub new(enumVal as MyEnum)
                            print enumVal
                        end sub
                    end class

                    enum MyEnum
                        A = "A"
                        B = "B"
                    end enum
                end namespace
            `, `
                function __MyNS_SubKlass_builder()
                    instance = __MyNS_SuperKlass_builder()
                    instance.super0_new = instance.new
                    instance.new = sub()
                        m.super0_new("B")
                    end sub
                    return instance
                end function
                function MyNS_SubKlass()
                    instance = __MyNS_SubKlass_builder()
                    instance.new()
                    return instance
                end function
                function __MyNS_SuperKlass_builder()
                    instance = {}
                    instance.new = sub(enumVal as dynamic)
                        print enumVal
                    end sub
                    return instance
                end function
                function MyNS_SuperKlass(enumVal as dynamic)
                    instance = __MyNS_SuperKlass_builder()
                    instance.new(enumVal)
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });

        it('works with enums as values referenced in a namespace directly', async () => {
            await testTranspile(`
                namespace MyNS
                    class HasEnumKlass
                        myArray = [true, true] as boolean[]
                        sub new()
                            m.myArray[MyEnum.A] = true
                            m.myArray[MyEnum.B] = false
                        end sub
                    end class
                    enum MyEnum
                        A = 0
                        B = 1
                    end enum
                end namespace
            `, `
                function __MyNS_HasEnumKlass_builder()
                    instance = {}
                    instance.new = sub()
                        m.myArray = [
                            true
                            true
                        ]
                        m.myArray[0] = true
                        m.myArray[1] = false
                    end sub
                    return instance
                end function
                function MyNS_HasEnumKlass()
                    instance = __MyNS_HasEnumKlass_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });

        it('works with enums as values referenced in a namespace with namespace', async () => {
            await testTranspile(`
                namespace MyNS
                    class HasEnumKlass
                        myArray = [true, true] as boolean[]
                        sub new()
                            m.myArray[MyNS.MyEnum.A] = true
                            m.myArray[MyNS.MyEnum.B] = false
                        end sub
                    end class
                    enum MyEnum
                        A = 0
                        B = 1
                    end enum
                end namespace
            `, `
                function __MyNS_HasEnumKlass_builder()
                    instance = {}
                    instance.new = sub()
                        m.myArray = [
                            true
                            true
                        ]
                        m.myArray[0] = true
                        m.myArray[1] = false
                    end sub
                    return instance
                end function
                function MyNS_HasEnumKlass()
                    instance = __MyNS_HasEnumKlass_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });

        it('allows namespaced class function as function parameters', async () => {
            await testTranspile(`
                namespace Alpha
                    function foo()
                        return 1
                    end function

                    function callSomeFunc(f as function)
                        return f()
                    end function

                    sub callFoo()
                        callSomeFunc(foo)
                    end sub
                end namespace
            `, `
                function Alpha_foo()
                    return 1
                end function

                function Alpha_callSomeFunc(f as function)
                    return f()
                end function

                sub Alpha_callFoo()
                    Alpha_callSomeFunc(Alpha_foo)
                end sub
            `, 'trim', 'source/main.bs');
        });

        it('allows namespaced class constructors as function parameters', async () => {
            await testTranspile(`
                namespace Alpha
                    class Button
                    end class

                    function callSomeFunc(f as function)
                        return f()
                    end function

                    sub makeButton()
                        callSomeFunc(Button)
                    end sub
                end namespace
            `, `
                function __Alpha_Button_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Alpha_Button()
                    instance = __Alpha_Button_builder()
                    instance.new()
                    return instance
                end function

                function Alpha_callSomeFunc(f as function)
                    return f()
                end function

                sub Alpha_makeButton()
                    Alpha_callSomeFunc(Alpha_Button)
                end sub
            `, 'trim', 'source/main.bs');
        });

        it('allows class constructors as functions in array', async () => {
            await testTranspile(`
                namespace Alpha
                    class Button
                    end class

                    class ButtonContainer
                        private button = new Alpha.Button()

                        sub new()
                            m.init()
                        end sub

                        sub init()
                            button = new Alpha.Button()
                            items = [m.button, button, Alpha.Button]
                        end sub
                    end class
                end namespace
            `, `
                function __Alpha_Button_builder()
                    instance = {}
                    instance.new = sub()
                    end sub
                    return instance
                end function
                function Alpha_Button()
                    instance = __Alpha_Button_builder()
                    instance.new()
                    return instance
                end function
                function __Alpha_ButtonContainer_builder()
                    instance = {}
                    instance.new = sub()
                        m.button = Alpha_Button()
                        m.init()
                    end sub
                    instance.init = sub()
                        button = Alpha_Button()
                        items = [
                            m.button
                            Alpha_button
                            Alpha_Button
                        ]
                    end sub
                    return instance
                end function
                function Alpha_ButtonContainer()
                    instance = __Alpha_ButtonContainer_builder()
                    instance.new()
                    return instance
                end function
            `, 'trim', 'source/main.bs');
        });
    });

    it('detects using `new` keyword on non-classes', () => {
        program.setFile('source/main.bs', `
            sub quack()
            end sub
            sub main()
                duck = new quack()
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.expressionIsNotConstructable('quack')
        ]);
    });

    it('detects missing call to super', () => {
        program.setFile('source/main.bs', `
            class Animal
                sub new()
                end sub
            end class
            class Duck extends Animal
                sub new()
                end sub
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.classConstructorMissingSuperCall()
        ]);
    });

    it.skip('detects calls to unknown m methods', () => {
        program.setFile('source/main.bs', `
            class Animal
                sub new()
                    m.methodThatDoesNotExist()
                end sub
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.methodDoesNotExistOnType('methodThatDoesNotExist', 'Animal')
        ]);
    });

    it('detects direct circular extends', () => {
        //direct
        program.setFile('source/Direct.bs', `
            class Parent extends Child
            end class

            class Child extends Parent
            end class
        `);
        program.validate();
        expect(
            program.getDiagnostics().map(x => x.message).sort()
        ).to.eql([
            DiagnosticMessages.circularReferenceDetected(['Child', 'Parent', 'Child'], 'source').message,
            DiagnosticMessages.circularReferenceDetected(['Parent', 'Child', 'Parent'], 'source').message
        ]);
    });

    it('detects indirect circular extends', () => {
        //direct
        program.setFile('source/Indirect.bs', `
            class Parent extends Grandchild
            end class

            class Child extends Parent
            end class

            class Grandchild extends Child
            end class
        `);
        program.validate();
        expect(
            program.getDiagnostics().map(x => x.message).sort()
        ).to.eql([
            DiagnosticMessages.circularReferenceDetected(['Child', 'Parent', 'Grandchild', 'Child'], 'source').message,
            DiagnosticMessages.circularReferenceDetected(['Grandchild', 'Child', 'Parent', 'Grandchild'], 'source').message,
            DiagnosticMessages.circularReferenceDetected(['Parent', 'Grandchild', 'Child', 'Parent'], 'source').message
        ]);
    });

    it('transpiles super method calls twice', async () => {
        program.setFile('source/lib.bs', `
            class Being
                function think()
                    print "thinking..."
                end function
            end class

            class Human extends Being
                function think()
                    super.think()
                end function
            end class
        `);
        await program.build({ stagingDir: stagingDir });
        fsExtra.emptyDirSync(stagingDir);
        await program.build({ stagingDir: stagingDir });
        expect(
            fsExtra.readFileSync(s`${stagingDir}/source/lib.brs`).toString().trimEnd()
        ).to.eql(trim`
            function __Being_builder()
                instance = {}
                instance.new = sub()
                end sub
                instance.think = function()
                    print "thinking..."
                end function
                return instance
            end function
            function Being()
                instance = __Being_builder()
                instance.new()
                return instance
            end function
            function __Human_builder()
                instance = __Being_builder()
                instance.super0_new = instance.new
                instance.new = sub()
                    m.super0_new()
                end sub
                instance.think = function()
                    m.super0_think()
                end function
                return instance
            end function
            function Human()
                instance = __Human_builder()
                instance.new()
                return instance
            end function
        `);
    });

    it('detects duplicate member names', () => {
        program.setFile('source/main.bs', `
            class Animal
                public name
                public name
                public sub name()
                end sub
                public sub age()
                end sub
                public sub age()
                end sub
                public age
            end class
        `);
        program.validate();
        expectDiagnostics(program, [{
            ...DiagnosticMessages.duplicateIdentifier('name'),
            range: Range.create(3, 23, 3, 27)
        }, {
            ...DiagnosticMessages.duplicateIdentifier('name'),
            range: Range.create(4, 27, 4, 31)
        }, {
            ...DiagnosticMessages.duplicateIdentifier('age'),
            range: Range.create(8, 27, 8, 30)
        }, {
            ...DiagnosticMessages.duplicateIdentifier('age'),
            range: Range.create(10, 23, 10, 26)
        }]);
    });

    it('detects mismatched member type in child class', () => {
        program.setFile('source/main.bs', `
            class Animal
                public name
            end class
            class Duck extends Animal
                public override function name()
                    return "Donald"
                end function
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor('method', 'field', 'Animal')
        ]);
    });

    it('allows untyped overridden field in child class', () => {
        program.setFile('source/main.bs', `
            class Animal
                public name
            end class
            class Duck extends Animal
                public name
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('allows overridden property name in child class', () => {
        program.setFile('source/main.bs', `
            class Bird
                public name = "bird"
            end class
            class Duck extends Bird
                public name = "duck"
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('flags incompatible child field type changes', () => {
        program.setFile('source/main.bs', `
            class Bird
                public age = 12
                public name = "bird"
                public owner as Person
            end class
            class Duck extends Bird
                public age = 12.2 'should be integer, but a float can be assigned to an int
                public name = 12 'should be string but is integer
                public owner as string
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.cannotFindName('Person'),
            DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty('Duck', 'Bird', 'name', 'integer', 'string'),
            DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty('Duck', 'Bird', 'owner', 'string', 'Person')
        ]);
    });

    it('detects overridden methods without override keyword', () => {
        program.setFile('source/main.bs', `
            class Animal
                sub speak()
                end sub
            end class
            class Duck extends Animal
                sub speak()
                end sub
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.missingOverrideKeyword('Animal')
        ]);
    });

    it('detects overridden methods with different visibility', () => {
        program.setFile('source/main.bs', `
            class Animal
                sub speakInPublic()
                end sub
                protected sub speakWithFriends()
                end sub
                private sub speakWithFamily()
                end sub
            end class
            class Duck extends Animal
                private override sub speakInPublic()
                end sub
                public override sub speakWithFriends()
                end sub
                override sub speakWithFamily()
                end sub
            end class
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.mismatchedOverriddenMemberVisibility('Duck', 'speakInPublic', 'private', 'public', 'Animal'),
            DiagnosticMessages.mismatchedOverriddenMemberVisibility('Duck', 'speakWithFriends', 'public', 'protected', 'Animal'),
            DiagnosticMessages.mismatchedOverriddenMemberVisibility('Duck', 'speakWithFamily', 'public', 'private', 'Animal')
        ]);
    });

    it('allows overridden methods with matching visibility', () => {
        program.setFile('source/main.bs', `
            class Animal
                sub speakInPublic()
                end sub
                protected sub speakWithFriends()
                end sub
                private sub speakWithFamily()
                end sub
            end class
            class Duck extends Animal
                override sub speakInPublic()
                end sub
                protected override sub speakWithFriends()
                end sub
                private override sub speakWithFamily()
                end sub
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    describe('detects unknown parent class', () => {
        it('non-namespaced parent from outside namespace', () => {
            program.setFile('source/main.bs', `
                class Duck extends Animal
                    sub speak()
                    end sub
                end class

                namespace Vertibrates
                    class Animal
                    end class
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.cannotFindName('Animal'),
                range: Range.create(1, 35, 1, 41)
            }]);
        });

        it('non-namespaced parent from within namespace', () => {
            program.setFile('source/main.bs', `
                namespace Vertibrates
                    class Duck extends Animal
                        sub speak()
                        end sub
                    end class
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Animal')
            ]);
        });

        it('non-namespaced name from outside namespace alongside existing namespace', () => {
            program.setFile('source/main.bs', `
                namespace Vertibrates
                    class Animal
                    end class
                end namespace

                class Duck extends Animal
                    sub speak()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('Animal')
            ]);
        });

        it('namespaced parent class from outside namespace', () => {
            program.setFile('source/vertibrates.bs', `
                namespace Vertibrates
                    class Bird
                    end class
                end namespace
            `);
            program.setFile('source/Duck.bs', `
                class Duck extends Vertibrates.GroundedBird
                    sub speak()
                    end sub
                end class
            `);
            program.validate();
            expectDiagnostics(program, [{
                ...DiagnosticMessages.cannotFindName('GroundedBird', 'Vertibrates.GroundedBird', 'Vertibrates', 'namespace')
            }]);
        });

        it('namespaced parent class from inside namespace', () => {
            program.setFile('source/vertibrates.bs', `
                namespace Vertibrates
                    class Bird
                    end class
                end namespace
            `);
            program.setFile('source/Duck.bs', `
                namespace Birdies
                    class Duck extends Vertibrates.GroundedBird
                        sub speak()
                        end sub
                    end class
                end namespace
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.cannotFindName('GroundedBird', 'Vertibrates.GroundedBird', 'Vertibrates', 'namespace').message
            ]);
        });
    });

    it('catches newable class without namespace name', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
                class Duck
                end class
            end namespace
            sub main()
                ' this should be an error because the proper name is NameA.NameB.Duck"
                d = new Duck()
            end sub
        `);
        program.validate();
        expectDiagnosticsIncludes(program, [
            DiagnosticMessages.cannotFindName('Duck'),
            DiagnosticMessages.expressionIsNotConstructable('Duck')
        ]);
    });

    it('supports newable class namespace inference', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
                class Duck
                end class
                sub main()
                    d = new Duck()
                end sub
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('catches extending unknown namespaced class', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends NameA.NameB.AnimalNotDefined
                end class
            end namespace
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.cannotFindName('AnimalNotDefined', 'NameA.NameB.AnimalNotDefined', 'NameA.NameB', 'namespace')
        ]);
    });

    it('supports omitting namespace prefix for items in same namespace', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends Animal
                end class
            end namespace
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('catches duplicate root-level class declarations', () => {
        program.setFile('source/main.bs', `
            class Animal
            end class
            class Animal
            end class
        `);
        program.validate();
        expectDiagnosticsIncludes(program, [
            DiagnosticMessages.nameCollision('Class', 'Class', 'Animal')
        ]);
    });

    it('catches duplicate namespace-level class declarations', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
                class Animal
                end class
                class Animal
                end class
            end namespace
        `);
        program.validate();
        expectDiagnosticsIncludes(program, [
            DiagnosticMessages.nameCollision('Class', 'Class', 'Animal').message
        ]);
    });

    it('allows namespaced class name which is the same as a global class', () => {
        program.setFile('source/main.bs', `
            namespace NameA.NameB
                class Animal
                    name as string
                end class

                sub printThisAnimalName(ani as Animal) ' this refers to NameA.NameB.Animal
                    print ani.name
                end sub
            end namespace

            class Animal
                doesNotHaveName as string
            end class
        `);
        program.validate();
        expectZeroDiagnostics(program);
    });

    it('catches class with same name as function', () => {
        program.setFile('source/main.bs', `
            class Animal
            end class
            sub Animal()
            end sub
        `);
        program.validate();
        expectDiagnosticsIncludes(program, [
            DiagnosticMessages.functionCannotHaveSameNameAsClass('Animal').message
        ]);
    });

    it('catches class with same name (but different case) as function', () => {
        program.setFile('source/main.bs', `
            class ANIMAL
            end class
            sub animal()
            end sub
        `);
        program.validate();
        expectDiagnosticsIncludes(program, [
            DiagnosticMessages.functionCannotHaveSameNameAsClass('animal').message
        ]);
    });

    it('catches variable with same name as class', () => {
        program.setFile('source/main.bs', `
            class Animal
            end class
            sub main()
                animal = new Animal()
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.localVarSameNameAsClass('Animal').message
        ]);
    });

    it('allows extending classes with more than one dot in the filename', () => {
        program.setFile('source/testclass.bs', `
            class Foo
            end class

            class Bar extends Foo
                sub new()
                    super()
                end sub
            end class
        `);

        program.setFile('source/testclass_no_testdot.bs', `
            class BarNoDot extends Foo
                sub new()
                    super()
                end sub
            end class
        `);

        program.setFile('source/testclass.dot.bs', `
            class BarDot extends Foo
                sub new()
                super()
                end sub
            end class
        `);

        program.validate();
        expectZeroDiagnostics(program);
    });

    it('computes correct super index for grandchild class', async () => {
        program.setFile('source/main.bs', `
            sub Main()
                c = new App.ClassC()
            end sub

            namespace App
                class ClassA
                end class

                class ClassB extends ClassA
                end class
            end namespace
        `);

        await testTranspile(`
            namespace App
                class ClassC extends ClassB
                    sub new()
                        super()
                    end sub
                end class
            end namespace
        `, `
            function __App_ClassC_builder()
                instance = __App_ClassB_builder()
                instance.super1_new = instance.new
                instance.new = sub()
                    m.super1_new()
                end sub
                return instance
            end function
            function App_ClassC()
                instance = __App_ClassC_builder()
                instance.new()
                return instance
            end function
        `, 'trim', 'source/App.ClassC.bs');
    });

    it('computes correct super index for namespaced child class and global parent class', async () => {
        program.setFile('source/ClassA.bs', `
            class ClassA
            end class
        `);

        await testTranspile(`
            namespace App
                class ClassB extends ClassA
                end class
            end namespace
        `, `
            function __App_ClassB_builder()
                instance = __ClassA_builder()
                instance.super0_new = instance.new
                instance.new = sub()
                    m.super0_new()
                end sub
                return instance
            end function
            function App_ClassB()
                instance = __App_ClassB_builder()
                instance.new()
                return instance
            end function
        `, 'trim', 'source/App.ClassB.bs');
    });

    it('does not crash when parent class is missing', () => {
        const file = program.setFile<BrsFile>('source/ClassB.bs', `
            class ClassB extends ClassA
            end class
        `);
        doesNotThrow(() => {
            const classStatements = file.ast.findChildren<ClassStatement>(isClassStatement);
            classStatements[0]['getParentClassIndex'](new BrsTranspileState(file));
        });
    });

    it('does not crash when child has field with same name as sub in parent', () => {
        program.setFile('source/main.bs', `
            class Parent
                public function helloWorld()
                end function
            end class
            class Child extends Parent
                public helloWorld as string
            end class
        `);
        program.validate();
    });

    it('does not crash when child has method with same name as field in parent', () => {
        program.setFile('source/main.bs', `
            class Parent
                public helloWorld as string
            end class
            class Child extends Parent
                public function helloWorld()
                end function
            end class
        `);
        program.validate();
    });

    it('detects calling class constructors with too many parameters', () => {
        program.setFile('source/main.bs', `
            class Parameterless
                sub new()
                end sub
            end class

            class OneParam
                sub new(param1)
                end sub
            end class

            sub main()
                c1 = new Parameterless(1)
                c2 = new OneParam(1, 2)
                c2 = new OneParam()
            end sub
        `);
        program.validate();
        expectDiagnostics(program, [
            DiagnosticMessages.mismatchArgumentCount(0, 1),
            DiagnosticMessages.mismatchArgumentCount(1, 2),
            DiagnosticMessages.mismatchArgumentCount(1, 0)
        ]);
    });
});
