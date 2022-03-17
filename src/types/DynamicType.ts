import { isDynamicType } from '../astUtils/reflection';
import type { BscType } from './BscType';

export class DynamicType implements BscType {
    constructor(
        public typeText?: string
    ) { }

    public isAssignableTo(targetType: BscType) {
        //everything can be dynamic, so as long as a type is provided, this is true
        return !!targetType;
    }

    /**
     * The dynamic type is convertible to everything.
     * @param targetType
     */
    public isConvertibleTo(targetType: BscType) {
        //everything can be dynamic, so as long as a type is provided, this is true
        return !!targetType;
    }

    public toString() {
        return this.typeText ?? 'dynamic';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public equals(targetType: BscType): boolean {
        return isDynamicType(targetType);
    }
}
