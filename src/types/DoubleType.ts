import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';


export class DoubleType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.DoubleType;

    public static instance = new DoubleType('double');

    public isTypeCompatible(targetType: BscType) {
        return (
            isDynamicType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType)
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
