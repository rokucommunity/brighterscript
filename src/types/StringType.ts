import { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class StringType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        return (
            targetType instanceof StringType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'string';
    }
}
