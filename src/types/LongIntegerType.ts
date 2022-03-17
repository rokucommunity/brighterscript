import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType } from '../astUtils/reflection';
import type { BscType } from './BscType';


export class LongIntegerType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            isLongIntegerType(targetType) ||
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
        return this.typeText ?? 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isLongIntegerType(targetType);
    }
}
