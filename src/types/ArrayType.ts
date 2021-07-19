import { isArrayType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class ArrayType implements BscType {
    constructor(...innerTypes: BscType[]) {
        this.innerTypes = innerTypes;
    }
    public innerTypes: BscType[] = [];

    public isAssignableTo(targetType: BscType) {
        if (isArrayType(targetType)) {
            //this array type is assignable to the target IF
            //1. all of the types in this array are present in the target
            outer: for (let innerType of this.innerTypes) {
                //find this inner type in the target
                // eslint-disable-next-line no-unreachable-loop
                for (let targetInnerType of targetType.innerTypes) {
                    //TODO TYPES is this loop correct? It ends after 1 iteration but we might need to do more iterations

                    if (innerType.isAssignableTo(targetInnerType)) {
                        continue outer;
                    }

                    //our array contains a type that the target array does not...so these arrays are different
                    return false;
                }
            }
            return true;
        } else if (isDynamicType(targetType) ||
            isObjectType(targetType)) {
            return true;
        }
        return false;
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

    public equals(targetType: BscType): boolean {
        return isArrayType(targetType) && this.isAssignableTo(targetType);
    }
}
