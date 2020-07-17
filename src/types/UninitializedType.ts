import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class UninitializedType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof UninitializedType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'uninitialized';
    }
}
