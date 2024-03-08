import { expect } from 'chai';
import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { expectTypeToBe } from '../testHelpers.spec';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { TypePropertyReferenceType, ReferenceType, BinaryOperatorReferenceType } from './ReferenceType';
import { StringType } from './StringType';
import { FloatType } from './FloatType';
import { ClassType } from './ClassType';
import { isTypePropertyReferenceType, isReferenceType } from '../astUtils/reflection';
import { TypedFunctionType } from './TypedFunctionType';
import { NamespaceType } from './NamespaceType';
import { createToken } from '../astUtils/creators';
import { TokenKind } from '../lexer/TokenKind';
import { util } from '../util';

const runtimeFlag = SymbolTypeFlag.runtime;

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
        table.addSymbol('someVar', null, StringType.instance, SymbolTypeFlag.runtime);
        expectTypeToBe(new ReferenceType('test', 'test', runtimeFlag, () => table), DynamicType);
    });

    it('can resolve based on a symbol table', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
        table.addSymbol('someVar', null, StringType.instance, SymbolTypeFlag.runtime);
        expectTypeToBe(ref, StringType);
    });

    it('resolves before checking assigning and convertible', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
        table.addSymbol('someVar', null, IntegerType.instance, SymbolTypeFlag.runtime);
        expect(ref.isTypeCompatible(FloatType.instance)).to.be.true;
    });

    it('resolves before stringifying', () => {
        const table = new SymbolTable('test');
        const ref = new ReferenceType('someKlass', 'someKlass', runtimeFlag, () => table);
        table.addSymbol('someKlass', null, new ClassType('SomeKlass'), SymbolTypeFlag.runtime);
        expect(ref.toString()).to.eq('SomeKlass');
    });

    describe('circular references', () => {
        it('catches circular references', () => {
            const table = new SymbolTable('test');
            const ref = new ReferenceType('someVar', 'someVar', runtimeFlag, () => table);
            table.addSymbol('someVar', null, ref, SymbolTypeFlag.runtime);
            expectTypeToBe(ref, DynamicType);
        });


        it('catches circular references of many levels', () => {
            const table = new SymbolTable('test');
            const ref1 = new ReferenceType('someVar1', 'someVar1', runtimeFlag, () => table);
            const ref2 = new ReferenceType('someVar2', 'someVar2', runtimeFlag, () => table);
            const ref3 = new ReferenceType('someVar3', 'someVar3', runtimeFlag, () => table);
            table.addSymbol('someVar0', null, ref1, SymbolTypeFlag.runtime);
            table.addSymbol('someVar1', null, ref2, SymbolTypeFlag.runtime);
            table.addSymbol('someVar2', null, ref3, SymbolTypeFlag.runtime);
            table.addSymbol('someVar3', null, ref1, SymbolTypeFlag.runtime);
            expectTypeToBe(table.getSymbol('someVar0', SymbolTypeFlag.runtime)[0].type, DynamicType);
        });

        it('catches circular references in a binary expression', () => {
            const table = new SymbolTable('test');
            const ref = new ReferenceType('notHere', 'notHere', runtimeFlag, () => table);
            const binRef = new BinaryOperatorReferenceType(ref, createToken(TokenKind.Plus), StringType.instance, (l, o, r) => {
                return util.binaryOperatorResultType(l, o, r);
            });
            const binRef2 = new BinaryOperatorReferenceType(ref, createToken(TokenKind.Plus), binRef, (l, o, r) => {
                return util.binaryOperatorResultType(l, o, r);
            });
            table.addSymbol('notHere', null, binRef2, SymbolTypeFlag.runtime);
            expectTypeToBe(table.getSymbolType('notHere', { flags: SymbolTypeFlag.runtime }), DynamicType);
        });
    });

});

describe('PropertyReferenceType', () => {

    it('can be checked with reflection', () => {
        const func = new TypedFunctionType(StringType.instance);
        const propRef = new TypePropertyReferenceType(func, 'returnType');
        expect(isTypePropertyReferenceType(propRef)).to.be.true;
    });

    it('can resolve a FunctionType.returnType', () => {
        const func = new TypedFunctionType(StringType.instance);
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
        table.addSymbol('someFunc', null, new TypedFunctionType(IntegerType.instance), SymbolTypeFlag.runtime);
        expectTypeToBe(propRef, IntegerType);
    });

    it('resolves members of a property on a ReferenceType', () => {
        const table = new SymbolTable('test');
        const fnRef = new ReferenceType('someFunc', 'someFunc', runtimeFlag, () => table);
        const returnRef = new TypePropertyReferenceType(fnRef, 'returnType');
        const returnPropRef = returnRef.getMemberType('myNum', { flags: SymbolTypeFlag.runtime });
        // `ref` will resolve to DynamicType, and its returnType is DynamicType.Instance
        expectTypeToBe(returnPropRef, DynamicType);

        // Set fnRef to resolve to a function that returns a complex type
        const klassType = new ClassType('Klass');
        klassType.addMember('myNum', null, IntegerType.instance, SymbolTypeFlag.runtime);
        table.addSymbol('someFunc', null, new TypedFunctionType(klassType), SymbolTypeFlag.runtime);

        // returnPropRef = someFunc().myNum
        expectTypeToBe(fnRef, TypedFunctionType);
        expectTypeToBe(returnRef, ClassType);
        expectTypeToBe(returnPropRef, IntegerType);
    });


    describe('toString', () => {

        it('returns the full name, if resolvable or not', () => {
            let nsA = new NamespaceType('Alpha');
            let nsAB = new NamespaceType('Alpha.Beta');
            let nsABC = new NamespaceType('Alpha.Beta.Charlie');
            nsA.addMember('Beta', null, nsAB, SymbolTypeFlag.typetime);
            nsAB.addMember('Charlie', null, nsABC, SymbolTypeFlag.typetime);

            let myRef = new ReferenceType('MyKlass', 'Alpha.Beta.Charlie.MyKlass', SymbolTypeFlag.typetime, () => nsABC.memberTable);
            expect(myRef.isResolvable()).to.be.false;

            expect(myRef.toString()).to.eq('Alpha.Beta.Charlie.MyKlass');
            let myKlass = new ClassType('Alpha.Beta.Charlie.MyKlass');
            nsABC.addMember('MyKlass', null, myKlass, SymbolTypeFlag.typetime);
            expect(myRef.isResolvable()).to.be.true;
            expect(myRef.toString()).to.eq('Alpha.Beta.Charlie.MyKlass');
        });

    });

});
