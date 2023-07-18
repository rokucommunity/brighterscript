import { isDynamicType, isEnumMemberType, isEnumType, isObjectType, isStringType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class StringType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.StringType;

    /**
     * A static instance that can be used to reduce memory and constructor costs, since there's nothing unique about this
     */
    public static instance = new StringType('string');

    public isTypeCompatible(targetType: BscType) {
        return (
            isStringType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            //string enums are compatible with strings
            (
                (isEnumType(targetType) || isEnumMemberType(targetType)) && isStringType(targetType.underlyingType)
            )
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
