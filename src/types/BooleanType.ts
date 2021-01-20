import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class BooleanType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof BooleanType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'boolean';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
