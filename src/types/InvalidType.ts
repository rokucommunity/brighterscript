import { isDynamicType, isInvalidType, isObjectType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';

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
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType)
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

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('invalid', InvalidType.instance);
