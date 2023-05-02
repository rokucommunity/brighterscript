import { isBooleanType, isDynamicType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class BooleanType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new BooleanType('boolean');

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }

        return (
            isBooleanType(targetType) ||
            isDynamicType(targetType)
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
