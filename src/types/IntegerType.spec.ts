import { expect } from '../chai-config.spec';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';

describe('IntegerType', () => {
    it('is equal to other integer types', () => {
        expect(new IntegerType().isEqual(new IntegerType())).to.be.true;
        expect(new IntegerType().isEqual(new DynamicType())).to.be.false;
    });

    it('is compatible with to other integer types', () => {
        expect(new IntegerType().isTypeCompatible(new IntegerType())).to.be.true;
        expect(new IntegerType().isTypeCompatible(new DynamicType())).to.be.true;
    });


});
