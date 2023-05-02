import { expect } from '../chai-config.spec';

import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { StringType } from './StringType';
import { UnionType } from './UnionType';

describe('DoubleType', () => {
    it('is equivalent to double types', () => {
        expect(new DoubleType().isAssignableTo(new DoubleType())).to.be.true;
        expect(new DoubleType().isAssignableTo(new DynamicType())).to.be.true;
    });

    it('can be assigned to a Union that includes this type', () => {
        expect(DoubleType.instance.isAssignableTo(new UnionType([DoubleType.instance, StringType.instance]))).to.be.true;
    });
});
