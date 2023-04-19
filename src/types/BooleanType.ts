import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class BooleanType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new BooleanType('boolean');

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
        return this.typeText ?? 'boolean';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
