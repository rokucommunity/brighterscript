import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class UninitializedType extends BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof UninitializedType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'uninitialized';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
