import { isBooleanType, isDynamicType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class BooleanType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.BooleanType;

    public static instance = new BooleanType('boolean');

    public isTypeCompatible(targetType: BscType) {
        return (
            isBooleanType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType)
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
