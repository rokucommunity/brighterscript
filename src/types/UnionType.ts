import { isDynamicType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { isInheritableType } from './InheritableType';

export class UnionType extends BscType {
    constructor(
        public types: BscType[]
    ) {
        super(joinTypesString(types));
        for (const type of this.types) {
            this.memberTable.addSibling(type.memberTable);
        }
    }

    public addType(type: BscType) {
        this.types.push(type);
        this.memberTable.addSibling(type.memberTable);
    }

    isAssignableTo(targetType: BscType): boolean {
        if (isDynamicType(targetType)) {
            return true;
        }
        if (isInheritableType(targetType)) {
            let isAssignable = true;
            for (const currentType of this.types) {
                // assignable to target if each of these types can assign to target
                if (!currentType.isAssignableTo(targetType)) {
                    isAssignable = false;
                    break;
                }
            }
            return isAssignable;
        }
        if (isUnionType(targetType)) {
            let isAssignable = true;
            for (const currentType of this.types) {
                // assignable to target if each of these types can assign to target
                if (!targetType.canBeAssignedFrom(currentType)) {
                    isAssignable = false;
                    break;
                }
            }
            return isAssignable;
        }

        return false;
    }


    isConvertibleTo(targetType: BscType): boolean {
        return this.isAssignableTo(targetType);
    }
    toString(): string {
        return joinTypesString(this.types);
    }
    toTypeString(): string {
        return 'dynamic';
    }

    canBeAssignedFrom(targetType: BscType) {
        return !!this.types.find(t => targetType?.isAssignableTo(t));
    }

}


function joinTypesString(types: BscType[]) {
    return types.map(t => t.toString()).join(' | ');
}

/**
 * Gets a Unique type from a list of types
 * If all types are the same - just that type is returned
 * If one of the types is Dynamic, then Dynamic.instance is returned
 * If any types are assignable to another type, the more general type is returned
 * If there are multiple types that cannot be assigned, then a UnionType is returned
 * @param types array of types
 * @returns either the singular most general type, if there is one, otherwise a UnionType of the most general types
 */
export function getUniqueType(types: BscType[]): BscType {
    if (!types || types?.length === 0) {
        return undefined;
    }
    const uniqueTypes = Array.from(new Set(types)).map(t => {
        return { type: t, ignore: false };
    });

    if (uniqueTypes.length === 1) {
        // only one type
        return uniqueTypes[0].type;
    } else if (uniqueTypes.find(t => isDynamicType(t.type))) {
        // If it includes dynamic, then the result is dynamic
        return DynamicType.instance;
    }
    const generalizedTypes = [];
    //check assignability:
    for (let i = 0; i < uniqueTypes.length; i++) {
        const currentType = uniqueTypes[i];
        if (i === uniqueTypes.length - 1) {
            if (!currentType.ignore) {
                //this type was not convertible to anything else... it is as general as possible
                generalizedTypes.push(currentType.type);
            }
            break;
        }
        for (let j = i + 1; j < uniqueTypes.length; j++) {
            if (uniqueTypes[j].ignore) {
                continue;
            }
            if (currentType.type.isAssignableTo(uniqueTypes[j].type)) {
                // the currentType can be assigned to some other type - it won't be in the final set
                break;
            }
            if (uniqueTypes[j].type.isAssignableTo(currentType.type)) {
                //the type we're checking is less general than the current type... it can be ignored
                uniqueTypes[j].ignore = true;
            }
            if (j === uniqueTypes.length - 1) {
                //this type was not convertible to anything else... it is as general as possible
                generalizedTypes.push(currentType.type);
            }
        }
    }
    if (generalizedTypes.length === 1) {
        // only one type
        return generalizedTypes[0];
    }
    return new UnionType(generalizedTypes);
}

