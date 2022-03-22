import { expect } from 'chai';
import { BooleanType } from './BooleanType';
import { DynamicType } from './DynamicType';
import { ObjectType } from './ObjectType';

describe('BooleanType', () => {
    it('is assignable to various types', () => {
        expect(new BooleanType().isAssignableTo(new BooleanType())).to.be.true;
        expect(new BooleanType().isAssignableTo(new DynamicType())).to.be.true;
        expect(new BooleanType().isAssignableTo(new ObjectType())).to.be.true;
    });
});
