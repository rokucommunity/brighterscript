import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isEnumTypeCompatible, isUnionTypeCompatible } from './helpers';

import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class DoubleType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.DoubleType;

    public static instance = new DoubleType('double');

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType) ||
            isUnionTypeCompatible(this, targetType, data) ||
            isEnumTypeCompatible(this, targetType, data)
        );
    }
    public toString() {
        return this.typeText ?? 'double';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isDoubleType(targetType);
    }

}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('double', DoubleType.instance);
