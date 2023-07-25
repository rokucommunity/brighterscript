import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';

export class IntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.IntegerType;

    public static instance = new IntegerType('integer');

    public isTypeCompatible(targetType: BscType) {
        return (
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isIntegerType(targetType) ||
            isFloatType(targetType) ||
            isDoubleType(targetType) ||
            isLongIntegerType(targetType)
        );
    }

    public toString() {
        return this.typeText ?? 'integer';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(otherType: BscType) {
        return isIntegerType(otherType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        //TODO: this should really add the appropriate interface methods from roku-types
        return DynamicType.instance;
    }
}
