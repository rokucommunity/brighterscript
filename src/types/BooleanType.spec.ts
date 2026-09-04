import { expect } from '../chai-config.spec';

import { BooleanType } from './BooleanType';
import { DynamicType } from './DynamicType';

describe('BooleanType', () => {
    it('is equivalent to boolean types', () => {
        expect(new BooleanType().isAssignableTo(new BooleanType())).to.be.true;
        expect(new BooleanType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
