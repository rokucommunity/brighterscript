import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class StringType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    /**
     * A static instance that can be used to reduce memory and constructor costs, since there's nothing unique about this
     */
    public static instance = new StringType('string');

    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof StringType ||
            targetType instanceof DynamicType
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
}
