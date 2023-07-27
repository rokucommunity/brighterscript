import { isBooleanType, isDynamicType, isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';
import { isUnionTypeCompatible } from './helpers';

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
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType)
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

    getMemberType(memberName: string, options: GetTypeOptions) {
        //TODO: this should really add the appropriate interface methods from roku-types
        return DynamicType.instance;
    }
}
