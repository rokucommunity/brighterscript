import type { BscType } from './BscType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';

export class LongIntegerType implements BscType {
    public isAssignableTo(targetType: BscType) {
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
        return 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
