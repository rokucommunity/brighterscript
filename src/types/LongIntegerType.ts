import { isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';

export class LongIntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new LongIntegerType('longinteger');

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
        return (
            targetType instanceof LongIntegerType ||
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
        return this.typeText ?? 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
