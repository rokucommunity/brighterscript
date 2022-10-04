import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { InvalidType } from './InvalidType';

describe('InvalidType', () => {
    it('is equivalent to invalid types', () => {
        expect(new InvalidType().isAssignableTo(new InvalidType())).to.be.true;
        expect(new InvalidType().isAssignableTo(new DynamicType())).to.be.true;
    });
});
