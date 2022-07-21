import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class InvalidType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof InvalidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'invalid';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
