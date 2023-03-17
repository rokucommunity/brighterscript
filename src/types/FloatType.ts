import type { BscType } from './BscType';
import { DoubleType } from './DoubleType';
import { DynamicType } from './DynamicType';
import { IntegerType } from './IntegerType';
import { LongIntegerType } from './LongIntegerType';

export class FloatType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public static instance = new FloatType('float');

    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof FloatType ||
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
        return this.typeText ?? 'float';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
