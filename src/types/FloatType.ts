import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';
import { isUnionTypeCompatible } from './helpers';

export class FloatType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.FloatType;

    public static instance = new FloatType('float');

    public isTypeCompatible(targetType: BscType) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType) ||
            isUnionTypeCompatible(this, targetType)
        );

    }

    public toString() {
        return this.typeText ?? 'float';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType): boolean {
        return isFloatType(targetType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        //TODO: this should really add the appropriate interface methods from roku-types
        return DynamicType.instance;
    }
}
