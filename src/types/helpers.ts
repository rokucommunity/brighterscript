import type { TypeCompatibilityData } from '../interfaces';
import { isAnyReferenceType, isArrayDefaultTypeReferenceType, isAssociativeArrayTypeLike, isCompoundType, isDynamicType, isEnumMemberType, isEnumType, isInheritableType, isInterfaceType, isIntersectionType, isObjectType, isReferenceType, isTypePropertyReferenceType, isUnionType, isUnionTypeOf, isVoidType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import type { UnionType } from './UnionType';
import type { SymbolTable } from '../SymbolTable';
import type { SymbolTypeFlag } from '../SymbolTypeFlag';
import type { IntersectionType } from './IntersectionType';
import type { BscTypeKind } from './BscTypeKind';

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

/**
 * Same as findTypeUnion, but does not allow short cutting by just checking names
 * Useful for checking types between callfuncs, as the parameter types may have the same name, but mean different things
 */
export function findTypeUnionDeepCheck(...typesArr: BscType[][]) {
    return getUniqueTypesFromArray([].concat(...typesArr), false);
}

export function getUniqueTypesFromArray(types: BscType[], allowNameEquality = true) {
    if (!types) {
        return undefined;
    }
    return types?.filter((currentType, currentIndex) => {
        if (!currentType) {
            return false;
        }
        if ((isTypePropertyReferenceType(currentType) || isArrayDefaultTypeReferenceType(currentType)) && !currentType.isResolvable()) {
            return true;
        }
        const latestIndex = types.findIndex((checkType) => {
            return currentType.isEqual(checkType, { allowNameEquality: allowNameEquality });
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
export function reduceTypesToMostGeneric(types: BscType[], allowNameEquality = true): BscType[] {
    if (!types || types?.length === 0) {
        return undefined;
    }

    if (types.length === 1) {
        // only one type
        return [types[0]];
    }

    types = types.map(t => {
        if (isReferenceType(t) && t.isResolvable()) {
            return (t as any).getTarget() ?? t;
        }
        return t;
    });

    // Get a list of unique types, based on the `isEqual()` method
    const uniqueTypes = getUniqueTypesFromArray(types, allowNameEquality).map(t => {
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

            if (currentType.isResolvable() && currentType.isEqual(uniqueTypes[j].type, { allowNameEquality: allowNameEquality })) {
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
 * Reduces a list of types based on equality or inheritance
 * If all types are the same - just that type is returned
 * If one of the types is Dynamic, then Dynamic.instance is returned
 * If any types inherit another type, the more Specific type is returned, eg. the one with the most members
 * @param types array of types
 * @returns an array of the most specific types
 */
export function reduceTypesForIntersectionType(types: BscType[], allowNameEquality = true): BscType[] {
    if (!types || types?.length === 0) {
        return undefined;
    }

    if (types.length === 1) {
        // only one type
        return [types[0]];
    }

    types = types.map(t => {
        if (isReferenceType(t)) {
            if (t.isResolvable()) {
                return (t as any).getTarget() ?? t;

            }
            return undefined;
        }
        return t;
    }).filter(t => t);

    // Get a list of unique types, based on the `isEqual()` method
    const uniqueTypes = getUniqueTypesFromArray(types, allowNameEquality).map(t => {
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
    const specificTypes = [];
    //check assignability:
    for (let i = 0; i < uniqueTypes.length; i++) {
        const currentType = uniqueTypes[i].type;
        if (i === uniqueTypes.length - 1) {
            if (!uniqueTypes[i].shouldIgnore) {
                //this type was not convertible to anything else... it is as general as possible
                specificTypes.push(currentType);
            }
            break;
        }
        for (let j = i + 1; j < uniqueTypes.length; j++) {
            if (uniqueTypes[j].shouldIgnore) {
                continue;
            }
            const checkType = uniqueTypes[j].type;

            if (currentType.isResolvable() && currentType.isEqual(uniqueTypes[j].type, { allowNameEquality: allowNameEquality })) {
                uniqueTypes[j].shouldIgnore = true;
            } else if (isInheritableType(currentType) && isInheritableType(checkType)) {
                if (checkType.isTypeDescendent(currentType)) {
                    //the type we're checking is more general than the current type... it can be ignored
                    uniqueTypes[j].shouldIgnore = true;
                }
                if (currentType.isTypeDescendent(checkType)) {
                    // the currentType is an ancestor to some other type - it won't be in the final set
                    break;
                }
            }
            if (j === uniqueTypes.length - 1) {
                //this type was not convertible to anything else... it is as general as possible
                specificTypes.push(currentType);
            }
        }
    }
    return specificTypes;
}


/**
 * Gets a Unique type from a list of types
 * @param types array of types
 * @returns either the singular most general type, if there is one, otherwise a UnionType of the most general types
 */
export function getUniqueType(types: BscType[], unionTypeFactory: (types: BscType[]) => BscType, allowNameEquality = true): BscType {
    if (!types || types.length === 0) {
        return undefined;
    }
    const dynType = types.find((x) => !isAnyReferenceType(x) && (isDynamicType(x) || isVoidType(x)));
    if (dynType) {
        return dynType;
    }
    types = types?.map(type => {
        if (!isAnyReferenceType(type) && isUnionType(type)) {
            return type.types;
        }
        return type;
    }).flat();
    const generalizedTypes = reduceTypesToMostGeneric(types, allowNameEquality);
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

export function isNativeInterfaceCompatible(thisType: BscType, otherType: BscType, allowedType: string, data?: TypeCompatibilityData): boolean {
    if (isInterfaceType(otherType)) {
        // TODO: it is not great to do type checking based on interface name
        const lowerOtherName = otherType.name.toLowerCase();
        return allowedType === lowerOtherName;
    }
    return false;
}

export function isNativeInterfaceCompatibleNumber(thisType: BscType, otherType: BscType, data?: TypeCompatibilityData): boolean {
    if (isInterfaceType(otherType)) {
        // TODO: it is not great to do type checking based on interface name
        const lowerOtherName = otherType.name.toLowerCase();
        return lowerOtherName === 'roint' ||
            lowerOtherName === 'rofloat' ||
            lowerOtherName === 'rodouble' ||
            lowerOtherName === 'rolonginteger';
    }
    return false;
}

export function getAllTypesFromCompoundType(complex: UnionType | IntersectionType): BscType[] {
    const results = [];

    for (const type of complex.types) {
        if (isCompoundType(type)) {
            results.push(...getAllTypesFromCompoundType(type));
        } else {
            results.push(type);
        }
    }
    return results;
}

export function addAssociatedTypesTableAsSiblingToMemberTable(type: BscType, associatedTypesTable: SymbolTable, bitFlags: SymbolTypeFlag) {
    if (isReferenceType(type) &&
        !type.isResolvable()) {
        // This param or return type is a reference - make sure the associated types are included
        type.tableProvider().addSibling(associatedTypesTable);

        // add this as a sister table to member tables too!
        const memberTable: SymbolTable = type.getMemberTable();
        if (memberTable.getAllSymbols) {
            for (const memberSymbol of memberTable.getAllSymbols(bitFlags)) {
                addAssociatedTypesTableAsSiblingToMemberTable(memberSymbol?.type, associatedTypesTable, bitFlags);
            }
        }
    }
}
/**
 * A map of all types created in the program during its lifetime. This applies across all programs, validate runs, etc. Mostly useful for a single run to track types created.
 */
export const TypesCreated: Record<string, number> = {};

export function joinTypesString(types: BscType[], separator: string, thisTypeKind: BscTypeKind): string {
    return [...new Set(types.map(t => {
        const typeString = t.toString();
        if ((isUnionType(t) || isIntersectionType(t)) && t.kind !== thisTypeKind) {
            return `(${typeString})`;
        }
        return t.toString();
    }))].join(` ${separator} `);
}


export function isTypeWithPotentialDefaultDynamicMember(type: BscType): boolean {
    return (isInheritableType(type) && type.changeUnknownMemberToDynamic) ||
        isAssociativeArrayTypeLike(type) ||
        isObjectType(type) ||
        isUnionTypeOf(type, isTypeWithPotentialDefaultDynamicMember);
}
