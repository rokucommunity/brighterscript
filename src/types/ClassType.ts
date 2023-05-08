import { isClassType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { InheritableType } from './InheritableType';

export class ClassType extends InheritableType {

    constructor(public name: string, public readonly superClass?: BscType) {
        super(name, superClass);
    }

    public isTypeCompatible(targetType: BscType) {
        if (this.isEqual(targetType)) {
            return true;
        } else if (isDynamicType(targetType)) {
            return true;
        } else if (isClassType(targetType)) {
            // Check if this is an ancestor of targetType
            const targetAncestorTypes = targetType.getAncestorTypeList();
            if (targetAncestorTypes?.find(ancestorType => ancestorType.isEqual(this))) {
                return true;
            }
        }
        return false;
    }

    isEqual(targetType: BscType): boolean {
        return isClassType(targetType) && this.name === targetType.name;
    }
}
