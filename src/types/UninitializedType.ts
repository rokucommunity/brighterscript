import { isDynamicType, isUninitializedType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';

export class UninitializedType extends BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof UninitializedType ||
            targetType instanceof DynamicType
        );
    }

    public readonly kind = BscTypeKind.UninitializedType;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isUninitializedType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return 'uninitialized';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isUninitializedType(targetType);
    }
}
