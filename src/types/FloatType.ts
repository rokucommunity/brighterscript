import { isDynamicType, isFloatTypeLike, isNumberTypeLike, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isEnumTypeCompatible, isNativeInterfaceCompatibleNumber, isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class FloatType extends BscType {

    public readonly kind = BscTypeKind.FloatType;

    public static instance = new FloatType();

    public isBuiltIn = true;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isNumberTypeLike(targetType) ||
            isUnionTypeCompatible(this, targetType, data) ||
            isEnumTypeCompatible(this, targetType, data) ||
            isNativeInterfaceCompatibleNumber(this, targetType, data)
        );

    }

    public toString() {
        return 'float';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isFloatTypeLike(targetType);
    }

    readonly binaryOpPriorityLevel = 2;
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('float', FloatType.instance);
