import { isNeverType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';

/**
 * The type of a value that can never exist (the empty type).
 * This is what's left after every possible type has been narrowed away, so it is assignable to every other type,
 * but no other type is assignable to it.
 */
export class NeverType extends BscType {

    public readonly kind = BscTypeKind.NeverType;

    public static instance = new NeverType();

    public isBuiltIn = true;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        return isNeverType(targetType);
    }

    public toString() {
        return 'never';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType) {
        return isNeverType(targetType);
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        return NeverType.instance;
    }

    getCallFuncType(name: string, options: GetTypeOptions) {
        return NeverType.instance;
    }

    get returnType() {
        return NeverType.instance;
    }
}
