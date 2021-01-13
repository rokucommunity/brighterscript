import type { BscType } from './BscType';

export class DynamicType implements BscType {
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
        return 'dynamic';
    }

    public toTypeString(): string {
        return this.toString();
    }
}
