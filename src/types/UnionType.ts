import type { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';
import { findTypeUnion } from './helpers';

export class UnionType extends BscType {
    constructor(
        public types: BscType[]
    ) {
        super(joinTypesString(types));
    }

    public addType(type: BscType) {
        this.types.push(type);
    }

    private getMemberTypesFromInnerTypes(name: string, flags: SymbolTypeFlags) {
        return this.types.map((innerType) => innerType?.getMemberTypes(name, flags));
    }

    getMemberTypes(name: string, flags: SymbolTypeFlags) {
        const innerTypesMemberTypes = this.getMemberTypesFromInnerTypes(name, flags);
        if (!innerTypesMemberTypes) {
            // We don't have any members of any inner types that match
            // so instead, create reference type that will
            return [new ReferenceType(name, flags, () => {
                return {
                    getSymbolTypes: (innerName: string, innerFlags: SymbolTypeFlags) => {
                        return findTypeUnion(...this.getMemberTypesFromInnerTypes(name, flags));
                    }
                };
            })];
        }
        return findTypeUnion(...innerTypesMemberTypes);
    }

    isTypeCompatible(targetType: BscType): boolean {
        if (isDynamicType(targetType)) {
            return true;
        }
        if (isUnionType(targetType)) {
            // check if this set of inner types is a SUPERSET of targetTypes's inner types
            for (const targetInnerType of targetType.types) {
                if (!this.isTypeCompatible(targetInnerType)) {
                    return false;
                }
            }
            return true;
        }
        for (const innerType of this.types) {
            const foundCompatibleInnerType = innerType.isTypeCompatible(targetType);
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
}


function joinTypesString(types: BscType[]) {
    return types.map(t => t.toString()).join(' or ');
}

