import { Type } from './BrsType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { FloatType } from './FloatType';
import { LongIntegerType } from './LongIntegerType';

export class IntegerType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof IntegerType ||
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
        return 'integer';
    }
    public static instance = new IntegerType();
}
