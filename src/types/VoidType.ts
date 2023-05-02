import { isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class VoidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new VoidType('void');

    public isAssignableTo(targetType: BscType) {
        if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
        return (
            targetType instanceof VoidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'void';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
