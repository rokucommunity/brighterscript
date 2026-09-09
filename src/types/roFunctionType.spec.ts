import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { FunctionType } from './FunctionType';
import { IntegerType } from './IntegerType';
import { ObjectType } from './ObjectType';
import { roFunctionType } from './roFunctionType';
import { StringType } from './StringType';
import { TypedFunctionType } from './TypedFunctionType';
import { UnionType } from './UnionType';

describe('roFunctionType', () => {
    it('is equivalent to other function types', () => {
        const roFunc = new roFunctionType();

        expect(roFunc.isTypeCompatible(new ObjectType())).to.be.true;
        expect(roFunc.isTypeCompatible(new DynamicType())).to.be.true;
        expect(roFunc.isTypeCompatible(new FunctionType())).to.be.true;
        expect(roFunc.isTypeCompatible(new roFunctionType())).to.be.true;
        expect(roFunc.isTypeCompatible(new TypedFunctionType(IntegerType.instance))).to.be.true;
    });

    it('is not compatible with non-function types', () => {
        const roFunc = new roFunctionType();

        expect(roFunc.isTypeCompatible(StringType.instance)).to.be.false;
        expect(roFunc.isTypeCompatible(IntegerType.instance)).to.be.false;
    });

    it('is compatible with a union of function types', () => {
        const roFunc = new roFunctionType();

        expect(
            roFunc.isTypeCompatible(new UnionType([new FunctionType(), new roFunctionType()]))
        ).to.be.true;
        expect(
            roFunc.isTypeCompatible(new UnionType([new FunctionType(), StringType.instance]))
        ).to.be.false;
    });

    it('is equal to other function-like types', () => {
        const roFunc = new roFunctionType();

        expect(roFunc.isEqual(new roFunctionType())).to.be.true;
        expect(roFunc.isEqual(new FunctionType())).to.be.true;
        expect(roFunc.isEqual(StringType.instance)).to.be.false;
    });

    it('stringifies as roFunction but transpiles as dynamic', () => {
        const roFunc = new roFunctionType();

        expect(roFunc.toString()).to.eql('roFunction');
        expect(roFunc.toTypeString()).to.eql('dynamic');
    });
});
