import { expect } from 'chai';

import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';

describe('DoubleType', () => {
    it('is equivalent to double types', () => {
        expect(new DoubleType().isAssignableTo(new DoubleType())).to.be.true;
        expect(new DoubleType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
