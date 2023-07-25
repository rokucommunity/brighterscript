import { isDoubleType, isDynamicType, isFloatType, isIntegerType, isLongIntegerType, isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';

export class LongIntegerType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.LongIntegerType;

    public static instance = new LongIntegerType('longinteger');

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
        return this.typeText ?? 'longinteger';
    }

    public toTypeString(): string {
        return this.toString();
    }

    isEqual(targetType: BscType): boolean {
        return isLongIntegerType(targetType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        //TODO: this should really add the appropriate interface methods from roku-types
        return DynamicType.instance;
    }
}
