import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ObjectType implements BscType {
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
        return 'object';
    }
}
