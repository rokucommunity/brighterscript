import { expect } from '../chai-config.spec';

import { BooleanType } from './BooleanType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';

describe('BooleanType', () => {
    it('is equal to boolean type', () => {
        expect(new BooleanType().isEqual(new BooleanType())).to.be.true;
        expect(new BooleanType().isEqual(new DynamicType())).to.be.false;
    });

    it('is compatible with only correct types', () => {
        expect(new BooleanType().isTypeCompatible(new BooleanType())).to.be.true;
        expect(new BooleanType().isTypeCompatible(new DynamicType())).to.be.true;
        expect(new BooleanType().isTypeCompatible(IntegerType.instance)).to.be.false;
    });
});
