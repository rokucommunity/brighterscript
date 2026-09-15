import { isDynamicType, isObjectType, isStringTypeLike } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isEnumTypeCompatible, isNativeInterfaceCompatible, isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

export class StringType extends BscType {

    public readonly kind = BscTypeKind.StringType;

    public isBuiltIn = true;
    /**
     * A static instance that can be used to reduce memory and constructor costs, since there's nothing unique about this
     */
    public static instance = new StringType();

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isStringTypeLike(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data) ||
            isEnumTypeCompatible(this, targetType, data) ||
            isNativeInterfaceCompatible(this, targetType, 'rostring', data)
        );
    }

    public toString() {
        return 'string';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isStringTypeLike(targetType);
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('string', StringType.instance);
