import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { FunctionType } from './FunctionType';
import { IntegerType } from './IntegerType';
import { ObjectType } from './ObjectType';
import { roFunctionType } from './roFunctionType';
import { TypedFunctionType } from './TypedFunctionType';

describe('roFunctionType', () => {
    it('is equivalent to other function types', () => {
        const roFunc = new roFunctionType();

        expect(roFunc.isTypeCompatible(new ObjectType())).to.be.true;
        expect(roFunc.isTypeCompatible(new DynamicType())).to.be.true;
        expect(roFunc.isTypeCompatible(new FunctionType())).to.be.true;
        expect(roFunc.isTypeCompatible(new roFunctionType())).to.be.true;
        expect(roFunc.isTypeCompatible(new TypedFunctionType(IntegerType.instance))).to.be.true;
    });
});
