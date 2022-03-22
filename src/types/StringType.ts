import { isDynamicType, isObjectType, isStringType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class StringType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            isStringType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'string';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isStringType(targetType);
    }
}
