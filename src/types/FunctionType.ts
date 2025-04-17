import { isCallableType, isDynamicType, isFunctionTypeLike, isObjectType } from '../astUtils/reflection';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class FunctionType extends BaseFunctionType {
    public readonly kind = BscTypeKind.FunctionType;

    public static instance = new FunctionType();

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (
            isDynamicType(targetType) ||
            isCallableType(targetType) ||
            isFunctionTypeLike(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)
        ) {
            return true;
        }
        return false;
    }

    public toString() {
        return this.toTypeString();

    }

    public toTypeString(): string {
        return 'function';
    }

    isEqual(targetType: BscType) {
        if (isFunctionTypeLike(targetType)) {
            return true;
        }
        return false;
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('function', FunctionType.instance);
