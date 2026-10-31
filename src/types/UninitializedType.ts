import { isUninitializedType } from '../astUtils/reflection';
import type { TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class UninitializedType extends BscType {
    public isAssignableTo(targetType: BscType) {
        return false;
    }

    public readonly kind = BscTypeKind.UninitializedType;

    public isBuiltIn = true;
    public static instance = new UninitializedType();

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return false;
    }

    public toString() {
        return 'uninitialized';
    }

    public toTypeString(): string {
        throw new Error('Uninitialized type cannot be used in code');
    }

    public isEqual(targetType: BscType): boolean {
        return isUninitializedType(targetType);
    }
}


export function uninitializedTypeFactory() {
    return UninitializedType.instance;
}
