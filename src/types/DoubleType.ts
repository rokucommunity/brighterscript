import { isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class DoubleType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new DoubleType('double');

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
        return (
            targetType instanceof DoubleType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        if (
            targetType instanceof DynamicType ||
            targetType instanceof IntegerType ||
            targetType instanceof FloatType ||
            targetType instanceof DoubleType ||
            targetType instanceof LongIntegerType
        ) {
            return true;
        } else {
            return false;
        }
    }
    public toString() {
        return this.typeText ?? 'double';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
