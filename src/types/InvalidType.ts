import { isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class InvalidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
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
