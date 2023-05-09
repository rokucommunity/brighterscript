import { expect } from 'chai';
import { StringType } from './StringType';
import { IntegerType } from './IntegerType';
import { UnionType } from './UnionType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlags } from '../SymbolTable';
import { BooleanType } from './BooleanType';
import { expectTypeToBe } from '../testHelpers.spec';


describe('UnionType', () => {
    it('can be assigned to by anything that can be assigned to an included type', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('height', null, FloatType.instance, SymbolTypeFlags.runtime);

        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance]);

        expect(myUnion.isTypeCompatible(FloatType.instance)).to.be.true;
        expect(myUnion.isTypeCompatible(StringType.instance)).to.be.true;
        expect(myUnion.isTypeCompatible(otheriFaceWithSameMembers)).to.be.false;
        expect(otheriFaceWithSameMembers.isTypeCompatible(myUnion)).to.be.true;
    });

    it('can assign to a more general Union', () => {
        const myUnion = new UnionType([StringType.instance, FloatType.instance]);
        const otherUnion = new UnionType([FloatType.instance, StringType.instance, BooleanType.instance]);

        expect(myUnion.isTypeCompatible(otherUnion)).to.be.false;
        expect(otherUnion.isTypeCompatible(myUnion)).to.be.true;
    });

    it('can assign to a more general Union with interfaces', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);
        iFace.addMember('height', null, FloatType.instance, SymbolTypeFlags.runtime);
        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance, BooleanType.instance]);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const otherUnion = new UnionType([FloatType.instance, otheriFaceWithSameMembers, StringType.instance]);

        expect(myUnion.isTypeCompatible(otherUnion)).to.be.true;
        expect(otherUnion.isTypeCompatible(myUnion)).to.be.false;
    });

    describe('getMemberTypes', () => {
        it('will find the union of inner types', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlags.typetime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlags.typetime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlags.typetime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlags.typetime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlags.typetime);
            iFace2.addMember('height', null, StringType.instance, SymbolTypeFlags.typetime);

            const myUnion = new UnionType([iFace1, iFace2]);

            const ageTypes = myUnion.getMemberTypes('age', SymbolTypeFlags.typetime);
            expect(ageTypes.length).to.be.eq(1);
            expectTypeToBe(ageTypes[0], IntegerType);
            const nameTypes = myUnion.getMemberTypes('name', SymbolTypeFlags.typetime);
            expect(nameTypes.length).to.be.eq(1);
            expectTypeToBe(nameTypes[0], StringType);
            const heightTypes = myUnion.getMemberTypes('height', SymbolTypeFlags.typetime);
            expect(heightTypes.length).to.be.eq(2);
            expect(heightTypes).to.include(FloatType.instance);
            expect(heightTypes).to.include(StringType.instance);
        });


        it('will return undefined if any inner type does not include the member', () => {
            const iFace1 = new InterfaceType('iFace1');
            iFace1.addMember('age', null, IntegerType.instance, SymbolTypeFlags.typetime);
            iFace1.addMember('name', null, StringType.instance, SymbolTypeFlags.typetime);
            iFace1.addMember('height', null, FloatType.instance, SymbolTypeFlags.typetime);

            const iFace2 = new InterfaceType('iFace2');
            iFace2.addMember('age', null, IntegerType.instance, SymbolTypeFlags.typetime);
            iFace2.addMember('name', null, StringType.instance, SymbolTypeFlags.typetime);

            const myUnion = new UnionType([iFace1, iFace2]);
            const heightTypes1 = myUnion.getMemberTypes('height', SymbolTypeFlags.typetime);
            // height does not exist in iFace2
            expect(heightTypes1).to.be.undefined;

            iFace2.addMember('height', null, FloatType.instance, SymbolTypeFlags.typetime);
            const heightTypes2 = myUnion.getMemberTypes('height', SymbolTypeFlags.typetime);
            // now height does exist in iFace2
            expect(heightTypes2).to.exist;
            expect(heightTypes2.length).to.eq(1);
            expectTypeToBe(heightTypes2[0], FloatType);
        });
    });

});
