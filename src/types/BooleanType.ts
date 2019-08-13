import { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class BooleanType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof BooleanType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'boolean';
    }
}
