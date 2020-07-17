import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class InterfaceType implements Type {
    public isAssignableTo(targetType: Type) {
        return (
            targetType instanceof InterfaceType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        //TODO make this match the actual interface of the object
        return 'interface';
    }
}
