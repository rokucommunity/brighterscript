import { isUniversalFunctionType } from '../astUtils/reflection';
import type { CallableParam } from '../interfaces';
import type { BscType, TypeContext } from './BscType';
import { DynamicType } from './DynamicType';
import { FunctionType } from './FunctionType';


export class UniversalFunctionType extends FunctionType implements BscType {

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
        return (isUniversalFunctionType(targetType));
    }
}
