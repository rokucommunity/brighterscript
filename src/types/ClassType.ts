import { SymbolTypeFlags } from '../SymbolTable';
import { isClassType, isDynamicType, isInterfaceType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { InheritableType } from './InheritableType';
import type { ReferenceType } from './ReferenceType';

export class ClassType extends InheritableType {

    constructor(public name: string, public readonly superClass?: ClassType | ReferenceType) {
        super(name, superClass);
    }

    public isAssignableTo(targetType: BscType) {
        if (isClassType(targetType) && targetType.name === this.name) {
            return true;
        } else if (isDynamicType(targetType) || isObjectType(targetType)) {
            return true;
        } else if (isInterfaceType(targetType)) {
            return this.checkAssignabilityToInterface(targetType, SymbolTypeFlags.runtime);
        } else {
            const ancestorTypes = this.getAncestorTypeList();
            if (ancestorTypes?.find(ancestorType => ancestorType.equals(targetType))) {
                return true;
            }
            return false;
        }
    }

    public equals(targetType: BscType): boolean {
        return isClassType(targetType) && this.toString() === targetType?.toString();
    }
}
