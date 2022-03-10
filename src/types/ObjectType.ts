import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ObjectType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof ObjectType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
