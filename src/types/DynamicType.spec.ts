import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { StringType } from './StringType';

describe('DynamicType', () => {
    it('is equivalent to dynamic types', () => {
        expect(new DynamicType().isAssignableTo(new StringType())).to.be.true;
        expect(new DynamicType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
