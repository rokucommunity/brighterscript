import { expect } from '../chai-config.spec';

import { ArrayType } from './ArrayType';
import { DynamicType } from './DynamicType';
import { BooleanType } from './BooleanType';
import { StringType } from './StringType';

describe('ArrayType', () => {
    it('is equivalent to array types', () => {
        expect(new ArrayType().isTypeCompatible(new ArrayType())).to.be.true;
        expect(new ArrayType().isTypeCompatible(new DynamicType())).to.be.true;
    });

    it('catches arrays containing different inner types', () => {
        expect(new ArrayType(new BooleanType()).isTypeCompatible(new ArrayType(new BooleanType()))).to.be.true;
        expect(new ArrayType(new BooleanType()).isTypeCompatible(new ArrayType(new StringType()))).to.be.false;
    });

    it('is not equivalent to other types', () => {
        expect(new ArrayType().isEqual(new BooleanType())).to.be.false;
    });

    describe('isTypeCompatible', () => {
        expect(new ArrayType().isTypeCompatible(new BooleanType())).to.be.false;
        expect(new ArrayType().isTypeCompatible(new ArrayType())).to.be.true;
    });

    describe('toString', () => {
        it('prints inner types', () => {
            expect(new ArrayType(new BooleanType(), new StringType()).toString()).to.eql('Array<boolean | string>');
        });
    });
});
