import { isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { LongIntegerType } from './LongIntegerType';

export class IntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new IntegerType('integer');

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
        return (
            targetType instanceof IntegerType ||
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
        return this.typeText ?? 'integer';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
