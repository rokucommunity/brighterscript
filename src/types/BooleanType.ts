import { isBooleanType, isDynamicType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isNativeInterfaceCompatible, isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class BooleanType extends BscType {
    public readonly kind = BscTypeKind.BooleanType;
    public isBuiltIn = true;

    public static instance = new BooleanType();

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isBooleanType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType) ||
            isNativeInterfaceCompatible(this, targetType, 'roboolean', data)
        );
    }

    public toString() {
        return 'boolean';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isBooleanType(targetType);
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('boolean', BooleanType.instance);
