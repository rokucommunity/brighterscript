import { expect } from '../chai-config.spec';
import { BooleanType } from './BooleanType';

import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';

describe('DoubleType', () => {

    it('is equal to double type', () => {
        expect(new DoubleType().isEqual(new DoubleType())).to.be.true;
        expect(new DoubleType().isEqual(new DynamicType())).to.be.false;
    });

    it('is compatible with only correct types', () => {
        expect(new DoubleType().isTypeCompatible(new DoubleType())).to.be.true;
        expect(new DoubleType().isTypeCompatible(new DynamicType())).to.be.true;
        expect(new DoubleType().isTypeCompatible(IntegerType.instance)).to.be.true;
        expect(new DoubleType().isTypeCompatible(BooleanType.instance)).to.be.false;
    });
});
