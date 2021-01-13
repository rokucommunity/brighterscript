import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class InterfaceType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof InterfaceType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        //TODO make this match the actual interface of the object
        return 'interface';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
