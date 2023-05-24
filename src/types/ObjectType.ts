import { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isInheritableType, isObjectType, isUnionType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ObjectType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public isTypeCompatible(targetType: BscType) {
        if (isUnionType(targetType)) {
            return targetType.checkAllMemberTypes((type) => type.isTypeCompatible(this));
        } else if (isObjectType(targetType) ||
            isDynamicType(targetType) ||
            isInheritableType(targetType)
        ) {
            return true;
        }
        return false;
    }

    public toString() {
        return this.typeText ?? 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }

    getMemberType(name: string, options: GetTypeOptions) {
        // TODO: How should we handle accessing properties of an object?
        // For example, we could add fields as properties to m.top, but there could be other members added programmatically
        return super.getMemberType(name, options) ?? DynamicType.instance;
    }

    isEqual(otherType: BscType) {
        return isObjectType(otherType) && this.checkCompatibilityBasedOnMembers(otherType, SymbolTypeFlags.runtime);
    }
}
