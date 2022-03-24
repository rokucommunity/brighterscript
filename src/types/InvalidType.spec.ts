import { expect } from 'chai';
import { DynamicType } from './DynamicType';
import { InvalidType } from './InvalidType';
import { ObjectType } from './ObjectType';

describe('InvalidType', () => {
    it('is equivalent to invalid types', () => {
        expect(new InvalidType().isAssignableTo(new InvalidType())).to.be.true;
        expect(new InvalidType().isAssignableTo(new DynamicType())).to.be.true;
        expect(new InvalidType().isAssignableTo(new ObjectType())).to.be.true;
    });
});
