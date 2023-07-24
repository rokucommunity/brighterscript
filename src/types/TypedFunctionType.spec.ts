import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { TypedFunctionType } from './TypedFunctionType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { VoidType } from './VoidType';

describe('TypedFunctionType', () => {
    it('is equivalent to dynamic type', () => {
        expect(new TypedFunctionType(new VoidType()).isTypeCompatible(new DynamicType())).to.be.true;
    });

    it('validates using param and return types', () => {
        expect(new TypedFunctionType(new VoidType()).isTypeCompatible(new TypedFunctionType(new VoidType()))).to.be.true;

        //different parameter count
        expect(
            new TypedFunctionType(new VoidType()).addParameter('a', new IntegerType(), false).isTypeCompatible(
                new TypedFunctionType(new VoidType())
            )
        ).to.be.false;

        //different parameter types
        expect(
            new TypedFunctionType(new VoidType()).addParameter('a', new IntegerType(), false).isTypeCompatible(
                new TypedFunctionType(new VoidType()).addParameter('a', new StringType(), false)
            )
        ).to.be.false;

        //different return type
        expect(
            new TypedFunctionType(new VoidType()).isTypeCompatible(
                new TypedFunctionType(new IntegerType())
            )
        ).to.be.false;
    });
});
