import { expect } from '../chai-config.spec';
import { BooleanType } from './BooleanType';
import { ClassType } from './ClassType';
import { DoubleType } from './DoubleType';

import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';

describe('DynamicType', () => {
    it('is equal to dynamic type', () => {
        expect(new DynamicType().isEqual(new DynamicType())).to.be.true;
        expect(new DynamicType().isEqual(new DoubleType())).to.be.false;
        expect(new DynamicType().isEqual(new ClassType('test'))).to.be.false;
    });

    it('is compatible with only all types', () => {
        expect(new DynamicType().isTypeCompatible(new DoubleType())).to.be.true;
        expect(new DynamicType().isTypeCompatible(new DynamicType())).to.be.true;
        expect(new DynamicType().isTypeCompatible(IntegerType.instance)).to.be.true;
        expect(new DynamicType().isTypeCompatible(BooleanType.instance)).to.be.true;
        expect(new DynamicType().isTypeCompatible(new ClassType('test'))).to.be.true;
    });
});
