import { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isInterfaceType, isUnionType, isInheritableType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { InheritableType } from './InheritableType';

export class InterfaceType extends InheritableType {
    public constructor(
        public name: string,
        public readonly superInterface?: BscType
    ) {
        super(name, superInterface);
    }

    public readonly kind = BscTypeKind.InterfaceType;

    public isTypeCompatible(targetType: BscType) {
        //TODO: We need to make sure that things don't get assigned to built-in types
        if (this.isEqual(targetType)) {
            return true;
        }
        if (isDynamicType(targetType)) {
            return true;
        }
        const ancestorTypes = this.getAncestorTypeList();
        if (ancestorTypes?.find(ancestorType => ancestorType.isEqual(targetType))) {
            return true;
        }
        if (isInheritableType(targetType) || isUnionType(targetType)) {
            return this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlags.runtime);
        }
        return false;
    }

    /**
     *  Is this the exact same interface as the target?
     */
    isEqual(targetType: BscType): boolean {
        return isInterfaceType(targetType) && this.name.toLowerCase() === targetType.name.toLowerCase();
    }
}
