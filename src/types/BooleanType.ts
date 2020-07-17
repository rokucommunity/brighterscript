import { Type } from './BrsType';
import { DynamicType } from './DynamicType';
import { ToStrInterface } from './interfaces/ToStrInterface';

export class BooleanType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof BooleanType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'boolean';
    }

    public methods = [
        ...ToStrInterface.methods
    ];

    public static instance = new BooleanType();
}
