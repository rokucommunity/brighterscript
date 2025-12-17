import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isAssociativeArrayType, isDynamicType, isIntersectionType, isObjectType, isTypedFunctionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';
import { addAssociatedTypesTableAsSiblingToMemberTable, getAllTypesFromComplexType, isEnumTypeCompatible, joinTypesString, reduceTypesForIntersectionType } from './helpers';
import { BscTypeKind } from './BscTypeKind';
import type { TypeCacheEntry } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { util } from '../util';
import { DynamicType } from './DynamicType';

export function intersectionTypeFactory(types: BscType[]) {
    return new IntersectionType(types);
}

export class IntersectionType extends BscType {
    constructor(
        public types: BscType[]
    ) {
        super(joinTypesString(types, 'and', BscTypeKind.IntersectionType));
        this.callFuncAssociatedTypesTable = new SymbolTable(`Intersection: CallFuncAssociatedTypes`);
    }

    public readonly kind = BscTypeKind.IntersectionType;

    public readonly callFuncAssociatedTypesTable: SymbolTable;

    public addType(type: BscType) {
        this.types.push(type);
    }

    isResolvable(): boolean {
        for (const type of this.types) {
            // resolvable if any inner type is resolvable
            if (type.isResolvable()) {
                return true;
            }
        }
        return false;
    }

    private getMemberTypeFromInnerTypes(name: string, options: GetTypeOptions): BscType {
        const typeFromMembers = this.types.map((innerType) => {
            return innerType?.getMemberType(name, { ...options, ignoreAADefaultDynamicMembers: true });
        });
        const filteredTypes = reduceTypesForIntersectionType(typeFromMembers.filter(t => t !== undefined));

        if (filteredTypes.length === 0) {
            if (this.types.some(isAssociativeArrayType)) {
                return DynamicType.instance;
            }
            return undefined;
        } else if (filteredTypes.length === 1) {
            return filteredTypes[0];
        }
        return new IntersectionType(filteredTypes);
    }

    private getCallFuncFromInnerTypes(name: string, options: GetTypeOptions): BscType {
        const typeFromMembers = reduceTypesForIntersectionType(this.types.map((innerType) => innerType?.getCallFuncType(name, options)).filter(t => t !== undefined));

        if (typeFromMembers.length === 0) {
            return undefined;
        } else if (typeFromMembers.length === 1) {
            return typeFromMembers[0];
        }
        return new IntersectionType(typeFromMembers);
    }

