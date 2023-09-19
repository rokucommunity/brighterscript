import type { TypeCompatibilityData } from '..';
import { SymbolTypeFlag } from '../SymbolTable';
import { isDynamicType, isInterfaceType, isUnionType, isInheritableType, isObjectType, isAssociativeArrayType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { InheritableType } from './InheritableType';
import { isUnionTypeCompatible } from './helpers';

export class InterfaceType extends InheritableType {
    public constructor(
        public name: string,
        public readonly superInterface?: BscType
    ) {
        super(name, superInterface);
    }

    public readonly kind = BscTypeKind.InterfaceType;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (isDynamicType(targetType) || isObjectType(targetType) || isUnionTypeCompatible(this, targetType, data)) {
            return true;
        }
        if (isAssociativeArrayType(targetType) && this.name.toLowerCase() === 'roassociativearray') {
            return true;
        }
        //TODO: We need to make sure that things don't get assigned to built-in types
        if (this.isEqual(targetType)) {
            return true;
        }
        const ancestorTypes = this.getAncestorTypeList();
        if (ancestorTypes?.find(ancestorType => ancestorType.isEqual(targetType))) {
            return true;
        }
        if (isInheritableType(targetType) || isUnionType(targetType) || isAssociativeArrayType(targetType)) {
            return this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data);
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
