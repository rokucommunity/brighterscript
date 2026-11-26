import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { ObjectType } from './ObjectType';

describe('ObjectType', () => {
    it('is equivalent to other object types', () => {
        expect(new ObjectType().isTypeCompatible(new ObjectType())).to.be.true;
        expect(new ObjectType().isTypeCompatible(new DynamicType())).to.be.true;
    });
});
