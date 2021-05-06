import { isDynamicType, isStringType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class StringType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            isStringType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'string';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isStringType(targetType);
    }
}
