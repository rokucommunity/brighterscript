import type { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class UninitializedType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof UninitializedType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'uninitialized';
    }
}
