import { isArrayType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ArrayType implements BscType {
    constructor(...innerTypes: BscType[]) {
        const innerTypesWithStrings = innerTypes.map((innerType) => {
            return { innerType: innerType, typeToString: innerType.toString() };
        });
        // gets unique types
        this.innerTypes = [...new Map(innerTypesWithStrings.map(item => [item.typeToString, item])).values()].map(it => it.innerType);
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

    public get defaultType(): BscType {
        return this.innerTypes?.length === 1 ? this.innerTypes[0] : new DynamicType();
    }

    public equals(targetType: BscType): boolean {
        return isArrayType(targetType) && this.isAssignableTo(targetType);
    }
}
