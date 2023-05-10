import { isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { isInheritableType } from './InheritableType';
import { UnionType } from './UnionType';

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
    }
    const existingDynamicType = uniqueTypes.find(t => isDynamicType(t.type));
    if (existingDynamicType) {
        // If it includes dynamic, then the result is dynamic
        return existingDynamicType.type;
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

            if (currentType.type.isEqual(uniqueTypes[j].type)) {
                uniqueTypes[j].ignore = true;
            } else if (isInheritableType(uniqueTypes[j].type)) {
                if (currentType.type.isTypeCompatible(uniqueTypes[j].type)) {
                    //the type we're checking is less general than the current type... it can be ignored
                    uniqueTypes[j].ignore = true;
                }
                if (uniqueTypes[j].type.isTypeCompatible(currentType.type)) {
                    // the currentType can be assigned to some other type - it won't be in the final set
                    break;
                }
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
