import { isCallableType, isDynamicType, isFunctionTypeLike, isObjectType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';

export class roFunctionType extends BaseFunctionType {
    public readonly kind = BscTypeKind.RoFunctionType;

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
        return 'roFunction';
    }

    public toTypeString(): string {
        return 'dynamic';
    }


    isEqual(targetType: BscType) {
        if (isFunctionTypeLike(targetType)) {
            return true;
        }
        return false;
    }
}
