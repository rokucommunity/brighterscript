import type { BrsType } from './BrsType';

export class DynamicType implements BrsType {
    public isAssignableTo(targetType: BrsType) {
        //everything can be dynamic, so as long as a type is provided, this is true
        return !!targetType;
    }

    /**
     * The dynamic type is convertible to everything.
     * @param targetType
     */
    public isConvertibleTo(targetType: BrsType) {
        //everything can be dynamic, so as long as a type is provided, this is true
        return !!targetType;
    }

    public toString() {
        return 'dynamic';
    }
}
