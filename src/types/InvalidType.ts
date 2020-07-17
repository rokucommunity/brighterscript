import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class InvalidType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof InvalidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'invalid';
    }

    public static instance = new InvalidType();
}
