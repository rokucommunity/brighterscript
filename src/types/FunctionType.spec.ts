import { expect } from 'chai';

import { DynamicType } from './DynamicType';
import { FunctionType } from './FunctionType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { VoidType } from './VoidType';

describe('FunctionType', () => {
    it('is equivalent to dynamic type', () => {
        expect(new FunctionType(new VoidType()).isAssignableTo(new DynamicType())).to.be.true;
    });

    it('validates using param and return types', () => {
        expect(new FunctionType(new VoidType()).isAssignableTo(new FunctionType(new VoidType()))).to.be.true;

        //different parameter count
        expect(
            new FunctionType(new VoidType()).addParameter('a', new IntegerType(), false).isAssignableTo(
                new FunctionType(new VoidType())
            )
        ).to.be.false;

        //different parameter types
        expect(
            new FunctionType(new VoidType()).addParameter('a', new IntegerType(), false).isAssignableTo(
                new FunctionType(new VoidType()).addParameter('a', new StringType(), false)
            )
        ).to.be.false;

        //different return type
        expect(
            new FunctionType(new VoidType()).isAssignableTo(
                new FunctionType(new IntegerType())
            )
        ).to.be.false;
    });
});
