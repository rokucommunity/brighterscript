import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class FloatType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.FloatType;

    public static instance = new FloatType('float');

    public isTypeCompatible(targetType: BscType) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType)
        );

    }

    public toString() {
        return this.typeText ?? 'float';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isFloatType(targetType);
    }
}
