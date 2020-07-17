import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class VoidType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof VoidType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'void';
    }

    /**
     * Single static instance of void type
     */
    public static instance = new VoidType();
}
