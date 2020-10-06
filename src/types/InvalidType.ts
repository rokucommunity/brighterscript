import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class InvalidType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof InvalidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'invalid';
    }
}
