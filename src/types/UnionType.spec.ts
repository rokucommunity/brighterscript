import { expect } from 'chai';
import * as assert from 'assert';
import { ClassType } from './ClassType';
import { StringType } from './StringType';
import { expectTypeToBe } from '../testHelpers.spec';
import { isUnionType } from '../astUtils/reflection';
import { IntegerType } from './IntegerType';
import { UnionType, getUniqueType } from './UnionType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlags } from '../SymbolTable';
import { BooleanType } from './BooleanType';

describe('getUniqueType', () => {

    it('should return a single type if only one is given', () => {
        expectTypeToBe(getUniqueType([IntegerType.instance]), IntegerType);
    });


    it('should return a single type if all types are the same', () => {
        expectTypeToBe(getUniqueType([IntegerType.instance, IntegerType.instance, IntegerType.instance]), IntegerType);
    });


    it('should return dynamic if dynamic is included', () => {
        expectTypeToBe(getUniqueType([IntegerType.instance, DynamicType.instance, StringType.instance]), DynamicType);
    });

    it('should return the most general type of all types inputed', () => {
        const superKlassType = new ClassType('Super');
        const subKlassType = new ClassType('Sub', superKlassType);
        expect(getUniqueType([subKlassType, superKlassType]).toString()).to.eq('Super');
        expect(getUniqueType([subKlassType, subKlassType]).toString()).to.eq('Sub');
        expect(getUniqueType([superKlassType, subKlassType]).toString()).to.eq('Super');
        expect(getUniqueType([subKlassType, superKlassType, subKlassType]).toString()).to.eq('Super');
    });


    it('should return a union type of unique types', () => {
        const resultType = getUniqueType([IntegerType.instance, StringType.instance, IntegerType.instance, FloatType.instance]);
        expectTypeToBe(resultType, UnionType);
        if (isUnionType(resultType)) {
            expect(resultType.types.length).to.eq(3);
            expect(resultType.types).to.include(IntegerType.instance);
            expect(resultType.types).to.include(StringType.instance);
            expect(resultType.types).to.include(FloatType.instance);

        } else {
            assert.fail('Should be UnionType');
        }
    });
});

describe('UnionType', () => {
    it('can be assigned to by anything that can be assigned to an included type ', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('height', null, FloatType.instance, SymbolTypeFlags.runtime);

        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance]);

        expect(myUnion.canBeAssignedFrom(FloatType.instance)).to.be.true;
        expect(FloatType.instance.isAssignableTo(myUnion)).to.be.true;
        expect(myUnion.canBeAssignedFrom(StringType.instance)).to.be.true;
        expect(StringType.instance.isAssignableTo(myUnion)).to.be.true;
        expect(myUnion.canBeAssignedFrom(otheriFaceWithSameMembers)).to.be.true;
        expect(otheriFaceWithSameMembers.isAssignableTo(myUnion)).to.be.true;
    });

    it('can assign to a more general Union', () => {
        const myUnion = new UnionType([StringType.instance, FloatType.instance]);
        const otherUnion = new UnionType([FloatType.instance, StringType.instance, BooleanType.instance]);

        expect(myUnion.isAssignableTo(otherUnion)).to.be.true;
        expect(otherUnion.isAssignableTo(myUnion)).to.be.false;
    });

    it('can assign to a more general Union with interfaces', () => {
        const parentIFace = new InterfaceType('IfaceParent');
        parentIFace.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        const iFace = new InterfaceType('IfaceChild', parentIFace);
        iFace.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);
        iFace.addMember('height', null, FloatType.instance, SymbolTypeFlags.runtime);
        const myUnion = new UnionType([FloatType.instance, iFace, StringType.instance]);

        const otheriFaceWithSameMembers = new InterfaceType('OtherIface');
        otheriFaceWithSameMembers.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        otheriFaceWithSameMembers.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const otherUnion = new UnionType([FloatType.instance, otheriFaceWithSameMembers, StringType.instance, BooleanType.instance]);

        expect(myUnion.isAssignableTo(otherUnion)).to.be.true;
        expect(otherUnion.isAssignableTo(myUnion)).to.be.false;
    });

});
