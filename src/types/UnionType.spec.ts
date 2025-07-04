import { expect } from 'chai';
import { StringType } from './StringType';
import { IntegerType } from './IntegerType';
import { UnionType } from './UnionType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BooleanType } from './BooleanType';
import { expectTypeToBe } from '../testHelpers.spec';
import { isReferenceType, isTypePropertyReferenceType, isUnionType } from '../astUtils/reflection';
import { TypedFunctionType } from './TypedFunctionType';
import { SymbolTable } from '../SymbolTable';
import { ReferenceType } from './ReferenceType';
import { DoubleType } from './DoubleType';
import { LongIntegerType } from './LongIntegerType';
import { ObjectType } from './ObjectType';


describe('UnionType', () => {
    it('can be assigned to by anything that can be assigned to an included type', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        otheriFaceWithSameMembers.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance]);

        expect(myUnion.isTypeCompatible(FloatType.instance)).to.be.true;
        expect(myUnion.isTypeCompatible(StringType.instance)).to.be.true;
        expect(myUnion.isTypeCompatible(otheriFaceWithSameMembers)).to.be.true;
        expect(otheriFaceWithSameMembers.isTypeCompatible(myUnion)).to.be.false;
    });

    it('can assign to a more general Union', () => {
        const myUnion = new UnionType([StringType.instance, FloatType.instance]);
        const otherUnion = new UnionType([FloatType.instance, StringType.instance, BooleanType.instance]);

        expect(myUnion.isTypeCompatible(otherUnion)).to.be.false;
        expect(otherUnion.isTypeCompatible(myUnion)).to.be.true;
    });

    it('can assign to a more general Union with interfaces', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance, BooleanType.instance]);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        otheriFaceWithSameMembers.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

        const otherUnion = new UnionType([FloatType.instance, otheriFaceWithSameMembers, StringType.instance]);

        expect(myUnion.isTypeCompatible(otherUnion)).to.be.true;
        expect(otherUnion.isTypeCompatible(myUnion)).to.be.false;
    });

    it('will get a string representation in order given', () => {
        const iFace1 = new InterfaceType('SomeIface');
        iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
        iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
        iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
        const myUnion = new UnionType([FloatType.instance, StringType.instance, BooleanType.instance, iFace1]);

        expect(myUnion.toString()).to.eq('float or string or boolean or SomeIface');
    });

    describe('getMemberType', () => {
        it('will find the union of inner types', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('height', null, StringType.instance, SymbolTypeFlag.runtime);

            const myUnion = new UnionType([iFace1, iFace2]);

            const options = { flags: SymbolTypeFlag.runtime };
            const ageType = myUnion.getMemberType('age', options);
            expectTypeToBe(ageType, IntegerType);
            const nameType = myUnion.getMemberType('name', options);
            expectTypeToBe(nameType, StringType);
            const heightType = myUnion.getMemberType('height', options);
            expectTypeToBe(heightType, UnionType);
            const heightTypes = (heightType as UnionType).types;
            expect(heightTypes).to.include(FloatType.instance);
            expect(heightTypes).to.include(StringType.instance);
        });


        it('will return reference types if any inner type does not include the member', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);

            const myUnion = new UnionType([iFace1, iFace2]);
            const options = { flags: SymbolTypeFlag.runtime };
            const heightType1 = myUnion.getMemberType('height', options);
            expectTypeToBe(heightType1, UnionType);
            const heightTypes1 = (heightType1 as UnionType).types;
            expect(heightTypes1.length).to.eq(2);
            expectTypeToBe(heightTypes1[0], FloatType);
            // height does not exist in iFace2
            expect(isReferenceType(heightTypes1[1])).to.be.true;
            expect(heightTypes1[1].isResolvable()).to.be.false;

            iFace2.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
            const heightType2 = myUnion.getMemberType('height', options);
            expectTypeToBe(heightType2, FloatType);
        });
    });

    describe('getMemberTable', () => {
        it('get an intersection of all member types', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlag.runtime);
            iFace1.addMember('weight', null, FloatType.instance, SymbolTypeFlag.runtime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('height', null, StringType.instance, SymbolTypeFlag.runtime);
            iFace2.addMember('address', null, StringType.instance, SymbolTypeFlag.runtime);

            const myUnion = new UnionType([iFace1, iFace2]);

            const unionMemberTable = myUnion.getMemberTable();
            const options = { flags: SymbolTypeFlag.runtime };

            expectTypeToBe(unionMemberTable.getSymbolType('age', options), IntegerType);
            expectTypeToBe(unionMemberTable.getSymbolType('name', options), StringType);
            const heightType1 = unionMemberTable.getSymbolType('height', options);
            expectTypeToBe(heightType1, UnionType);
            const heightTypes1 = (heightType1 as UnionType).types;
            expect(heightTypes1.length).to.eq(2);
            expectTypeToBe(heightTypes1[0], FloatType);
            expect(unionMemberTable.getSymbolType('weight', options)).to.be.undefined;
            expect(unionMemberTable.getSymbolType('address', options)).to.be.undefined;

        });

    });

    describe('unions of functions', () => {
        it('gets union of return types', () => {
            const func1 = new TypedFunctionType(StringType.instance);
            const func2 = new TypedFunctionType(IntegerType.instance);
            const funcUnion = new UnionType([func1, func2]);
            const returnType = funcUnion.returnType as UnionType;
            expectTypeToBe(returnType, UnionType);
            expect(returnType.types).includes(StringType.instance);
            expect(returnType.types).includes(IntegerType.instance);
        });

        it('handles reference types that resolve to functions', () => {
            const table1 = new SymbolTable('test1');
            const table2 = new SymbolTable('test2');
            const func1Ref = new ReferenceType('func', 'iface1.func', SymbolTypeFlag.runtime, () => table1);
            const func2Ref = new ReferenceType('func', 'iface2.func', SymbolTypeFlag.runtime, () => table2);

            const funcUnion = new UnionType([func1Ref, func2Ref]);
            let returnType1 = funcUnion.returnType as UnionType;
            expect(isUnionType(returnType1)).to.be.true;
            expect(isTypePropertyReferenceType(returnType1.types[0])).to.be.true;
            expect(isTypePropertyReferenceType(returnType1.types[1])).to.be.true;
            const func1 = new TypedFunctionType(StringType.instance);
            const func2 = new TypedFunctionType(IntegerType.instance);
            table1.addSymbol('func', {}, func1, SymbolTypeFlag.runtime);
            table2.addSymbol('func', {}, func2, SymbolTypeFlag.runtime);

            let returnType = funcUnion.returnType;
            expectTypeToBe(returnType, UnionType);
            expect((returnType as UnionType).types).includes(StringType.instance);
            expect((returnType as UnionType).types).includes(IntegerType.instance);
        });
    });

    describe('toTypeString', () => {
        it('should give single type when unions of same type', () => {
            let ut = new UnionType([FloatType.instance, FloatType.instance]);
            expect(ut.toTypeString()).to.eq('float');
            ut = new UnionType([IntegerType.instance, IntegerType.instance, IntegerType.instance]);
            expect(ut.toTypeString()).to.eq('integer');
            ut = new UnionType([LongIntegerType.instance, LongIntegerType.instance]);
            expect(ut.toTypeString()).to.eq('longinteger');
            ut = new UnionType([DoubleType.instance, DoubleType.instance]);
            expect(ut.toTypeString()).to.eq('double');
        });

        it('should give dynamic if types are not the same', () => {
            let ut = new UnionType([FloatType.instance, IntegerType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([FloatType.instance, IntegerType.instance, DoubleType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([LongIntegerType.instance, IntegerType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([DoubleType.instance, LongIntegerType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
        });

        it('should reduce object types to object', () => {
            let ut = new UnionType([ObjectType.instance, ObjectType.instance]);
            expect(ut.toTypeString()).to.eq('object');
            ut = new UnionType([ObjectType.instance, ObjectType.instance, ObjectType.instance, ObjectType.instance]);
            expect(ut.toTypeString()).to.eq('object');
        });

        it('should reduce to dynamic if non-reducible', () => {
            let ut = new UnionType([FloatType.instance, StringType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([FloatType.instance, IntegerType.instance, ObjectType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([LongIntegerType.instance, new InterfaceType('test')]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([ObjectType.instance, ObjectType.instance, StringType.instance, ObjectType.instance]);
            expect(ut.toTypeString()).to.eq('dynamic');
            ut = new UnionType([ObjectType.instance, new InterfaceType('test')]);
            expect(ut.toTypeString()).to.eq('dynamic');
        });
    });
});
