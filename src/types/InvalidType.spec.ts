import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { InvalidType } from './InvalidType';

describe('InvalidType', () => {
    it('is compatible to invalid types', () => {
        expect(new InvalidType().isTypeCompatible(new InvalidType())).to.be.true;
        expect(new InvalidType().isTypeCompatible(new DynamicType())).to.be.true;
    });

    it('is equal to invalid types', () => {
        expect(new InvalidType().isEqual(new InvalidType())).to.be.true;
        expect(new InvalidType().isEqual(new DynamicType())).to.be.false;
    });
});
