import { expect } from 'chai';

import { ArrayType } from './ArrayType';
import { DynamicType } from './DynamicType';
import { BooleanType } from './BooleanType';
import { StringType } from './StringType';
import { CustomType } from './CustomType';

describe('ArrayType', () => {
    it('is equivalent to array types', () => {
        expect(new ArrayType().isAssignableTo(new ArrayType())).to.be.true;
        expect(new ArrayType().isAssignableTo(new DynamicType())).to.be.true;
    });

    it('catches arrays containing different inner types', () => {
        expect(new ArrayType(new BooleanType()).isAssignableTo(new ArrayType(new BooleanType()))).to.be.true;
        expect(new ArrayType(new BooleanType()).isAssignableTo(new ArrayType(new StringType()))).to.be.false;
    });

    it('sets the innerTypes to unique types', () => {
        expect(new ArrayType(new BooleanType(), new BooleanType()).toString()).to.eql('Array<boolean>');
        expect(new ArrayType(new BooleanType(), new StringType(), new BooleanType()).toString()).to.eql('Array<boolean | string>');
    });

    it('sets the innerTypes to custom types', () => {
        expect(new ArrayType(new CustomType('MyKlass')).toString()).to.eql('Array<MyKlass>');
    });

    it('is not equivalent to other types', () => {
        expect(new ArrayType().isAssignableTo(new BooleanType())).to.be.false;
    });

    describe('isConveribleTo', () => {
        expect(new ArrayType().isConvertibleTo(new BooleanType())).to.be.false;
        expect(new ArrayType().isConvertibleTo(new ArrayType())).to.be.true;
    });

    describe('toString', () => {
        it('prints inner types', () => {
            expect(new ArrayType(new BooleanType(), new StringType()).toString()).to.eql('Array<boolean | string>');
        });
    });
});
