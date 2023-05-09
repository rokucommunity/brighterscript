import type { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';
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

    getMemberTypes(name: string, flags: SymbolTypeFlags) {
        const innerTypesMemberTypes = this.types.map((innerType) => innerType?.getMemberTypes(name, flags));
        for (const types of innerTypesMemberTypes) {
            if (!types || types.length === 0) {
                return;
            } else if (types.find((t => !t.isResolvable()))) {
                // this inner type has an unresolvable member --- therefore this member is not defined for all inner types
                return;
            }
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
    return types.map(t => t.toString()).join(' | ');
}

