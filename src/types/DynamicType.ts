import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isDynamicType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';

export class DynamicType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.DynamicType;

    public static readonly instance = new DynamicType();

    get returnType() {
        return DynamicType.instance;
    }

    public isAssignableTo(targetType: BscType) {
        //everything can be dynamic, so as long as a type is provided, this is true
        return !!targetType;
    }

    /**
     * The dynamic type is convertible to everything.
     */
    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        //everything can be dynamic, so as long as a type is provided, this is true
        return !!targetType;
    }

    public toString() {
        return this.typeText ?? 'dynamic';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType) {
        return isDynamicType(targetType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        return DynamicType.instance;
    }
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('dynamic', DynamicType.instance);
