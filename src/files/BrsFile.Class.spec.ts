import * as sinonImport from 'sinon';

import { Program } from '../Program';
import type { BrsFile } from './BrsFile';
import { expect } from 'chai';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { Diagnostic } from 'vscode-languageserver';
import { Range, DiagnosticSeverity } from 'vscode-languageserver';
import { ParseMode } from '../parser/Parser';
import { expectZeroDiagnostics, getTestTranspile } from '../testHelpers.spec';
import { standardizePath as s } from '../util';
import * as fsExtra from 'fs-extra';
import { BrsTranspileState } from '../parser/BrsTranspileState';
import { doesNotThrow } from 'assert';

let sinon = sinonImport.createSandbox();

describe('BrsFile BrighterScript classes', () => {
    let tmpPath = s`${process.cwd()}/.tmp`;
    let rootDir = s`${tmpPath}/rootDir`;

    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);

    beforeEach(() => {
        fsExtra.ensureDirSync(rootDir);
        fsExtra.emptyDirSync(tmpPath);
        program = new Program({ rootDir: rootDir });
    });
    afterEach(() => {
        sinon.restore();
        program.dispose();
        fsExtra.ensureDirSync(tmpPath);
        fsExtra.emptyDirSync(tmpPath);
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
        expect(file.parser.references.classStatements.map(x => x.getName(ParseMode.BrighterScript)).sort()).to.eql(['Animal', 'Duck']);
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
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.classConstructorMissingSuperCall().message
        );
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
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
        let duckClass = file.parser.references.classStatements.find(x => x.name.text.toLowerCase() === 'duck');
        expect(duckClass).to.exist;
        expect(duckClass.memberMap['move']).to.exist;
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
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
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
            expect(program.getDiagnostics()[0]?.message).to.eql(DiagnosticMessages.classConstructorMissingSuperCall().message);
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
            expect(program.getDiagnostics()[0]?.message).to.eql(DiagnosticMessages.classConstructorMissingSuperCall().message);
        });

        it('allows non-`m` expressions and statements before the super call', () => {
            program.setFile('source/main.bs', `
                class Bird
                    sub new(name)
                    end sub
                end class
                class Duck extends Bird
                    sub new()
                        thing = { m: "m"}
                        print thing.m
                        name = "Donald" + "Duck"
                        super(name)
                    end sub
                end class
            `);
            program.validate();
            expect(program.getDiagnostics()[0]?.message).to.be.undefined;
        });

        it('allows non-`m` expressions and statements before the super call', () => {
            program.setFile('source/main.bs', `
                class Bird
                    sub new(name)
                    end sub
                end class
                class Duck extends Bird
                    sub new()
                        m.name = m.name + "Duck"
                        super()
                    end sub
                end class
            `);
            program.validate();
            expect(
                program.getDiagnostics().map(x => ({ message: x.message, range: x.range }))
            ).to.eql([{
                message: DiagnosticMessages.classConstructorIllegalUseOfMBeforeSuperCall().message,
                range: Range.create(7, 24, 7, 25)
            }, {
                message: DiagnosticMessages.classConstructorIllegalUseOfMBeforeSuperCall().message,
                range: Range.create(7, 33, 7, 34)
            }]);
        });

    });

    describe('transpile', () => {
        it('follows correct sequence for property initializers', () => {
            testTranspile(`
                class Animal
                    species1 = "Animal"
                    sub new()
                        print "From Animal: " + m.species
                    end sub
                end class
                class Duck extends Animal
                    species2 = "Duck"
                    sub new()
                        super()
                        print "From Duck: " + m.species
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                        m.species1 = "Animal"
                        print "From Animal: " + m.species
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
                        print "From Duck: " + m.species
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

        it('handles class inheritance inferred constructor calls', () => {
            testTranspile(`
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


        it('works with namespaces', () => {
            testTranspile(`
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

        it('works for simple  class', () => {
            testTranspile(`
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

        it('registers the constructor and properly handles its parameters', () => {
            testTranspile(`
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

        it('properly handles child class constructor override and super calls', () => {
            testTranspile(`
                class Animal
                    sub new(name as string)
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

        it('transpiles super in nested blocks', () => {
            testTranspile(`
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
                        if text <> invalid then
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

        it('properly transpiles classes from outside current namespace', () => {
            addFile('source/Animals.bs', `
                namespace Animals
                    class Duck
                    end class
                end namespace
                class Bird
                end class
            `);
            testTranspile(`
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

        it('properly transpiles new statement for missing class ', () => {
            testTranspile(`
                sub main()
                    bob = new Human()
                end sub
            `, `
                sub main()
                    bob = Human()
                end sub
            `, undefined, 'source/main.bs', false);
        });

        it('new keyword transpiles correctly', () => {
            addFile('source/Animal.bs', `
                class Animal
                    sub new(name as string)
                    end sub
                end class
            `);
            testTranspile(`
                sub main()
                    a = new Animal("donald")
                end sub
            `, `
                sub main()
                    a = Animal("donald")
                end sub
            `, undefined, 'source/main.bs');
        });

        it('does not screw up local variable references', () => {
            testTranspile(`
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

        it('calculates the proper super index', () => {
            testTranspile(`
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
    });

    it('detects using `new` keyword on non-classes', () => {
        program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            sub quack()
            end sub
            sub main()
                duck = new quack()
            end sub
        `);
        program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.expressionIsNotConstructable('sub').message
        );
    });

    it('detects missing call to super', () => {
        program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
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
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.classConstructorMissingSuperCall().message
        );
    });

    it.skip('detects calls to unknown m methods', () => {
        program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub new()
                    m.methodThatDoesNotExist()
                end sub
            end class
        `);
        program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.methodDoesNotExistOnType('methodThatDoesNotExist', 'Animal')
        );
    });

    it('detects duplicate member names', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
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
        let diagnostics = program.getDiagnostics().map(x => {
            return {
                code: x.code,
                message: x.message,
                range: x.range,
                severity: DiagnosticSeverity.Error
            };
        });
        expect(diagnostics).to.eql(<Partial<Diagnostic>[]>[{
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
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                public name
            end class
            class Duck extends Animal
                public function name()
                    return "Donald"
                end function
            end class
        `);
        program.validate();
        expect(
            program.getDiagnostics().map(x => x.message).sort()[0]
        ).to.eql(
            DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor('method', 'field', 'Animal').message
        );
    });

    it('allows untyped overridden field in child class', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
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
                public age = 12.2 'should be integer but is float
                public name = 12 'should be string but is integer
                public owner as string
            end class
        `);
        program.validate();
        expect(program.getDiagnostics().map(x => x.message).sort()).to.eql([
            DiagnosticMessages.cannotFindType('Person').message,
            DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty('Duck', 'Bird', 'age', 'float', 'integer').message,
            DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty('Duck', 'Bird', 'name', 'integer', 'string').message,
            DiagnosticMessages.childFieldTypeNotAssignableToBaseProperty('Duck', 'Bird', 'owner', 'string', 'Person').message
        ]);
    });

    it('detects overridden methods without override keyword', () => {
        program.setFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
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
        expect(program.getDiagnostics()[0]).to.exist.and.to.include({
            ...DiagnosticMessages.missingOverrideKeyword('Animal')
        });
    });

    it('detects overridden methods with different visibility', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
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
        expect(program.getDiagnostics()[0]).to.exist.and.to.include({
            ...DiagnosticMessages.mismatchedOverriddenMemberVisibility('Duck', 'speakInPublic', 'private', 'public', 'Animal')
        });
        expect(program.getDiagnostics()[1]).to.exist.and.to.include({
            ...DiagnosticMessages.mismatchedOverriddenMemberVisibility('Duck', 'speakWithFriends', 'public', 'protected', 'Animal')
        });
        expect(program.getDiagnostics()[2]).to.exist.and.to.include({
            ...DiagnosticMessages.mismatchedOverriddenMemberVisibility('Duck', 'speakWithFamily', 'public', 'private', 'Animal')
        });
    });
    it('allows overridden methods with matching visibility', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
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
        expect(program.getDiagnostics()).to.be.empty;
    });

    it('detects extending unknown parent class', () => {
        program.setFile('source/main.brs', `
            class Duck extends Animal
                sub speak()
                end sub
            end class
        `);
        program.validate();
        expect(program.getDiagnostics()[0]).to.exist.and.to.deep.include({
            ...DiagnosticMessages.classCouldNotBeFound('Animal', 'source'),
            range: Range.create(1, 31, 1, 37)
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
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.classCouldNotBeFound('Duck', 'source').message
        );
    });

    it('supports newable class namespace inference', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Duck
                end class
                sub main()
                    d = new Duck()
                end sub
            end namespace
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('catches extending unknown namespaced class', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends NameA.NameB.Animal1
                end class
            end namespace
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.classCouldNotBeFound('NameA.NameB.Animal1', 'source').message
        );
    });

    it('supports omitting namespace prefix for items in same namespace', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends Animal
                end class
            end namespace
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('catches duplicate root-level class declarations', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
            end class
            class Animal
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.duplicateClassDeclaration('source', 'Animal').message
        );
    });

    it('catches duplicate namespace-level class declarations', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Animal
            end namespace
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.duplicateClassDeclaration('source', 'NameA.NameB.Animal').message
        );
    });

    it('catches namespaced class name which is the same as a global class', () => {
        program.setFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
            end namespace
            class Animal
            end class
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.namespacedClassCannotShareNamewithNonNamespacedClass('Animal').message
        );
    });

    it('catches class with same name as function', () => {
        program.setFile('source/main.bs', `
            class Animal
            end class
            sub Animal()
            end sub
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.functionCannotHaveSameNameAsClass('Animal').message
        );
    });

    it('catches class with same name (but different case) as function', () => {
        program.setFile('source/main.bs', `
            class ANIMAL
            end class
            sub animal()
            end sub
        `);
        program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.functionCannotHaveSameNameAsClass('animal').message
        );
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
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.localVarSameNameAsClass('Animal').message
        );
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

    it('computes correct super index for grandchild class', () => {
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

        testTranspile(`
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

    it('computes correct super index for namespaced child class and global parent class', () => {
        program.setFile('source/ClassA.bs', `
            class ClassA
            end class
        `);

        testTranspile(`
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
            file.parser.references.classStatements[0].getParentClassIndex(new BrsTranspileState(file));
        });
    });
});
