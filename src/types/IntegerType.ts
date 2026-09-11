import { isDynamicType, isIntegerTypeLike, isNumberTypeLike, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isEnumTypeCompatible, isNativeInterfaceCompatibleNumber, isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class IntegerType extends BscType {
    public readonly kind = BscTypeKind.IntegerType;

    public static instance = new IntegerType();

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
        return 'integer';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(otherType: BscType) {
        return isIntegerTypeLike(otherType);
    }

    readonly binaryOpPriorityLevel = 4;
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('integer', IntegerType.instance);
