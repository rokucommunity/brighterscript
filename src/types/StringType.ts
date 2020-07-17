import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class StringType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof StringType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'string';
    }

    public static instance = new StringType();
}
