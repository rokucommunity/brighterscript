import * as sinonImport from 'sinon';

import { Program } from '../Program';
import { getTestTranspile } from './BrsFile.spec';
import type { BrsFile } from './BrsFile';
import { expect } from 'chai';
import { DiagnosticMessages } from '../DiagnosticMessages';
import type { Diagnostic } from 'vscode-languageserver';
import { Range, DiagnosticSeverity } from 'vscode-languageserver';
import { ParseMode } from '../parser/Parser';
import { expectZeroDiagnostics } from '../testHelpers.spec';
import { standardizePath as s } from '../util';
import * as fsExtra from 'fs-extra';
import { TranspileState } from '../parser/TranspileState';
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

    async function addFile(relativePath: string, text: string) {
        return program.addOrReplaceFile<BrsFile>({ src: `${rootDir}/${relativePath}`, dest: relativePath }, text);
    }

    it('detects all classes after parse', async () => {
        let file = await program.addOrReplaceFile<BrsFile>({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
            end class
            class Duck


            end class
        `);
        expect(file.parser.references.classStatements.map(x => x.getName(ParseMode.BrighterScript)).sort()).to.eql(['Animal', 'Duck']);
    });

    it('does not cause errors with incomplete class statement', async () => {
        await program.addOrReplaceFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class
        `);
        await program.validate();
        //if no exception was thrown, this test passes
    });

    it('catches child class missing super call in constructor', async () => {
        await program.addOrReplaceFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Person
                sub new()
                end sub
            end class
            class Infant extends Person
                sub new()
                end sub
            end class
        `);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.classConstructorMissingSuperCall().message
        );
    });

    it('access modifier is option for override', async () => {
        let file = await program.addOrReplaceFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                sub move()
                end sub
            end class

            class Duck extends Animal
                override sub move()
                end sub
            end class
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
        let duckClass = file.parser.references.classStatements.find(x => x.name.text.toLowerCase() === 'duck');
        expect(duckClass).to.exist;
        expect(duckClass.memberMap['move']).to.exist;
    });

    it('supports various namespace configurations', async () => {
        await program.addOrReplaceFile<BrsFile>({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
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
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });
    describe('super', () => {
        it('always requires super call in child constructor', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                class Bird
                end class
                class Duck extends Bird
                    sub new()
                    end sub
                end class
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).to.eql(DiagnosticMessages.classConstructorMissingSuperCall().message);
        });

        it('requires super call in child when parent has own `new` method', async () => {
            await program.addOrReplaceFile('source/main.bs', `
                class Bird
                    sub new()
                    end sub
                end class
                class Duck extends Bird
                    sub new()
                    end sub
                end class
            `);
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).to.eql(DiagnosticMessages.classConstructorMissingSuperCall().message);
        });

        it('allows non-`m` expressions and statements before the super call', async () => {
            await program.addOrReplaceFile('source/main.bs', `
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
            await program.validate();
            expect(program.getDiagnostics()[0]?.message).to.be.undefined;
        });

        it('allows non-`m` expressions and statements before the super call', async () => {
            await program.addOrReplaceFile('source/main.bs', `
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
            await program.validate();
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
        it('follows correct sequence for property initializers', async () => {
            await testTranspile(`
                class Animal
                    species = "Animal"
                    sub new()
                        print "From Animal: " + m.species
                    end sub
                end class
                class Duck extends Animal
                    species = "Duck"
                    sub new()
                        super()
                        print "From Duck: " + m.species
                    end sub
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                        m.species = "Animal"
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
                        m.species = "Duck"
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

        it('handles class inheritance inferred constructor calls', async () => {
            await testTranspile(`
                class Animal
                    className = "Animal"
                end class
                class Duck extends Animal
                    className = "Duck"
                end class
                class BabyDuck extends Duck
                    className = "BabyDuck"
                end class
            `, `
                function __Animal_builder()
                    instance = {}
                    instance.new = sub()
                        m.className = "Animal"
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
                        m.className = "Duck"
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
                        m.className = "BabyDuck"
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

        it('properly transpiles classes from outside current namespace', async () => {
            await addFile('source/Animals.bs', `
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
        `, undefined, 'source/main.bs');
        });

        it('new keyword transpiles correctly', async () => {
            await addFile('source/Animal.bs', `
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
    });

    it('detects using `new` keyword on non-classes', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            sub quack()
            end sub
            sub main()
                duck = new quack()
            end sub
        `);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.expressionIsNotConstructable('sub').message
        );
    });

    it('detects missing call to super', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub new()
                end sub
            end class
            class Duck extends Animal
                sub new()
                end sub
            end class
        `);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.classConstructorMissingSuperCall().message
        );
    });

    it.skip('detects calls to unknown m methods', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub new()
                    m.methodThatDoesNotExist()
                end sub
            end class
        `);
        await program.validate();
        expect(
            program.getDiagnostics()[0]?.message
        ).to.equal(
            DiagnosticMessages.methodDoesNotExistOnType('methodThatDoesNotExist', 'Animal')
        );
    });

    it('detects duplicate member names', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
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
        await program.validate();
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

    it('detects mismatched member type in child class', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                public name
            end class
            class Duck extends Animal
                public function name()
                    return "Donald"
                end function
            end class
        `);
        await program.validate();
        expect(
            program.getDiagnostics().map(x => x.message).sort()[0]
        ).to.eql(
            DiagnosticMessages.classChildMemberDifferentMemberTypeThanAncestor('method', 'field', 'Animal').message
        );
    });

    it('detects overridden property name in child class', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
                public name
            end class
            class Duck extends Animal
                public name
            end class
        `);
        await program.validate();
        let diagnostics = program.getDiagnostics().map(x => x.message);
        expect(diagnostics).to.eql([
            DiagnosticMessages.memberAlreadyExistsInParentClass('field', 'Animal').message
        ]);
    });

    it('detects overridden methods without override keyword', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.brs`, dest: 'source/main.brs' }, `
            class Animal
                sub speak()
                end sub
            end class
            class Duck extends Animal
                sub speak()
                end sub
            end class
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]).to.exist.and.to.include({
            ...DiagnosticMessages.missingOverrideKeyword('Animal')
        });
    });

    it('detects extending unknown parent class', async () => {
        await program.addOrReplaceFile('source/main.brs', `
            class Duck extends Animal
                sub speak()
                end sub
            end class
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]).to.exist.and.to.deep.include({
            ...DiagnosticMessages.classCouldNotBeFound('Animal', 'source'),
            range: Range.create(1, 31, 1, 37)
        });
    });

    it('catches newable class without namespace name', async () => {
        await program.addOrReplaceFile('source/main.bs', `
            namespace NameA.NameB
                class Duck
                end class
            end namespace
            sub main()
                ' this should be an error because the proper name is NameA.NameB.Duck"
                d = new Duck()
            end sub
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.classCouldNotBeFound('Duck', 'source').message
        );
    });

    it('supports newable class namespace inference', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Duck
                end class
                sub main()
                    d = new Duck()
                end sub
            end namespace
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('catches extending unknown namespaced class', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends NameA.NameB.Animal1
                end class
            end namespace
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.classCouldNotBeFound('NameA.NameB.Animal1', 'source').message
        );
    });

    it('supports omitting namespace prefix for items in same namespace', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Duck extends Animal
                end class
            end namespace
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).not.to.exist;
    });

    it('catches duplicate root-level class declarations', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            class Animal
            end class
            class Animal
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.duplicateClassDeclaration('source', 'Animal').message
        );
    });

    it('catches duplicate namespace-level class declarations', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
                class Animal
            end namespace
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.duplicateClassDeclaration('source', 'NameA.NameB.Animal').message
        );
    });

    it('catches namespaced class name which is the same as a global class', async () => {
        await program.addOrReplaceFile({ src: `${rootDir}/source/main.bs`, dest: 'source/main.bs' }, `
            namespace NameA.NameB
                class Animal
                end class
            end namespace
            class Animal
            end class
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.namespacedClassCannotShareNamewithNonNamespacedClass('Animal').message
        );
    });

    it('catches class with same name as function', async () => {
        await program.addOrReplaceFile('source/main.bs', `
            class Animal
            end class
            sub Animal()
            end sub
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.functionCannotHaveSameNameAsClass('Animal').message
        );
    });

    it('catches class with same name (but different case) as function', async () => {
        await program.addOrReplaceFile('source/main.bs', `
            class ANIMAL
            end class
            sub animal()
            end sub
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.functionCannotHaveSameNameAsClass('animal').message
        );
    });

    it('catches variable with same name as class', async () => {
        await program.addOrReplaceFile('source/main.bs', `
            class Animal
            end class
            sub main()
                animal = new Animal()
            end sub
        `);
        await program.validate();
        expect(program.getDiagnostics()[0]?.message).to.equal(
            DiagnosticMessages.localVarSameNameAsClass('Animal').message
        );
    });

    it('allows extending classes with more than one dot in the filename', async () => {
        await program.addOrReplaceFile('source/testclass.bs', `
            class Foo
            end class

            class Bar extends Foo
                sub new()
                    super()
                end sub
            end class
        `);

        await program.addOrReplaceFile('source/testclass_no_testdot.bs', `
            class BarNoDot extends Foo
                sub new()
                    super()
                end sub
            end class
        `);

        await program.addOrReplaceFile('source/testclass.dot.bs', `
            class BarDot extends Foo
                sub new()
                super()
                end sub
            end class
        `);

        await program.validate();
        expectZeroDiagnostics(program);
    });

    it('computes correct super index for grandchild class', async () => {
        await program.addOrReplaceFile('source/main.bs', `
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
        await program.addOrReplaceFile('source/ClassA.bs', `
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

    it('does not crash when parent class is missing', async () => {
        const file = await program.addOrReplaceFile<BrsFile>('source/ClassB.bs', `
            class ClassB extends ClassA
            end class
        `);
        doesNotThrow(() => {
            file.parser.references.classStatements[0].getParentClassIndex(new TranspileState(file));
        });
    });
});
