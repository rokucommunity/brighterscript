import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';

describe('IntegerType', () => {
    it('is equivalent to other integer types', () => {
        expect(new IntegerType().isAssignableTo(new IntegerType())).to.be.true;
        expect(new IntegerType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