    getMemberType(name: string, options: GetTypeOptions) {
        const innerTypesMemberType = this.getMemberTypeFromInnerTypes(name, options);
        if (!innerTypesMemberType) {
            // We don't have any members of any inner types that match
            // so instead, create reference type that will
            return new ReferenceType(name, name, options.flags, () => {
                return {
                    name: `IntersectionType MemberTable: '${this.__identifier}'`,
                    getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                        const referenceTypeInnerMemberTypes = this.getMemberTypeFromInnerTypes(name, options);
                        if (!referenceTypeInnerMemberTypes) {
                            return undefined;
                        }
                        return referenceTypeInnerMemberTypes;
                    },
                    setCachedType: (innerName: string, innerCacheEntry: TypeCacheEntry, innerOptions: GetTypeOptions) => {
                        // TODO: is this even cachable? This is a NO-OP for now, and it shouldn't hurt anything
                    },
                    addSibling: (symbolTable: SymbolTable) => {
                        // TODO: I don't know what this means in this context?
                    }
                };
            });
        }
        return innerTypesMemberType;
    }

    getCallFuncType(name: string, options: GetTypeOptions) {
        const resultCallFuncType = this.getCallFuncFromInnerTypes(name, options);
        if (!resultCallFuncType) {
            // We don't have any members of any inner types that match
            // so instead, create reference type that will
            return new ReferenceType(name, name, options.flags, () => {
                return {
                    name: `IntersectionType CallFunc MemberTable: '${this.__identifier}'`,
                    getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                        const referenceTypeInnerMemberType = this.getCallFuncFromInnerTypes(name, options);
                        if (!referenceTypeInnerMemberType) {
                            return undefined;
                        }
                        return referenceTypeInnerMemberType;
                    },
                    setCachedType: (innerName: string, innerCacheEntry: TypeCacheEntry, innerOptions: GetTypeOptions) => {
                        // TODO: is this even cachable? This is a NO-OP for now, and it shouldn't hurt anything
                    },
                    addSibling: (symbolTable: SymbolTable) => {
                        // TODO: I don't know what this means in this context?
                    }
                };
            });
        }

        if (isTypedFunctionType(resultCallFuncType)) {
            const typesToCheck = [...resultCallFuncType.params.map(p => p.type), resultCallFuncType.returnType];

            for (const type of typesToCheck) {
                addAssociatedTypesTableAsSiblingToMemberTable(type, this.callFuncAssociatedTypesTable, SymbolTypeFlag.runtime);
            }
        }
        return resultCallFuncType;
    }

    get returnType() {
        return util.getReturnTypeOfIntersectionOfFunctions(this);
    }


    isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData): boolean {
        if (isDynamicType(targetType) || isObjectType(targetType) || this === targetType) {
            return true;
        }
        if (isEnumTypeCompatible(this, targetType, data)) {
            return true;
        }
        if (isIntersectionType(targetType)) {
            // check if this all the types of this type are in the target (eg, target is a super set of this types)
            for (const memberType of this.types) {
                let foundCompatibleInnerType = false;
                for (const targetInnerType of targetType.types) {
                    if (memberType.isTypeCompatible(targetInnerType, data)) {
                        foundCompatibleInnerType = true;
                        continue;
                    }
                }
                if (!foundCompatibleInnerType) {
                    return false;
                }
            }
            return true;
        }
        for (const innerType of this.types) {
            const foundCompatibleInnerType = innerType.isTypeCompatible(targetType, data);
            if (foundCompatibleInnerType) {
                return true;
            }
        }

        return false;
    }
    toString(): string {
        return joinTypesString(this.types, 'and', BscTypeKind.IntersectionType);
    }

    /**
     * Used for transpilation
     */
    toTypeString(): string {
        const uniqueTypeStrings = new Set<string>(getAllTypesFromComplexType(this).map(t => t.toTypeString()));

        if (uniqueTypeStrings.size === 1) {
            return uniqueTypeStrings.values().next().value;
        }
        return 'dynamic';
    }

    checkAllMemberTypes(predicate: (BscType) => boolean) {
        return this.types.reduce((acc, type) => {
            return acc && predicate(type);
        }, true);
    }

    isEqual(targetType: BscType): boolean {
        if (!isIntersectionType(targetType)) {
            return false;
        }
        if (this === targetType) {
            return true;
        }
        for (const type of this.types) {
            let foundMatch = false;
            for (const targetTypeInner of targetType.types) {
                if (type.isEqual(targetTypeInner)) {
                    foundMatch = true;
                    break;
                }
            }
            if (!foundMatch) {
                return false;
            }
        }
        return true;
    }

    getMemberTable(): SymbolTable {
        const intersectionTable = new SymbolTable(this.__identifier + ' IntersectionTable');

        for (const type of this.types) {
            type.addBuiltInInterfaces();
            for (const symbol of type.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime)) {
                const foundType = this.getMemberTypeFromInnerTypes(symbol.name, { flags: SymbolTypeFlag.runtime });
                /*

                const allResolvableTypes = foundType.reduce((acc, curType) => {
                    return acc && curType?.isResolvable();
                }, true);

                if (!allResolvableTypes) {
                    continue;
                }
                const uniqueType = getUniqueType(findTypeUnion(foundType), intersectionTypeFactory);*/
                intersectionTable.addSymbol(symbol.name, {}, foundType, SymbolTypeFlag.runtime);
            }
        }
        const firstType = this.types[0];
        if (!firstType) {
            return intersectionTable;
        }
        firstType.addBuiltInInterfaces();
        for (const symbol of firstType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime)) {
            const foundType = this.getMemberTypeFromInnerTypes(symbol.name, { flags: SymbolTypeFlag.runtime });
            /* const allResolvableTypes = foundType.reduce((acc, curType) => {
                 return acc && curType?.isResolvable();
             }, true);

             if (!allResolvableTypes) {
                 continue;
             }
             const uniqueType = getUniqueType(findTypeUnion(foundType), unionTypeFactory);*/
            intersectionTable.addSymbol(symbol.name, {}, foundType, SymbolTypeFlag.runtime);
        }
        return intersectionTable;
    }
}

BuiltInInterfaceAdder.intersectionTypeFactory = (types: BscType[]) => {
    return new IntersectionType(types);
};
