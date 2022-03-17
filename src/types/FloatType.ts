import { isDynamicType, isIntegerType, isFloatType, isDoubleType, isLongIntegerType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class FloatType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            isFloatType(targetType) ||
            isDynamicType(targetType)

        );
    }

    public isConvertibleTo(targetType: BscType) {
        if (
            isDynamicType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType)
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

    public equals(targetType: BscType): boolean {
        return this.toString() === targetType?.toString();
    }
}
