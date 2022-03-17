import { isBooleanType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class BooleanType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            isBooleanType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'boolean';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isBooleanType(targetType);
    }
}
