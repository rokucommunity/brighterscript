import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isEnumTypeCompatible, isNativeInterfaceCompatibleNumber, isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class LongIntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.LongIntegerType;

    public static instance = new LongIntegerType('longinteger');

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType) ||
            isUnionTypeCompatible(this, targetType, data) ||
            isEnumTypeCompatible(this, targetType, data) ||
            isNativeInterfaceCompatibleNumber(this, targetType, data)
        );
    }

    public toString() {
        return this.typeText ?? 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isLongIntegerType(targetType);
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('longinteger', LongIntegerType.instance);
