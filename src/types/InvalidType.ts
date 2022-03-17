import { isCustomType, isDynamicType, isInvalidType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class InvalidType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            isInvalidType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType) || isCustomType(targetType) || isObjectType(targetType);
    }

    public toString() {
        return this.typeText ?? 'invalid';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isInvalidType(targetType);
    }
}
