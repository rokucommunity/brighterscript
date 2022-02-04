import { isArrayType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { BscType, TypeContext } from './BscType';
import { DynamicType } from './DynamicType';

export class ArrayType implements BscType {
    constructor(...innerTypes: BscType[]) {
        this.innerTypes = this.getUniqueTypesByAssignability(innerTypes);
    }
    public innerTypes: BscType[] = [];

    public isAssignableTo(targetType: BscType, context?: TypeContext) {
        if (isArrayType(targetType)) {
            //this array type is assignable to the target IF
            //1. all of the types in this array are present in the target
            outer: for (let innerType of this.innerTypes) {
                //find this inner type in the target
                // eslint-disable-next-line no-unreachable-loop
                for (let targetInnerType of targetType.innerTypes) {
                    //TODO TYPES is this loop correct? It ends after 1 iteration but we might need to do more iterations

                    if (innerType.isAssignableTo(targetInnerType, context)) {
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

    public isConvertibleTo(targetType: BscType, context?: TypeContext) {
        return this.isAssignableTo(targetType, context);
    }

    public toString(context?: TypeContext) {
        // TODO TYPES: When we support union types, the output should be more like:
        // `Array<${this.innerTypes.map((x) => x.toString(context)).join(' | ')}>`;
        return `${this.getDefaultType(context).toString(context)}[]`;
    }

    public toJsString(context?: TypeContext) {
        const uniqueInnerTypes = this.getUniqueTypesByAssignability(this.innerTypes);

        return `Array<${uniqueInnerTypes.map((x) => x.toString(context)).join(' | ')}>`;
    }

    public toTypeString(): string {
        return 'object';
    }

    public getDefaultType(context?: TypeContext): BscType {
        const uniqueInnerTypes = this.getUniqueTypesByAssignability(this.innerTypes, context);
        return uniqueInnerTypes?.length === 1 ? uniqueInnerTypes[0] : new DynamicType();
    }

    public equals(targetType: BscType, context?: TypeContext): boolean {
        return isArrayType(targetType) && this.isAssignableTo(targetType, context);
    }


    private getUniqueTypesByAssignability(innerTypes: BscType[], context?: TypeContext): BscType[] {
        const uniqueTypes: BscType[] = [];
        for (const innerType of innerTypes) {
            let shouldAddType = true;
            for (let i = 0; i < uniqueTypes.length; i++) {
                const uniqueType = uniqueTypes[i];
                if (innerType.isAssignableTo(uniqueType, context)) {
                    // this type is already assignable to the existing type
                    shouldAddType = false;
                    break;
                } else if (uniqueType.isAssignableTo(innerType, context)) {
                    // an existing type is assignable to this type. replace the existing type with this
                    // as this is more general
                    shouldAddType = false;
                    uniqueTypes[i] = innerType;
                    break;
                }
            }
            if (shouldAddType) {
                uniqueTypes.push(innerType);
            }
        }
        return uniqueTypes;
    }
}
