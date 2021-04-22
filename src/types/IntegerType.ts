import { isIntegerType, isDynamicType, isFloatType, isDoubleType, isLongIntegerType } from '..';
import type { BscType } from './BscType';


export class IntegerType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            isIntegerType(targetType) ||
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
        return 'integer';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return this.toString() === targetType.toString();
    }
}
