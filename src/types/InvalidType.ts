import { isDynamicType, isInvalidTypeLike, isObjectType } from '../astUtils/reflection';
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

    public isBuiltIn = true;

    public isTypeCompatible(targetType: BscType) {
        return (
            isInvalidTypeLike(targetType) ||
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
        return isInvalidTypeLike(targetType);
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('invalid', InvalidType.instance);
