import { isDynamicType, isInvalidType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class InvalidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.InvalidType;

    public static instance = new InvalidType('invalid');

    public isTypeCompatible(targetType: BscType) {
        return (
            isInvalidType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType)
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
