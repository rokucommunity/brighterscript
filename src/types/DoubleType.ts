import { Type } from './BrsType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class DoubleType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof DoubleType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
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
    public static instance = new DoubleType();
}
