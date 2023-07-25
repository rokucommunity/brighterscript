import { isDynamicType, isEnumMemberType, isEnumType, isObjectType, isStringType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';

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

    getMemberType(memberName: string, options: GetTypeOptions) {
        //TODO: this should really add the appropriate interface methods from roku-types
        return DynamicType.instance;
    }
}
