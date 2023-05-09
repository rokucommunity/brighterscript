import { expect, assert } from 'chai';
import { isUnionType } from '../astUtils/reflection';
import { expectTypeToBe } from '../testHelpers.spec';
import { ClassType } from './ClassType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';
import { findTypeIntersection, findTypeUnion, getUniqueType, getUniqueTypesFromArray } from './helpers';
import { InterfaceType } from './InterfaceType';
import { SymbolTypeFlags } from '../SymbolTable';
import { DoubleType } from './DoubleType';
import { BooleanType } from './BooleanType';


describe('findTypeIntersection', () => {

    it('should return the intersection if the arrays have one element', () => {
        const intersection = findTypeIntersection([IntegerType.instance], [IntegerType.instance]);
        expect(intersection.length).to.eq(1);
        expect(intersection).to.include(IntegerType.instance);
    });

    it('should return empty array if no common types', () => {
        let intersection = findTypeIntersection([IntegerType.instance], [StringType.instance]);
        expect(intersection.length).to.eq(0);
        intersection = findTypeIntersection([IntegerType.instance, DoubleType.instance], [FloatType.instance, StringType.instance]);
        expect(intersection.length).to.eq(0);
    });

    it('should return minimum intersection', () => {
        let intersection = findTypeIntersection([DoubleType.instance, IntegerType.instance, BooleanType.instance], [BooleanType.instance, FloatType.instance, IntegerType.instance, StringType.instance]);
        expect(intersection.length).to.eq(2);
        expect(intersection).to.include(IntegerType.instance);
        expect(intersection).to.include(BooleanType.instance);
    });
});


describe('findTypeUnion', () => {

    it('should return the intersection if the arrays have one element', () => {
        const union = findTypeUnion([IntegerType.instance], [IntegerType.instance]);
        expect(union.length).to.eq(1);
        expect(union).to.include(IntegerType.instance);
    });

    it('should not have duplicates', () => {
        let union = findTypeUnion([IntegerType.instance, StringType.instance], [StringType.instance, IntegerType.instance, FloatType.instance]);
        expect(union.length).to.eq(3);
    });

    it('should return array of all types', () => {
        let union = findTypeUnion([IntegerType.instance], [StringType.instance]);
        expect(union.length).to.eq(2);
        union = findTypeUnion([IntegerType.instance, DoubleType.instance], [FloatType.instance, StringType.instance]);
        expect(union.length).to.eq(4);
    });
});


describe('getUniqueTypesFromArray', () => {

    it('should return the single type from arrays have one element', () => {
        let intersection = getUniqueTypesFromArray([IntegerType.instance]);
        expect(intersection.length).to.eq(1);
        expect(intersection).to.include(IntegerType.instance);
        getUniqueTypesFromArray([IntegerType.instance, IntegerType.instance, IntegerType.instance, IntegerType.instance]);
        expect(intersection.length).to.eq(1);
        expect(intersection).to.include(IntegerType.instance);
    });

    it('should return an array with ni duplicates', () => {
        let intersection = getUniqueTypesFromArray([IntegerType.instance, StringType.instance, IntegerType.instance, StringType.instance, IntegerType.instance, StringType.instance]);
        expect(intersection.length).to.eq(2);
        expect(intersection).to.include(IntegerType.instance);
        expect(intersection).to.include(StringType.instance);
    });

    it('should not worry about inheritance ', () => {
        let klass = new ClassType('Klass');
        let subklass = new ClassType('Subklass', klass);
        let intersection = getUniqueTypesFromArray([klass, subklass, subklass, klass, klass]);
        expect(intersection.length).to.eq(2);
        expect(intersection).to.include(klass);
        expect(intersection).to.include(subklass);
    });
});


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

    it('should return a a union type of two compatible interfaces', () => {
        const iface1 = new InterfaceType('iface1');
        iface1.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        iface1.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        const iface2 = new InterfaceType('iface2');
        iface2.addMember('name', null, StringType.instance, SymbolTypeFlags.runtime);
        iface2.addMember('age', null, IntegerType.instance, SymbolTypeFlags.runtime);

        expect(iface1.isTypeCompatible(iface2)).to.be.true;
        expect(iface2.isTypeCompatible(iface1)).to.be.true;
        expect(iface1.isEqual(iface2)).to.be.false;

        const resultType = getUniqueType([iface1, iface2]);
        expectTypeToBe(resultType, UnionType);
        if (isUnionType(resultType)) {
            expect(resultType.types.length).to.eq(2);
            expect(resultType.types).to.include(iface1);
            expect(resultType.types).to.include(iface2);

        } else {
            assert.fail('Should be UnionType');
        }
    });
});
