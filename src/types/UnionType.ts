import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isDynamicType, isObjectType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';
import { findTypeUnion, getUniqueType, isEnumTypeCompatible } from './helpers';
import { BscTypeKind } from './BscTypeKind';
import type { TypeCacheEntry } from '../SymbolTable';
import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';

export function unionTypeFactory(types: BscType[]) {
    return new UnionType(types);
}

export class UnionType extends BscType {
    constructor(
        public types: BscType[]
    ) {
        super(joinTypesString(types));
    }

    public readonly kind = BscTypeKind.UnionType;

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
                        if (!innerTypesMemberTypes || innerTypesMemberTypes.includes(undefined)) {
                            return undefined;
                        }
                        return getUniqueType(findTypeUnion(referenceTypeInnerMemberTypes), unionTypeFactory);
                    },
                    setCachedType: (innerName: string, innerCacheEntry: TypeCacheEntry, innerOptions: GetTypeOptions) => {
                        // TODO: is this even cachable? This is a NO-OP for now, and it shouldn't hurt anything
                    }
                };
            });
        }
        return getUniqueType(findTypeUnion(innerTypesMemberTypes), unionTypeFactory);
    }

    isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData): boolean {
        if (isDynamicType(targetType) || isObjectType(targetType)) {
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
        return joinTypesString(this.types);
    }
    toTypeString(): string {
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
        return this.isTypeCompatible(targetType) && targetType.isTypeCompatible(this);
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


function joinTypesString(types: BscType[]) {
    return types.map(t => t.toString()).join(' or ');
}

BuiltInInterfaceAdder.unionTypeFactory = (types: BscType[]) => {
    return new UnionType(types);
};
