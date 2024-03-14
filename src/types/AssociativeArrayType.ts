import { SymbolTable } from '../SymbolTable';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isAssociativeArrayType, isClassType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';
import { isUnionTypeCompatible } from './helpers';

export class AssociativeArrayType extends BscType {


    public readonly kind = BscTypeKind.AssociativeArrayType;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (isDynamicType(targetType)) {
            return true;
        } else if (isObjectType(targetType)) {
            return true;
        } else if (isUnionTypeCompatible(this, targetType)) {
            return true;
        } else if (isAssociativeArrayType(targetType)) {
            return true;
        } else if (this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data)) {
            return true;
        } else if (isClassType(targetType)) {
            return true;
        }
        return false;
    }

    public toString() {
        return 'roAssociativeArray';
    }

    public toTypeString(): string {
        return 'object';
    }

    getMemberType(name: string, options: GetTypeOptions) {
        // if a member has specifically been added, cool. otherwise, assume dynamic
        return super.getMemberType(name, options) ?? DynamicType.instance;
    }

    isEqual(otherType: BscType) {
        return isAssociativeArrayType(otherType) && this.checkCompatibilityBasedOnMembers(otherType, SymbolTypeFlag.runtime);
    }

    private builtInMemberTable: SymbolTable;

    getBuiltInMemberTable(): SymbolTable {
        if (this.builtInMemberTable) {
            return this.builtInMemberTable;
        }
        this.builtInMemberTable = new SymbolTable(`${this.__identifier} Built-in Members`);
        this.pushMemberProvider(() => this.builtInMemberTable);
        return this.builtInMemberTable;

    }
}
