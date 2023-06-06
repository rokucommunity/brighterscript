import { expect } from 'chai';
import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlags } from '../SymbolTable';
import { expectTypeToBe } from '../testHelpers.spec';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { TypePropertyReferenceType, ReferenceType } from './ReferenceType';
import { StringType } from './StringType';
import { FloatType } from './FloatType';
import { ClassType } from './ClassType';
import { isTypePropertyReferenceType, isReferenceType } from '../astUtils/reflection';
import { FunctionType } from './FunctionType';
import { NamespaceType } from './NameSpaceType';

const runtimeFlag = SymbolTypeFlags.runtime;

describe('ReferenceType', () => {
    it('can be checked with reflection', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
        expect(isReferenceType(ref)).to.be.true;
    });


    it('defaults to dynamic type if it can not resolve', () => {
        expectTypeToBe(new ReferenceType('test', 'test', runtimeFlag, () => undefined), DynamicType);
        const table = new SymbolTable('testTable');
        expectTypeToBe(new ReferenceType('test', 'test', runtimeFlag, () => table), DynamicType);
        table.addSymbol('someVar', null, StringType.instance, SymbolTypeFlags.runtime);
        expectTypeToBe(new ReferenceType('test', 'test', runtimeFlag, () => table), DynamicType);
    });

    it('can resolve based on a symbol table', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
        table.addSymbol('someVar', null, StringType.instance, SymbolTypeFlags.runtime);
        expectTypeToBe(ref, StringType);
    });

    it('resolves before checking assigning and convertible', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
        table.addSymbol('someVar', null, IntegerType.instance, SymbolTypeFlags.runtime);
        expect(ref.isTypeCompatible(FloatType.instance)).to.be.true;
    });

    it('resolves before stringifying', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someKlass', 'someKlass', runtimeFlag, () => table);
        table.addSymbol('someKlass', null, new ClassType('SomeKlass'), SymbolTypeFlags.runtime);
        expect(ref.toString()).to.eq('SomeKlass');
    });

    describe('circular references', () => {
        it('catches circular references', () => {
            const table = new SymbolTable('test');
            const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
            table.addSymbol('someVar', null, ref, SymbolTypeFlags.runtime);
            expectTypeToBe(ref, DynamicType);
        });


        it('catches circular references of many levels', () => {
            const table = new SymbolTable('test');
            const ref1 = new ReferenceType('someVar1', 'someVar1', runtimeFlag, () => table);
            const ref2 = new ReferenceType('someVar2', 'someVar2', runtimeFlag, () => table);
            const ref3 = new ReferenceType('someVar3', 'someVar3', runtimeFlag, () => table);
            table.addSymbol('someVar0', null, ref1, SymbolTypeFlags.runtime);
            table.addSymbol('someVar1', null, ref2, SymbolTypeFlags.runtime);
            table.addSymbol('someVar2', null, ref3, SymbolTypeFlags.runtime);
            table.addSymbol('someVar3', null, ref1, SymbolTypeFlags.runtime);
            expectTypeToBe(table.getSymbol('someVar0', SymbolTypeFlags.runtime)[0].type, DynamicType);
        });
    });

});

describe('PropertyReferenceType', () => {

    it('can be checked with reflection', () => {
        const func = new FunctionType(StringType.instance);
        const propRef = new TypePropertyReferenceType(func, 'returnType');
        expect(isTypePropertyReferenceType(propRef)).to.be.true;
    });

    it('can resolve a FunctionType.returnType', () => {
        const func = new FunctionType(StringType.instance);
        const propRef = new TypePropertyReferenceType(func, 'returnType');
        expectTypeToBe(propRef, StringType);
    });


    it('can resolve a property on a ReferenceType', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someFunc', 'someFunc', runtimeFlag, () => table);
        const propRef = new TypePropertyReferenceType(ref, 'returnType');
        // `ref` will resolve to DynamicType, and its returnType is DynamicType.Instance
        expectTypeToBe(propRef, DynamicType);
        // Set ref to resolve to a function
        table.addSymbol('someFunc', null, new FunctionType(IntegerType.instance), SymbolTypeFlags.runtime);
        expectTypeToBe(propRef, IntegerType);
    });

    it('resolves members of a property on a ReferenceType', () => {
        const table = new SymbolTable('test');
        const fnRef = new ReferenceType('someFunc', 'someFunc', runtimeFlag, () => table);
        const returnRef = new TypePropertyReferenceType(fnRef, 'returnType');
        const returnPropRef = returnRef.getMemberType('myNum', { flags: SymbolTypeFlags.runtime });
        // `ref` will resolve to DynamicType, and its returnType is DynamicType.Instance
        expectTypeToBe(returnPropRef, DynamicType);

        // Set fnRef to resolve to a function that returns a complex type
        const klassType = new ClassType('Klass');
        klassType.addMember('myNum', null, IntegerType.instance, SymbolTypeFlags.runtime);
        table.addSymbol('someFunc', null, new FunctionType(klassType), SymbolTypeFlags.runtime);

        // returnPropRef = someFunc().myNum
        expectTypeToBe(fnRef, FunctionType);
        expectTypeToBe(returnRef, ClassType);
        expectTypeToBe(returnPropRef, IntegerType);
    });


    describe('toString', () => {

        it('returns the full name, if resolvable or not', () => {
            let nsA = new NamespaceType('Alpha');
            let nsAB = new NamespaceType('Alpha.Beta');
            let nsABC = new NamespaceType('Alpha.Beta.Charlie');
            nsA.addMember('Beta', null, nsAB, SymbolTypeFlags.typetime);
            nsAB.addMember('Charlie', null, nsABC, SymbolTypeFlags.typetime);

            let myRef = new ReferenceType('MyKlass', 'Alpha.Beta.Charlie.MyKlass', SymbolTypeFlags.typetime, () => nsABC.memberTable);
            expect(myRef.isResolvable()).to.be.false;

            expect(myRef.toString()).to.eq('Alpha.Beta.Charlie.MyKlass');
            let myKlass = new ClassType('Alpha.Beta.Charlie.MyKlass');
            nsABC.addMember('MyKlass', null, myKlass, SymbolTypeFlags.typetime);
            expect(myRef.isResolvable()).to.be.true;
            expect(myRef.toString()).to.eq('Alpha.Beta.Charlie.MyKlass');
        });

    });

});
