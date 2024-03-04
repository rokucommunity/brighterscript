import { expect } from 'chai';
import { StringType } from './StringType';
import { IntegerType } from './IntegerType';
import { UnionType } from './UnionType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BooleanType } from './BooleanType';
import { expectTypeToBe } from '../testHelpers.spec';
import { isReferenceType } from '../astUtils/reflection';


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
});
