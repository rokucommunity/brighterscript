import { expect } from 'chai';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { ObjectType } from './ObjectType';

describe('DoubleType', () => {
    it('is assignable to correct types', () => {
        expect(new DoubleType().isAssignableTo(new DoubleType())).to.be.true;
        expect(new DoubleType().isAssignableTo(new DynamicType())).to.be.true;
        expect(new DoubleType().isAssignableTo(new ObjectType())).to.be.true;
    });
});
