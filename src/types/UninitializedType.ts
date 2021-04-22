import { isUninitializedType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class UninitializedType implements BscType {

    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor() { }

    public isAssignableTo(targetType: BscType) {
        return (
            isUninitializedType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return 'uninitialized';
    }


    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isUninitializedType(targetType);
    }
}
