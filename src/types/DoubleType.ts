import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';


export class DoubleType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

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
