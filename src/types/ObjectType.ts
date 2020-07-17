import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class ObjectType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof ObjectType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'object';
    }

    public static instance = new ObjectType();
}
