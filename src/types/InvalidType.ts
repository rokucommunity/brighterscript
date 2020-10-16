import type { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class InvalidType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof InvalidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'invalid';
    }
}
