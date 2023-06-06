import { isClassType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { InheritableType } from './InheritableType';

export class ClassType extends InheritableType {

    constructor(public name: string, public readonly superClass?: BscType) {
        super(name, superClass);
    }

    public readonly kind = BscTypeKind.ClassType;

    public isTypeCompatible(targetType: BscType) {
        if (this.isEqual(targetType)) {
            return true;
        } else if (isDynamicType(targetType)) {
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
