import { expect } from '../chai-config.spec';
import { BooleanType } from './BooleanType';
import { DoubleType } from './DoubleType';

import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';

describe('IntegerType', () => {
    it('is equivalent to other integer types', () => {
        expect(new IntegerType().isAssignableTo(new IntegerType())).to.be.true;
        expect(new IntegerType().isAssignableTo(new DynamicType())).to.be.true;
    });

    it('can be assigned to a Union that includes this type', () => {
        expect(IntegerType.instance.isAssignableTo(new UnionType([BooleanType.instance, IntegerType.instance, DoubleType.instance, StringType.instance]))).to.be.true;
    });
});
