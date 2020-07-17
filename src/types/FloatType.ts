import { Type } from './BrsType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class FloatType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof FloatType ||
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
        return 'float';
    }

    public static instance = new FloatType();
}
