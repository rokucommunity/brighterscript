import { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isObjectType, isUnionType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { InheritableType, isInheritableType } from './InheritableType';

export class InterfaceType extends InheritableType {
    public constructor(
        public name: string,
        public readonly superInterface?: BscType
    ) {
        super(name, superInterface);
    }

    public isAssignableTo(targetType: BscType) {
        //TODO: We need to make sure that things don't get assigned to built-in types
        if (this === targetType) {
            return true;
        }
        if (isObjectType(targetType) || isDynamicType(targetType)) {
            return true;
        } else if (isUnionType(targetType) && targetType.canBeAssignedFrom(this)) {
            return true;
        }
        const ancestorTypes = this.getAncestorTypeList();
        if (ancestorTypes?.find(ancestorType => ancestorType.equals(targetType))) {
            return true;
        }
        if (isInheritableType(targetType)) {
            return this.checkAssignabilityToInterface(targetType, SymbolTypeFlags.runtime);
        }
        return false;
    }

    equals(targetType: BscType): boolean {
        return this.isAssignableTo(targetType) && targetType.isAssignableTo(this);
    }
}
