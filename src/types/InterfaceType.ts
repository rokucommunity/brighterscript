import type { TypeCompatibilityData } from '../interfaces';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isCallFuncableTypeLike, isDynamicType, isInterfaceType, isInvalidType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import type { ReferenceType } from './ReferenceType';
import { CallFuncableType } from './CallFuncableType';

export class InterfaceType extends CallFuncableType {
    public constructor(
        public name: string,
        public readonly superInterface?: InterfaceType | ReferenceType
    ) {
        super(name, superInterface);
    }

    public readonly kind = BscTypeKind.InterfaceType;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        if (isInvalidType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)) {
            return true;
        }
        if (isCallFuncableTypeLike(targetType)) {
            return this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data) &&
                this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data, this.callFuncMemberTable, targetType.callFuncMemberTable);
        }

        const ancestorTypes = this.getAncestorTypeList();
        if (ancestorTypes?.find(ancestorType => ancestorType.isEqual(targetType))) {
            return true;
        }
        return this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data);
    }

    /**
     *  Is this the exact same interface as the target?
     */
    isEqual(targetType: BscType, data?: TypeCompatibilityData): boolean {
        return isInterfaceType(targetType) && super.isEqual(targetType, data);
    }
}
