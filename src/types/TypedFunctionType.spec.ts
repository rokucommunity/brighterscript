import { expect } from '../chai-config.spec';

import { DynamicType } from './DynamicType';
import { TypedFunctionType } from './TypedFunctionType';
import { IntegerType } from './IntegerType';
import { StringType } from './StringType';
import { VoidType } from './VoidType';
import { FloatType } from './FloatType';

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


    it('checks equality', () => {
        expect(new TypedFunctionType(new VoidType()).isEqual(new TypedFunctionType(new VoidType()))).to.be.true;

        let func1 = new TypedFunctionType(StringType.instance);
        func1.addParameter('a', StringType.instance, false);
        func1.addParameter('b', IntegerType.instance, false);

        let func2 = new TypedFunctionType(StringType.instance);
        func2.addParameter('alpha', StringType.instance, false);
        func2.addParameter('beta', IntegerType.instance, false);
        expect(func1.isEqual(func2)).to.be.true;

        // different return type
        let func3 = new TypedFunctionType(DynamicType.instance);
        func3.addParameter('alpha', StringType.instance, false);
        func3.addParameter('beta', IntegerType.instance, false);
        expect(func1.isEqual(func3)).to.be.false;

        // different parameter type
        let func4 = new TypedFunctionType(StringType.instance);
        func4.addParameter('alpha', StringType.instance, false);
        func4.addParameter('beta', FloatType.instance, false);
        expect(func1.isEqual(func4)).to.be.false;

        // different optional param
        let func5 = new TypedFunctionType(StringType.instance);
        func5.addParameter('alpha', StringType.instance, false);
        func5.addParameter('beta', IntegerType.instance, true);
        expect(func1.isEqual(func5)).to.be.false;

        // additional optional param
        let func6 = new TypedFunctionType(StringType.instance);
        func6.addParameter('alpha', StringType.instance, false);
        func6.addParameter('beta', IntegerType.instance, false);
        func6.addParameter('charlie', IntegerType.instance, true);
        expect(func1.isEqual(func6)).to.be.false;

        // other is variadic
        let func7 = new TypedFunctionType(StringType.instance);
        func7.addParameter('alpha', StringType.instance, false);
        func7.addParameter('beta', IntegerType.instance, false);
        func7.isVariadic = true;
        expect(func1.isEqual(func7)).to.be.false;

        // both Variadic
        let variFunc1 = new TypedFunctionType(DynamicType.instance);
        variFunc1.isVariadic = true;
        // both Variadic
        let variFunc2 = new TypedFunctionType(DynamicType.instance);
        variFunc2.isVariadic = true;
        expect(variFunc1.isEqual(variFunc2)).to.be.true;
    });

    it('checks compatibility', () => {
        expect(new TypedFunctionType(new VoidType()).isTypeCompatible(new TypedFunctionType(new VoidType()))).to.be.true;

        let func1 = new TypedFunctionType(FloatType.instance);
        func1.addParameter('a', StringType.instance, false);
        func1.addParameter('b', IntegerType.instance, false);

        let func2 = new TypedFunctionType(FloatType.instance);
        func2.addParameter('alpha', StringType.instance, false);
        func2.addParameter('beta', IntegerType.instance, false);
        expect(func1.isTypeCompatible(func2)).to.be.true;

        // different return type, but return type is compatible with target type
        let func3 = new TypedFunctionType(IntegerType.instance);
        func3.addParameter('alpha', StringType.instance, false);
        func3.addParameter('beta', IntegerType.instance, false);
        expect(func1.isTypeCompatible(func3)).to.be.true;

        // different return type, but return type is NOT compatible with target type
        func3 = new TypedFunctionType(StringType.instance);
        func3.addParameter('alpha', StringType.instance, false);
        func3.addParameter('beta', IntegerType.instance, false);
        expect(func1.isTypeCompatible(func3)).to.be.false;

        // different parameter type
        let func4 = new TypedFunctionType(FloatType.instance);
        func4.addParameter('alpha', StringType.instance, false);
        func4.addParameter('beta', StringType.instance, false);
        expect(func1.isTypeCompatible(func4)).to.be.false;

        // different parameter type but types are compatible
        func4 = new TypedFunctionType(FloatType.instance);
        func4.addParameter('alpha', StringType.instance, false);
        func4.addParameter('beta', FloatType.instance, false);
        expect(func1.isTypeCompatible(func4)).to.be.true;

        // different optional param
        let func5 = new TypedFunctionType(FloatType.instance);
        func5.addParameter('alpha', StringType.instance, false);
        func5.addParameter('beta', IntegerType.instance, true);
        expect(func1.isTypeCompatible(func5)).to.be.false;

        // additional optional param
        let func6 = new TypedFunctionType(FloatType.instance);
        func6.addParameter('alpha', StringType.instance, false);
        func6.addParameter('beta', IntegerType.instance, false);
        func6.addParameter('charlie', IntegerType.instance, true);
        expect(func1.isTypeCompatible(func6)).to.be.true;

        // other is variadic
        let func7 = new TypedFunctionType(StringType.instance);
        func7.addParameter('alpha', StringType.instance, false);
        func7.addParameter('beta', IntegerType.instance, false);
        func7.isVariadic = true;
        expect(func1.isTypeCompatible(func7)).to.be.false;

        // both Variadic
        let variFunc1 = new TypedFunctionType(DynamicType.instance);
        variFunc1.isVariadic = true;
        // both Variadic
        let variFunc2 = new TypedFunctionType(DynamicType.instance);
        variFunc2.isVariadic = true;
        expect(variFunc1.isTypeCompatible(variFunc2)).to.be.true;
    });
});
