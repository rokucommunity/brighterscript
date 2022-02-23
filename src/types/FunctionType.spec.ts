import { expect } from 'chai';

import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { FunctionType } from './FunctionType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { UniversalFunctionType } from './UniversalFunctionType';
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

    it('adds a callableParam object as a parameter', () => {
        const myFunc = new FunctionType(new IntegerType(), false, [{ name: 'a', type: new StringType(), isOptional: false }, { name: 'b', type: new DynamicType(), isOptional: true }]);
        myFunc.addParameter({ name: 'c', type: new FloatType(), isOptional: true });
        expect(myFunc.params.length).to.equal(3);
    });

    it('is assignable to a universal function', () => {
        expect(new FunctionType(new StringType()).setName('myFunc').addParameter('p1', new IntegerType()).isAssignableTo(new UniversalFunctionType()));
        expect(new FunctionType(new DynamicType()).isAssignableTo(new UniversalFunctionType()));
        expect(new FunctionType(new VoidType()).isAssignableTo(new UniversalFunctionType()));
    });
});
