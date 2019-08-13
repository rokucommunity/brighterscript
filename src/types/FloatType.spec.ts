import { expect } from 'chai';

import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';

describe('FloatType', () => {
    it('is equivalent to double types', () => {
        expect(new FloatType().isAssignableTo(new FloatType())).to.be.true;
        expect(new FloatType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
