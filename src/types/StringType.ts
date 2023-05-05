import { isDynamicType, isStringType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class StringType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    /**
     * A static instance that can be used to reduce memory and constructor costs, since there's nothing unique about this
     */
    public static instance = new StringType('string');

    public isTypeCompatible(targetType: BscType) {
        return (
            isStringType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return this.typeText ?? 'string';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isStringType(targetType);
    }
}
