import type { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isUnionType } from '../astUtils/reflection';
import { BscType } from './BscType';

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

    getMemberTypes(name: string, flags: SymbolTypeFlags) {
        return [];
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
            console.log((targetType as any).__identifier, ` is${foundCompatibleInnerType ? ' ' : ' not '}compatible with `, (innerType as any).__identifier);
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
}


function joinTypesString(types: BscType[]) {
    return types.map(t => t.toString()).join(' | ');
}

