import type { TypeCompatibilityData } from '../interfaces';
import { isAnyReferenceType, isDynamicType, isEnumMemberType, isEnumType, isInheritableType, isUnionType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export function findTypeIntersection(typesArr1: BscType[], typesArr2: BscType[]) {
    if (!typesArr1 || !typesArr2) {
        return undefined;
    }
    return typesArr1?.filter((currentType) => {
        if (!currentType) {
            return false;
        }
        const indexOfCurrentTypeInArr2 = typesArr2.findIndex((checkType) => {
            return currentType.isEqual(checkType);
        });
        return indexOfCurrentTypeInArr2 >= 0;
    });
}

export function findTypeUnion(...typesArr: BscType[][]) {
    return getUniqueTypesFromArray([].concat(...typesArr));
}

export function getUniqueTypesFromArray(types: BscType[]) {
    if (!types) {
        return undefined;
    }
    return types?.filter((currentType, currentIndex) => {
        if (!currentType) {
            return false;
        }
        const latestIndex = types.findIndex((checkType) => {
            return currentType.isEqual(checkType);
        });
        // the index that was found is the index we're checking --- there are no equal types after this
        return latestIndex === currentIndex;
    });
}

/**
 * Reduces a list of types based on equality or inheritance
 * If all types are the same - just that type is returned
 * If one of the types is Dynamic, then Dynamic.instance is returned
 * If any types inherit another type, the more general type is returned
 * @param types array of types
 * @returns an array of the most general types
 */
export function reduceTypesToMostGeneric(types: BscType[]): BscType[] {
    if (!types || types?.length === 0) {
        return undefined;
    }

    if (types.length === 1) {
        // only one type
        return [types[0]];
    }

    // Get a list of unique types, based on the `isEqual()` method
    const uniqueTypes = getUniqueTypesFromArray(types).map(t => {
        // map to object with `shouldIgnore` flag
        return { type: t, shouldIgnore: false };
    });

    if (uniqueTypes.length === 1) {
        // only one type after filtering
        return [uniqueTypes[0].type];
    }
    const existingDynamicType = uniqueTypes.find(t => !isAnyReferenceType(t.type) && isDynamicType(t.type));
    if (existingDynamicType) {
        // If it includes dynamic, then the result is dynamic
        return [existingDynamicType.type];
    }
    const generalizedTypes = [];
    //check assignability:
    for (let i = 0; i < uniqueTypes.length; i++) {
        const currentType = uniqueTypes[i].type;
        if (i === uniqueTypes.length - 1) {
            if (!uniqueTypes[i].shouldIgnore) {
                //this type was not convertible to anything else... it is as general as possible
                generalizedTypes.push(currentType);
            }
            break;
        }
        for (let j = i + 1; j < uniqueTypes.length; j++) {
            if (uniqueTypes[j].shouldIgnore) {
                continue;
            }
            const checkType = uniqueTypes[j].type;

            if (currentType.isEqual(uniqueTypes[j].type)) {
                uniqueTypes[j].shouldIgnore = true;
            } else if (isInheritableType(currentType) && isInheritableType(checkType)) {
                if (currentType.isTypeDescendent(checkType)) {
                    //the type we're checking is less general than the current type... it can be ignored
                    uniqueTypes[j].shouldIgnore = true;
                }
                if (checkType.isTypeDescendent(currentType)) {
                    // the currentType is a descendent to some other type - it won't be in the final set
                    break;
                }
            }
            if (j === uniqueTypes.length - 1) {
                //this type was not convertible to anything else... it is as general as possible
                generalizedTypes.push(currentType);
            }
        }
    }
    return generalizedTypes;
}


/**
 * Gets a Unique type from a list of types
 * @param types array of types
 * @returns either the singular most general type, if there is one, otherwise a UnionType of the most general types
 */
export function getUniqueType(types: BscType[], unionTypeFactory: (types: BscType[]) => BscType): BscType {
    if (!types || types.length === 0) {
        return undefined;
    }
    types = types?.map(type => {
        if (!isAnyReferenceType(type) && isUnionType(type)) {
            return type.types;
        }
        return type;
    }).flat();
    const generalizedTypes = reduceTypesToMostGeneric(types);
    if (!generalizedTypes || generalizedTypes.length === 0) {
        return undefined;
    }
    if (generalizedTypes?.length === 1) {
        // only one type
        return generalizedTypes[0];
    }
    return unionTypeFactory(generalizedTypes);
}


export function isUnionTypeCompatible(thisType: BscType, maybeUnionType: BscType, data?: TypeCompatibilityData): boolean {
    if (isUnionType(maybeUnionType)) {
        for (const innerType of maybeUnionType.types) {
            if (!thisType.isTypeCompatible(innerType, data)) {
                return false;
            }
        }
        return true;
    }
    return false;
}


export function isEnumTypeCompatible(thisType: BscType, maybeEnumType: BscType, data?: TypeCompatibilityData): boolean {
    if (isEnumMemberType(maybeEnumType) || isEnumType(maybeEnumType)) {
        return thisType.isTypeCompatible(maybeEnumType.underlyingType, data);
    }
    return false;
}
