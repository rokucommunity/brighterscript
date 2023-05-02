import { expect } from '../chai-config.spec';

import { BooleanType } from './BooleanType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';

describe('BooleanType', () => {
    it('is equivalent to boolean types', () => {
        expect(new BooleanType().isAssignableTo(new BooleanType())).to.be.true;
        expect(new BooleanType().isAssignableTo(new DynamicType())).to.be.true;
    });

    it('can be assigned to a Union that includes this type', () => {
        expect(BooleanType.instance.isAssignableTo(new UnionType([DoubleType.instance, StringType.instance, BooleanType.instance]))).to.be.true;
    });
});
