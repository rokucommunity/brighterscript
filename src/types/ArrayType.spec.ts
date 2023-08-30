import { expect } from '../chai-config.spec';

import { ArrayType } from './ArrayType';
import { DynamicType } from './DynamicType';
import { BooleanType } from './BooleanType';
import { StringType } from './StringType';
import { SymbolTypeFlag } from '../SymbolTable';
import { TypedFunctionType } from './TypedFunctionType';
import { expectTypeToBe } from '../testHelpers.spec';
import { IntegerType } from './IntegerType';

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

    describe('built in interfaces', () => {
        it('adds built in interfaces', () => {
            const myArray = new ArrayType();
            expectTypeToBe(myArray.getMemberType('push', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
            expectTypeToBe(myArray.getMemberType('sort', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
            expectTypeToBe(myArray.getMemberType('next', { flags: SymbolTypeFlag.runtime }), TypedFunctionType);
        });

        it('correctly sets types for typed array', () => {
            const myArray = new ArrayType(IntegerType.instance);
            const popType = myArray.getMemberType('pop', { flags: SymbolTypeFlag.runtime }) as TypedFunctionType;
            expectTypeToBe(popType.returnType, IntegerType);
            const pushType = myArray.getMemberType('push', { flags: SymbolTypeFlag.runtime }) as TypedFunctionType;
            expectTypeToBe(pushType.params[0].type, IntegerType);
        });
    });
});
