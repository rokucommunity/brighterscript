import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class VoidType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof VoidType ||
            targetType instanceof DynamicType
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
}
