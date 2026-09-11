import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { LongIntegerType } from './LongIntegerType';

describe('LongIntegerType', () => {
    it('is equal to other longinteger types', () => {
        expect(new LongIntegerType().isEqual(new LongIntegerType())).to.be.true;
        expect(new LongIntegerType().isEqual(new DynamicType())).to.be.false;
    });

    it('is compatible with to other integer types', () => {
        expect(new LongIntegerType().isTypeCompatible(new LongIntegerType())).to.be.true;
        expect(new LongIntegerType().isTypeCompatible(new FloatType())).to.be.true;
        expect(new LongIntegerType().isTypeCompatible(new DynamicType())).to.be.true;
    });

});
