import { isCustomType, isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class CustomType implements BscType {

    constructor(public name: string) {
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'object';
    }

    public isAssignableTo(targetType: BscType) {
        //TODO for now, if the custom types have the same name, assume they're the same thing
        if (isCustomType(targetType) && targetType.name === this.name) {
            return true;
        } else if (isDynamicType(targetType)) {
            return true;
        } else {
            return false;
        }
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }
}
