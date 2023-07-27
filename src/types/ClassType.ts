import { isClassType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { InheritableType } from './InheritableType';
import { isUnionTypeCompatible } from './helpers';

export class ClassType extends InheritableType {

    constructor(public name: string, public readonly superClass?: BscType) {
        super(name, superClass);
    }

    public readonly kind = BscTypeKind.ClassType;

    public isTypeCompatible(targetType: BscType) {
        if (this.isEqual(targetType)) {
            return true;
        } else if (isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType)) {
            return true;
        } else if (isClassType(targetType)) {
            return this.isTypeDescendent(targetType);
        }
        return false;
    }

    isEqual(targetType: BscType): boolean {
        return isClassType(targetType) && this.name.toLowerCase() === targetType.name.toLowerCase();
    }
}
