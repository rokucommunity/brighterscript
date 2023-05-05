import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class IntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new IntegerType('integer');

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
        return this.typeText ?? 'integer';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(otherType: BscType) {
        return isIntegerType(otherType);
    }
}
