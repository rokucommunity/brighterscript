import { isDynamicType, isUninitializedType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class UninitializedType extends BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof UninitializedType ||
            targetType instanceof DynamicType
        );
    }

    public isTypeCompatible(targetType: BscType) {
        return (
            isUninitializedType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return 'uninitialized';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isUninitializedType(targetType);
    }
}
