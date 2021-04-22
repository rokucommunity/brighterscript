import { isVoidType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class VoidType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            isVoidType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'void';
    }


    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isVoidType(targetType);
    }
}
