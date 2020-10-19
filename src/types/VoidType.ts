import type { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class VoidType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof VoidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'void';
    }
}
