import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class DoubleType implements BscType {
    public isAssignableTo(targetType: BscType) {
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
        return 'double';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
