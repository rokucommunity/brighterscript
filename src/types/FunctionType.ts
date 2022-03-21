import { isFunctionType } from '../astUtils/reflection';
import type { CallableParam } from '../interfaces';
import type { BscType, TypeContext } from './BscType';
import { DynamicType } from './DynamicType';
import { TypedFunctionType } from './TypedFunctionType';

export class FunctionType extends TypedFunctionType implements BscType {

    constructor(
    ) {
        super(new DynamicType());
        this.isVariadic = true;
    }

    public setName(name: string) {
        // noop
        return this;
    }
    public addParameter(paramOrName: CallableParam | string, type?: BscType, isOptional?: boolean) {
        // noop
        return this;
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {
        return (isFunctionType(targetType));
    }
}
