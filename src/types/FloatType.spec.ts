import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';

describe('FloatType', () => {
    it('is compatible to double types', () => {
        expect(new FloatType().isTypeCompatible(new FloatType())).to.be.true;
        expect(new FloatType().isTypeCompatible(new DynamicType())).to.be.true;
    });
});
