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
        const boolArray = new ArrayType(new BooleanType(), new BooleanType());
        expect(boolArray.innerTypes.length).to.eql(1);
        expect(boolArray.innerTypes[0].equals(new BooleanType())).to.be.true;
        expect(boolArray.toJsString()).to.eql('Array<boolean>');

        const multiTypeArray = new ArrayType(new BooleanType(), new StringType(), new BooleanType());
        expect(multiTypeArray.innerTypes.length).to.eql(2);
        expect(multiTypeArray.innerTypes[0].equals(new BooleanType())).to.be.true;
        expect(multiTypeArray.innerTypes[1].equals(new StringType())).to.be.true;
        expect(multiTypeArray.toJsString()).to.eql('Array<boolean | string>');
    });

    it('sets the innerTypes to custom types', () => {
        expect(new ArrayType(new CustomType('MyKlass')).toString()).to.eql('MyKlass[]');
    });

    it('is not equivalent to other types', () => {
        expect(new ArrayType().isAssignableTo(new BooleanType())).to.be.false;
    });

    describe('isConveribleTo', () => {
        expect(new ArrayType().isConvertibleTo(new BooleanType())).to.be.false;
        expect(new ArrayType().isConvertibleTo(new ArrayType())).to.be.true;
    });

    describe('toString', () => {
        it('returns the default type', () => {
            expect(new ArrayType(new BooleanType()).toString()).to.eql('boolean[]');
            expect(new ArrayType(new StringType()).toString()).to.eql('string[]');
            expect(new ArrayType(new CustomType('MyKlass')).toString()).to.eql('MyKlass[]');
        });

        it('returns dynamic if more than one type is assigned', () => {
            expect(new ArrayType(new BooleanType(), new StringType()).toString()).to.eql('dynamic[]');
        });
    });
});
