import { Type } from './BrsType';
import { DynamicType } from './DynamicType';

export class UnionType implements Type {
    constructor(types?: Type[]) {
        this.types = types ?? [];
    }
    public types: Type[];

    public isAssignableTo(targetType: Type) {
        //everything is assignable to DynamicType
        if (targetType instanceof DynamicType) {
            return true;

            //nothing is assignable to an empty union type (not sure how this would even happen...)
        } else if (this.types.length === 0) {
            return false;

            //all of the items in the union type must be assignable to the target
        } else {
            for (let type of this.types) {
                if (type.isAssignableTo(targetType) === false) {
                    return false;
                }
            }
            return true;
        }
    }

    public isConvertibleTo(targetType: Type) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'void';
    }
}
