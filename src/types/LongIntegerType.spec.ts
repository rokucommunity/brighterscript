import { expect } from 'chai';
import { DynamicType } from './DynamicType';
import { LongIntegerType } from './LongIntegerType';
import { ObjectType } from './ObjectType';

describe('LongIntegerType', () => {
    it('is equivalent to other long integer types', () => {
        expect(new LongIntegerType().isAssignableTo(new LongIntegerType())).to.be.true;
        expect(new LongIntegerType().isAssignableTo(new DynamicType())).to.be.true;
        expect(new LongIntegerType().isAssignableTo(new ObjectType())).to.be.true;
    });
});
