import { SymbolTypeFlags } from '../SymbolTable';
import { isClassType, isDynamicType, isInterfaceType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { InheritableType } from './InheritableType';

export class ClassType extends InheritableType {

    constructor(public name: string, public readonly superClass?: BscType) {
        super(name, superClass);
    }

    public isAssignableTo(targetType: BscType) {
        //TODO: We need to make sure that things don't get assigned to built-in types
        if (this === targetType) {
            return true;
        } else if (isDynamicType(targetType) || isObjectType(targetType)) {
            return true;
        } else if (isClassType(targetType)) {
            const ancestorTypes = this.getAncestorTypeList();
            if (ancestorTypes?.find(ancestorType => ancestorType === targetType)) {
                return true;
            }
        } else if (isInterfaceType(targetType)) {
            return this.checkAssignabilityToInterface(targetType, SymbolTypeFlags.runtime);
        }
        return false;
    }
}
