import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isDynamicType, isObjectType, isTypedFunctionType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';
import { addAssociatedTypesTableAsSiblingToMemberTable, findTypeUnion, findTypeUnionDeepCheck, getAllTypesFromComplexType, getUniqueType, isEnumTypeCompatible, joinTypesString } from './helpers';
import { BscTypeKind } from './BscTypeKind';
import type { TypeCacheEntry } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { util } from '../util';

export function unionTypeFactory(types: BscType[]) {
    return new UnionType(types);
}

export class UnionType extends BscType {
    constructor(
        public types: BscType[]
    ) {
        super(joinTypesString(types, 'or', BscTypeKind.UnionType));
        this.callFuncAssociatedTypesTable = new SymbolTable(`Union: CallFuncAssociatedTypes`);
    }

    public readonly kind = BscTypeKind.UnionType;

    public readonly callFuncAssociatedTypesTable: SymbolTable;

    public addType(type: BscType) {
        this.types.push(type);
    }

    isResolvable(): boolean {
        for (const type of this.types) {
            if (!type.isResolvable()) {
                return false;
            }
        }
        return true;
    }

    private getMemberTypeFromInnerTypes(name: string, options: GetTypeOptions) {
        return this.types.map((innerType) => innerType?.getMemberType(name, options));
    }

    private getCallFuncFromInnerTypes(name: string, options: GetTypeOptions) {
        return this.types.map((innerType) => innerType?.getCallFuncType(name, options));
    }

    getMemberType(name: string, options: GetTypeOptions) {
        const innerTypesMemberTypes = this.getMemberTypeFromInnerTypes(name, options);
        if (!innerTypesMemberTypes || innerTypesMemberTypes.includes(undefined)) {
            // We don't have any members of any inner types that match
            // so instead, create reference type that will
            return new ReferenceType(name, name, options.flags, () => {
                return {
                    name: `UnionType MemberTable: '${this.__identifier}'`,
                    getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                        const referenceTypeInnerMemberTypes = this.getMemberTypeFromInnerTypes(name, options);
                        if (!referenceTypeInnerMemberTypes || referenceTypeInnerMemberTypes.includes(undefined)) {
                            return undefined;
                        }
                        return getUniqueType(findTypeUnion(referenceTypeInnerMemberTypes), unionTypeFactory);
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
        return getUniqueType(findTypeUnion(innerTypesMemberTypes), unionTypeFactory);
    }

    getCallFuncType(name: string, options: GetTypeOptions) {
        const innerTypesMemberTypes = this.getCallFuncFromInnerTypes(name, options);
        if (!innerTypesMemberTypes || innerTypesMemberTypes.includes(undefined)) {
            // We don't have any members of any inner types that match
            // so instead, create reference type that will
            return new ReferenceType(name, name, options.flags, () => {
                return {
                    name: `UnionType CallFunc MemberTable: '${this.__identifier}'`,
                    getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                        const referenceTypeInnerMemberTypes = this.getCallFuncFromInnerTypes(name, options);
                        if (!referenceTypeInnerMemberTypes || referenceTypeInnerMemberTypes.includes(undefined)) {
                            return undefined;
                        }
                        return getUniqueType(findTypeUnionDeepCheck(referenceTypeInnerMemberTypes), unionTypeFactory);
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
        const resultCallFuncType = getUniqueType(findTypeUnionDeepCheck(innerTypesMemberTypes), unionTypeFactory, false);


        if (isTypedFunctionType(resultCallFuncType)) {
            const typesToCheck = [...resultCallFuncType.params.map(p => p.type), resultCallFuncType.returnType];

            for (const type of typesToCheck) {
                addAssociatedTypesTableAsSiblingToMemberTable(type, this.callFuncAssociatedTypesTable, SymbolTypeFlag.runtime);
            }
        }
        return resultCallFuncType;
    }

    get returnType() {
        return util.getReturnTypeOfUnionOfFunctions(this);
    }


    isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData): boolean {
        if (isDynamicType(targetType) || isObjectType(targetType) || this === targetType) {
            return true;
        }
        if (isEnumTypeCompatible(this, targetType, data)) {
            return true;
        }
        if (isUnionType(targetType)) {
            // check if this set of inner types is a SUPERSET of targetTypes's inner types
            for (const targetInnerType of targetType.types) {
                if (!this.isTypeCompatible(targetInnerType, data)) {
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
        return joinTypesString(this.types, 'or', BscTypeKind.UnionType);
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
        if (!isUnionType(targetType)) {
            return false;
        }
        if (this === targetType) {
            return true;
        }

        if (this.types.length !== targetType.types.length) {
            return false;
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
        const unionTable = new SymbolTable(this.__identifier + ' UnionTable');
        const firstType = this.types[0];
        if (!firstType) {
            return unionTable;
        }
        firstType.addBuiltInInterfaces();
        for (const symbol of firstType.getMemberTable().getAllSymbols(SymbolTypeFlag.runtime)) {
            const foundType = this.getMemberTypeFromInnerTypes(symbol.name, { flags: SymbolTypeFlag.runtime });
            const allResolvableTypes = foundType.reduce((acc, curType) => {
                return acc && curType?.isResolvable();
            }, true);

            if (!allResolvableTypes) {
                continue;
            }
            const uniqueType = getUniqueType(findTypeUnion(foundType), unionTypeFactory);
            unionTable.addSymbol(symbol.name, {}, uniqueType, SymbolTypeFlag.runtime);
        }
        return unionTable;
    }
}


BuiltInInterfaceAdder.unionTypeFactory = (types: BscType[]) => {
    return new UnionType(types);
};
