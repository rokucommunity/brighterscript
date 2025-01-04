import { isDynamicType, isObjectType, isVoidType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { DynamicType } from './DynamicType';

export class VoidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.VoidType;

    public static instance = new VoidType('void');

    public isBuiltIn = true;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return (
            isVoidType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)
        );
    }

    public toString() {
        return this.typeText ?? 'void';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType) {
        return isVoidType(targetType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        return DynamicType.instance;
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('void', VoidType.instance);
