import { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class ObjectType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof ObjectType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'object';
    }
}
