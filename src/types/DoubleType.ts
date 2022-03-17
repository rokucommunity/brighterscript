import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class DoubleType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            isDoubleType(targetType) ||
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
        return this.typeText ?? 'double';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return this.toString() === targetType?.toString();
    }
}
