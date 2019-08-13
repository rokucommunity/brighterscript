import { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class DoubleType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof DoubleType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
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
}
