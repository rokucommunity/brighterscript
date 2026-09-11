import { isDynamicType, isLongIntegerTypeLike, isNumberTypeLike, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isEnumTypeCompatible, isNativeInterfaceCompatibleNumber, isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class LongIntegerType extends BscType {
    public readonly kind = BscTypeKind.LongIntegerType;

    public static instance = new LongIntegerType();

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
        return 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isLongIntegerTypeLike(targetType);
    }

    readonly binaryOpPriorityLevel = 3;
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('longinteger', LongIntegerType.instance);
