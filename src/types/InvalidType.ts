import { isDynamicType, isInvalidType } from '../astUtils/reflection';
import { BscType } from './BscType';

export class InvalidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public isTypeCompatible(targetType: BscType) {
        return (
            isInvalidType(targetType) ||
            isDynamicType(targetType)
        );
    }

    public toString() {
        return this.typeText ?? 'invalid';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isInvalidType(targetType);
    }
}
