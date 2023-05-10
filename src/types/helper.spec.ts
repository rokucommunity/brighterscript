import { expect, assert } from 'chai';
import { isUnionType } from '../astUtils/reflection';
import { expectTypeToBe } from '../testHelpers.spec';
import { ClassType } from './ClassType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';
import { getUniqueType } from './helpers';

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
