import { isBooleanType, isDynamicType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class BooleanType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public static instance = new BooleanType('boolean');

    public isTypeCompatible(targetType: BscType) {
        return (
            isBooleanType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return this.typeText ?? 'boolean';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isBooleanType(targetType);
    }
}
