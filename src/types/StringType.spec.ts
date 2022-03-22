import { expect } from 'chai';

import { DynamicType } from './DynamicType';
import { ObjectType } from './ObjectType';
import { StringType } from './StringType';

describe('StringType', () => {
    it('is equivalent to string types', () => {
        expect(new StringType().isAssignableTo(new StringType())).to.be.true;
        expect(new StringType().isAssignableTo(new DynamicType())).to.be.true;
        expect(new StringType().isAssignableTo(new ObjectType())).to.be.true;
    });
});
