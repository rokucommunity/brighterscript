import { expect } from 'chai';

import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { TypedFunctionType } from './TypedFunctionType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { FunctionType } from './FunctionType';
import { VoidType } from './VoidType';

describe('FunctionType', () => {
    it('is equivalent to dynamic type', () => {
        expect(new TypedFunctionType(new VoidType()).isAssignableTo(new DynamicType())).to.be.true;
    });

    it('validates using param and return types', () => {
        expect(new TypedFunctionType(new VoidType()).isAssignableTo(new TypedFunctionType(new VoidType()))).to.be.true;

        //different parameter count
        expect(
            new TypedFunctionType(new VoidType()).addParameter('a', new IntegerType(), false).isAssignableTo(
                new TypedFunctionType(new VoidType())
            )
        ).to.be.false;

        //different parameter types
        expect(
            new TypedFunctionType(new VoidType()).addParameter('a', new IntegerType(), false).isAssignableTo(
                new TypedFunctionType(new VoidType()).addParameter('a', new StringType(), false)
            )
        ).to.be.false;

        //different return type
        expect(
            new TypedFunctionType(new VoidType()).isAssignableTo(
                new TypedFunctionType(new IntegerType())
            )
        ).to.be.false;
    });

    it('adds a callableParam object as a parameter', () => {
        const myFunc = new TypedFunctionType(new IntegerType(), false, [{ name: 'a', type: new StringType(), isOptional: false }, { name: 'b', type: new DynamicType(), isOptional: true }]);
        myFunc.addParameter({ name: 'c', type: new FloatType(), isOptional: true });
        expect(myFunc.params.length).to.equal(3);
    });

    it('is assignable to a universal function', () => {
        expect(new TypedFunctionType(new StringType()).setName('myFunc').addParameter('p1', new IntegerType()).isAssignableTo(new FunctionType()));
        expect(new TypedFunctionType(new DynamicType()).isAssignableTo(new FunctionType()));
        expect(new TypedFunctionType(new VoidType()).isAssignableTo(new FunctionType()));
    });
});
