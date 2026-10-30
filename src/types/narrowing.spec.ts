import { expect } from '../chai-config.spec';
import { Program } from '../Program';
import type { BrsFile } from '../files/BrsFile';
import type { PrintStatement } from '../parser/Statement';
import { isPrintStatement } from '../astUtils/reflection';
import { WalkMode } from '../astUtils/visitors';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { DiagnosticMessages } from '../DiagnosticMessages';
import { expectDiagnostics, expectDiagnosticsIncludes, expectTypeToBe, expectZeroDiagnostics, getTestGetTypedef, getTestTranspile, rootDir } from '../testHelpers.spec';
import { excludeType, narrowTypeTo } from './narrowing';
import { ClassType } from './ClassType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { InvalidType } from './InvalidType';
import { NeverType } from './NeverType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';
import { ObjectType } from './ObjectType';
import type { TypedFunctionType } from './TypedFunctionType';
import { BooleanType } from './BooleanType';

describe('type narrowing', () => {
    let program: Program;
    let testTranspile = getTestTranspile(() => [program, rootDir]);
    let testGetTypedef = getTestGetTypedef(() => [program, rootDir]);

    beforeEach(() => {
        program = new Program({
            rootDir: rootDir
        });
    });

    afterEach(() => {
        program.dispose();
    });

    /**
     * Get the type of the first expression of every print statement in the file, as a string
     */
    function getPrintedTypes(file: BrsFile) {
        const prints = [] as PrintStatement[];
        file.ast.walk((node) => {
            if (isPrintStatement(node)) {
                prints.push(node);
            }
        }, { walkMode: WalkMode.visitStatementsRecursive });
        return prints.map(print => print.expressions[0].getType({ flags: SymbolTypeFlag.runtime })?.toString());
    }

    const classes = `
        class Animal
            name as string
        end class
        class Dog extends Animal
            sub bark()
            end sub
        end class
        class Foo
            name as string
        end class
        class Bar
            size as integer
        end class
        function isFoo(value) as value is Foo
            return true
        end function
        function isBar(value) as value is Bar
            return true
        end function
        function isDog(value as Animal) as value is Dog
            return true
        end function
    `;

    describe('narrowTypeTo', () => {
        const foo = new ClassType('Foo');
        const bar = new ClassType('Bar');

        it('narrows dynamic and object to the guarded type', () => {
            expect(narrowTypeTo(DynamicType.instance, foo)).to.equal(foo);
            expect(narrowTypeTo(new ObjectType(), foo)).to.equal(foo);
        });

        it('keeps only the union members the guard allows', () => {
            expect(narrowTypeTo(new UnionType([StringType.instance, foo]), foo)).to.equal(foo);
            expect(narrowTypeTo(new UnionType([foo, bar, StringType.instance]), foo)).to.equal(foo);
        });

        it('removes invalid from the union', () => {
            expect(narrowTypeTo(new UnionType([foo, InvalidType.instance]), foo)).to.equal(foo);
        });

        it('keeps invalid when guarding for invalid', () => {
            expectTypeToBe(narrowTypeTo(new UnionType([foo, InvalidType.instance]), InvalidType.instance), InvalidType);
        });

        it('trusts the guard when no union member matches', () => {
            expect(narrowTypeTo(new UnionType([StringType.instance, IntegerType.instance]), foo)).to.equal(foo);
            expect(narrowTypeTo(StringType.instance, foo)).to.equal(foo);
        });

        it('keeps a type that is already more specific than the guard', () => {
            const animal = new ClassType('Animal');
            const dog = new ClassType('Dog', animal);
            expect(narrowTypeTo(dog, animal)).to.equal(dog);
        });
    });

    describe('excludeType', () => {
        const foo = new ClassType('Foo');

        it('removes the guarded type from the union', () => {
            expect(excludeType(new UnionType([StringType.instance, foo]), foo)).to.equal(StringType.instance);
        });

        it('removes the guarded type from nested unions', () => {
            expect(excludeType(new UnionType([new UnionType([StringType.instance, foo]), IntegerType.instance]), foo).toString()).to.eql('string or integer');
        });

        it('keeps invalid in the union', () => {
            expectTypeToBe(excludeType(new UnionType([foo, InvalidType.instance]), foo), InvalidType);
        });

        it('returns never when every type is removed', () => {
            expect(excludeType(foo, foo)).to.equal(NeverType.instance);
            expect(excludeType(new UnionType([foo]), foo)).to.equal(NeverType.instance);
        });

        it('does not narrow dynamic or object', () => {
            expect(excludeType(DynamicType.instance, foo)).to.equal(DynamicType.instance);
            const objectType = new ObjectType();
            expect(excludeType(objectType, foo)).to.equal(objectType);
        });

        it('leaves unrelated types alone', () => {
            expect(excludeType(StringType.instance, foo)).to.equal(StringType.instance);
        });
    });

    describe('type predicates', () => {
        it('parses and transpiles to a boolean return type', async () => {
            await testTranspile(`
                function isString(value) as value is string
                    return type(value) = "roString" or type(value) = "String"
                end function
            `, `
                function isString(value) as boolean
                    return type(value) = "roString" or type(value) = "String"
                end function
            `);
        });

        it('keeps the type predicate in typedefs', async () => {
            await testGetTypedef(`
                function isString(value) as value is string
                    return true
                end function
            `, `
                function isString(value) as value is string
                end function
            `);
        });

        it('adds the predicate to the function type', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                function isString(value) as value is string
                    return true
                end function
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const funcType = file.ast.findChildren<any>(() => true)[0].getType({ flags: SymbolTypeFlag.runtime }) as TypedFunctionType;
            expect(funcType.toString()).to.eql('function isString(value as dynamic) as value is string');
            expectTypeToBe(funcType.returnType, BooleanType);
            expect(funcType.typePredicate.parameterName).to.eql('value');
            expectTypeToBe(funcType.typePredicate.type, StringType);
            expect(funcType.getTypePredicateParameterIndex()).to.eql(0);
        });

        it('supports predicates in interface methods and function types', () => {
            program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                interface Checker
                    function check(value) as value is Foo
                end interface
                sub useChecker(checker as Checker, check as function(value) as value is Foo, value as string or Foo)
                    if checker.check(value)
                        print value.name
                    end if
                    if check(value)
                        print value.name
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('is not allowed in brs files', () => {
            program.setFile('source/main.brs', `
                function isString(value) as value is string
                    return true
                end function
            `);
            program.validate();
            expectDiagnosticsIncludes(program, [
                DiagnosticMessages.bsFeatureNotSupportedInBrsFiles('type predicates').message
            ]);
        });

        it('flags an unknown parameter name', () => {
            program.setFile('source/main.bs', `
                function isString(value) as other is string
                    return true
                end function
                interface Checker
                    function check(value) as other is string
                end interface
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typePredicateParameterNotFound('other').message,
                DiagnosticMessages.typePredicateParameterNotFound('other').message
            ]);
        });

        it('flags a predicate type that is not assignable to the parameter', () => {
            program.setFile('source/main.bs', `
                ${classes}
                function isFooString(value as string) as value is Foo
                    return true
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.typePredicateTypeNotAssignableToParameter('Foo', 'value', 'string').message
            ]);
        });

        it('requires the guard to return a boolean', () => {
            program.setFile('source/main.bs', `
                function isString(value) as value is string
                    return 1
                end function
            `);
            program.validate();
            expectDiagnostics(program, [
                DiagnosticMessages.returnTypeMismatch('integer', 'boolean').message
            ]);
        });

        it('allows a type guard where a boolean function is expected', () => {
            program.setFile('source/main.bs', `
                ${classes}
                sub check(callback as function(value) as boolean)
                end sub
                sub main()
                    check(isFoo)
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('does not allow a boolean function where a type guard is expected', () => {
            program.setFile('source/main.bs', `
                ${classes}
                sub check(callback as function(value) as value is Foo)
                end sub
                function isAnything(value) as boolean
                    return true
                end function
                sub main()
                    check(isBar)
                    check(isAnything)
                end sub
            `);
            program.validate();
            expect(program.getDiagnostics().map(x => x.code)).to.eql(['argument-type-mismatch', 'argument-type-mismatch']);
        });
    });

    describe('if statements', () => {
        it('narrows in the then and else branches', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    if isFoo(value)
                        print value
                    else
                        print value
                    end if
                    print value
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(getPrintedTypes(file)).to.eql(['Foo', 'string', 'string or Foo']);
        });

        it('narrows dynamic values', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value)
                    if isFoo(value)
                        print value
                    else
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo', 'dynamic']);
        });

        it('narrows to a subclass', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(pet as Animal)
                    if isDog(pet)
                        pet.bark()
                        print pet
                    else
                        print pet
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(getPrintedTypes(file)).to.eql(['Dog', 'Animal']);
        });

        it('narrows to never when every type is excluded', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as Foo)
                    if not isFoo(value)
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['never']);
        });

        it('narrows with not', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    if not isFoo(value)
                        print value
                    else
                        print value
                    end if
                    if not (not isFoo(value))
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['string', 'Foo', 'Foo']);
        });

        it('narrows several variables with and', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(a as string or Foo, b as string or Bar)
                    if isFoo(a) and isBar(b)
                        print a
                        print b
                    else
                        print a
                        print b
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo', 'Bar', 'string or Foo', 'string or Bar']);
        });

        it('narrows to either type with or', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo or Bar)
                    if isFoo(value) or isBar(value)
                        print value
                    else
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo or Bar', 'string']);
        });

        it('does not narrow with or when only one side is a type guard on the variable', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo, flag as boolean)
                    if isFoo(value) or flag
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['string or Foo']);
        });

        it('narrows in else if branches', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo or Bar)
                    if isFoo(value)
                        print value
                    else if isBar(value)
                        print value
                    else
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo', 'Bar', 'string']);
        });

        it('narrows in single line if statements', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    if isFoo(value) then print value else print value
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo', 'string']);
        });

        it('narrows in nested if statements', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo or Bar, flag as boolean)
                    if not isFoo(value)
                        if flag
                            if isBar(value)
                                print value
                            else
                                print value
                            end if
                        end if
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Bar', 'string']);
        });

        it('allows member access on the narrowed type', () => {
            program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    if isFoo(value)
                        print value.name
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
        });

        it('narrows on the right side of and/or', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    print isFoo(value) and value.name = "test"
                    print isFoo(value) or value = "test"
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            const prints = file.ast.findChildren<PrintStatement>(isPrintStatement, { walkMode: WalkMode.visitStatementsRecursive });
            const rightTypes = [
                (prints[0].expressions[0] as any).right.left.obj.getType({ flags: SymbolTypeFlag.runtime }).toString(),
                (prints[1].expressions[0] as any).right.left.getType({ flags: SymbolTypeFlag.runtime }).toString()
            ];
            expect(rightTypes).to.eql(['Foo', 'string']);
        });

        it('uses the guarded parameter, not the first argument', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                function isKind(kind as string, value) as value is Foo
                    return true
                end function
                sub main(kind as string, value as string or Foo)
                    if isKind(kind, value)
                        print value
                        print kind
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo', 'string']);
        });

        it('uses type guards from namespaces and other files', () => {
            program.setFile('source/guards.bs', `
                namespace guards
                    function isFoo(value) as value is Foo
                        return true
                    end function
                end namespace
            `);
            program.setFile('source/foo.bs', `
                class Foo
                    name as string
                end class
            `);
            const file = program.setFile<BrsFile>('source/main.bs', `
                sub main(value as string or Foo)
                    if guards.isFoo(value)
                        print value
                    end if
                end sub
            `);
            program.validate();
            expectZeroDiagnostics(program);
            expect(getPrintedTypes(file)).to.eql(['Foo']);
        });

        it('does not narrow for functions that are not type guards', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                function isAnything(value) as boolean
                    return true
                end function
                sub main(value as string or Foo)
                    if isAnything(value)
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['string or Foo']);
        });

        it('does not narrow after the variable is reassigned in the branch', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    if isFoo(value)
                        print value
                        value = 1
                        print value
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Foo', 'integer']);
        });

        it('does not narrow in a loop that reassigns the variable', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo, flag as boolean)
                    if isFoo(value)
                        while flag
                            print value
                            value = "text"
                        end while
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['string or Foo']);
        });

        it('keeps narrowing from inner conditions after a reassignment', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                function getValue() as string or Bar
                    return "text"
                end function
                sub main(value as string or Foo)
                    if isFoo(value)
                        value = getValue()
                        if isBar(value)
                            print value
                        end if
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['Bar']);
        });

        it('does not leak narrowed types through the type cache', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(value as string or Foo)
                    print value
                    if isFoo(value)
                        print value
                    end if
                    print value
                end sub
            `);
            program.validate();
            const prints = file.ast.findChildren<PrintStatement>(isPrintStatement, { walkMode: WalkMode.visitStatementsRecursive });
            //look up the types last to first, then first to last, so each lookup could hit a cached result from another position
            const typesLastToFirst = [...prints].reverse().map(print => print.expressions[0].getType({ flags: SymbolTypeFlag.runtime }).toString());
            expect(typesLastToFirst).to.eql(['string or Foo', 'Foo', 'string or Foo']);
            expect(getPrintedTypes(file)).to.eql(['string or Foo', 'Foo', 'string or Foo']);
        });

        it('does not narrow other variables', () => {
            const file = program.setFile<BrsFile>('source/main.bs', `
                ${classes}
                sub main(a as string or Foo, b as string or Foo)
                    if isFoo(a)
                        print b
                    end if
                end sub
            `);
            program.validate();
            expect(getPrintedTypes(file)).to.eql(['string or Foo']);
        });
    });
});
