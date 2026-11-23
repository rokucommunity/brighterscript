import { expect } from '../chai-config.spec';
import { expectTypeToBe } from '../testHelpers.spec';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';

class StubFunctionType extends BaseFunctionType {
    public readonly kind = BscTypeKind.FunctionType;
}

describe('BaseFunctionType', () => {
    it('defaults to a dynamic return type and is marked built-in', () => {
        const func = new StubFunctionType();

        expectTypeToBe(func.returnType, DynamicType);
        expect(func.isBuiltIn).to.be.true;
    });

    it('stringifies as Function', () => {
        const func = new StubFunctionType();

        expect(func.toString()).to.eql('Function');
        expect(func.toTypeString()).to.eql('Function');
    });

    it('requires subclasses to implement isTypeCompatible', () => {
        const func = new StubFunctionType();

        expect(
            () => func.isTypeCompatible({} as BscType)
        ).to.throw('Method not implemented.');
    });

    it('requires subclasses to implement isEqual', () => {
        const func = new StubFunctionType();

        expect(
            () => func.isEqual({} as BscType)
        ).to.throw('Method not implemented.');
    });
});
