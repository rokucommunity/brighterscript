import { isDynamicType, isInvalidType } from '../astUtils';
import type { BscType } from './BscType';

export class InvalidType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            isInvalidType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'invalid';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isInvalidType(targetType);
    }
}
