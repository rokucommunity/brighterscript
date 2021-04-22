import { isDynamicType, isObjectType } from '../astUtils';
import type { BscType } from './BscType';

export class ObjectType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            isObjectType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isObjectType(targetType) && this.isAssignableTo(targetType);
    }
}
