import { expect } from 'chai';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { ObjectType } from './ObjectType';

describe('IntegerType', () => {
    it('is assignable to other proper types', () => {
        expect(new IntegerType().isAssignableTo(new IntegerType())).to.be.true;
        expect(new IntegerType().isAssignableTo(new DynamicType())).to.be.true;
        expect(new IntegerType().isAssignableTo(new ObjectType())).to.be.true;
    });
});
