import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { StringType } from './StringType';

describe('StringType', () => {
    it('is equivalent to string types', () => {
        expect(new StringType().isTypeCompatible(new StringType())).to.be.true;
        expect(new StringType().isTypeCompatible(new DynamicType())).to.be.true;
    });
});
