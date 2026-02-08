import type { TypeCompatibilityData } from '../interfaces';
import { isDynamicType, isTypeStatementType, isUninitializedType, isVoidType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { GetSymbolTypeOptions } from '../SymbolTable';

export class DynamicType extends BscType {

    public readonly kind = BscTypeKind.DynamicType;

    public static readonly instance = new DynamicType();

    public isBuiltIn = true;

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
        if (isVoidType(targetType) || isUninitializedType(targetType)) {
            return false;
        }
        return !!targetType;
    }

    public toString() {
        return 'dynamic';
    }

    public toTypeString(): string {
        return this.toString();
    }

    public isEqual(targetType: BscType) {
        while (isTypeStatementType(targetType)) {
            targetType = targetType.wrappedType;
        }
        return isDynamicType(targetType);
    }

    getMemberType(memberName: string, options: GetSymbolTypeOptions) {
        return DynamicType.instance;
    }

    getCallFuncType(name: string, options: GetSymbolTypeOptions) {
        return DynamicType.instance;
    }


}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('dynamic', DynamicType.instance);
