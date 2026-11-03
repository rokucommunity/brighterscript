import type { TypeCompatibilityData } from '../interfaces';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isArrayTypeLike, isAssociativeArrayTypeLike, isCallFuncableTypeLike, isDynamicType, isInterfaceType, isInvalidType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import type { ReferenceType } from './ReferenceType';
import { CallFuncableType } from './CallFuncableType';

/**
 * The built-in objects that can be stored in a SceneGraph field, and the field type they're stored as
 */
const builtInSceneGraphTypes: Record<string, string> = {
    roassociativearray: 'assocarray',
    roarray: 'array',
    rostring: 'string',
    roint: 'integer',
    rolonginteger: 'longinteger',
    rofloat: 'float',
    roboolean: 'boolean'
};

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
        if (isAssociativeArrayTypeLike(this) && isAssociativeArrayTypeLike(targetType)) {
            return true;
        }
        if (isArrayTypeLike(this) && isArrayTypeLike(targetType)) {
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

    public toSceneGraphTypeString() {
        //interfaces describe associative arrays, but built-in ones (i.e. `roDateTime`) are native objects that can't be stored in fields
        if (!this.isBuiltIn) {
            return 'assocarray';
        }
        return builtInSceneGraphTypes[this.name.toLowerCase()];
    }

    /**
     *  Is this the exact same interface as the target?
     */
    isEqual(targetType: BscType, data?: TypeCompatibilityData): boolean {
        return isInterfaceType(targetType) && super.isEqual(targetType, data);
    }
}
