import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class LongIntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new LongIntegerType('longinteger');

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
        return this.typeText ?? 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isLongIntegerType(targetType);
    }
}
