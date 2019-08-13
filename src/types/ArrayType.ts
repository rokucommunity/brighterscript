import { BrsType } from './BrsType';
import { DynamicType } from './DynamicType';

export class ArrayType implements BrsType {
    constructor(...innerTypes: BrsType[]) {
        this.innerTypes = innerTypes;
    }
    public innerTypes: BrsType[] = [];

    public isAssignableTo(targetType: BrsType) {
        if (targetType instanceof DynamicType) {
            return true;
        } else if (!(targetType instanceof ArrayType)) {
            return false;
        }
        //this array type is assignable to the target IF
        //1. all of the types in this array are present in the target
        outer: for (let innerType of this.innerTypes) {
            //find this inner type in the target
            for (let targetInnerType of targetType.innerTypes) {

                if (innerType.isAssignableTo(targetInnerType)) {
                    continue outer;
                }

                //our array contains a type that the target array does not...so these arrays are different
                return false;
            }
        }
    }

    public isConvertibleTo(targetType: BrsType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return `Array<${this.innerTypes.map((x) => x.toString()).join(' | ')}>`;
    }
}
