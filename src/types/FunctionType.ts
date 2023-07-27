import { isCallableType, isDynamicType, isFunctionType, isObjectType } from '../astUtils/reflection';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';

export class FunctionType extends BaseFunctionType {
    constructor(public typeText?: string) {
        super();
    }

    public readonly kind = BscTypeKind.FunctionType;


    public static instance = new FunctionType('function');


    public isTypeCompatible(targetType: BscType) {
        if (
            isDynamicType(targetType) ||
            isCallableType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType)
        ) {
            return true;
        }
        return false;
    }

    public toString() {
        return this.toTypeString();

    }

    public toTypeString(): string {
        return this.typeText ?? 'function';
    }

    isEqual(targetType: BscType) {
        if (isFunctionType(targetType)) {
            return true;
        }
        return false;
    }
}
