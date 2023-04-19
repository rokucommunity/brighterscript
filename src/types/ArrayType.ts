import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ArrayType extends BscType {
    constructor(...innerTypes: BscType[]) {
        super();
        this.innerTypes = innerTypes;
    }
    public innerTypes: BscType[] = [];

    public isAssignableTo(targetType: BscType) {
        if (targetType instanceof DynamicType) {
            return true;
        } else if (!(targetType instanceof ArrayType)) {
            return false;
        }
        //this array type is assignable to the target IF
        //1. all of the types in this array are present in the target
        outer: for (let innerType of this.innerTypes) {
            //find this inner type in the target

            // eslint-disable-next-line no-unreachable-loop
            for (let targetInnerType of targetType.innerTypes) {
                //TODO is this loop correct? It ends after 1 iteration but we might need to do more iterations

                if (innerType.isAssignableTo(targetInnerType)) {
                    continue outer;
                }

                //our array contains a type that the target array does not...so these arrays are different
                return false;
            }
        }
        return true;
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return `Array<${this.innerTypes.map((x) => x.toString()).join(' | ')}>`;
    }

    public toTypeString(): string {
        return 'object';
    }
}
