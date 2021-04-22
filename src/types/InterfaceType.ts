import { isDynamicType, isInterfaceType } from '../astUtils';
import type { BscType } from './BscType';

export class InterfaceType implements BscType {
    public isAssignableTo(targetType: BscType) {
        return (
            isInterfaceType(targetType) ||
            isDynamicType(targetType)
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

    public equals(targetType: BscType): boolean {
        return isInterfaceType(targetType);
    }
}
