import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { DynamicType } from './DynamicType';

export class ObjectType extends BscType {

    public readonly kind = BscTypeKind.ObjectType;

    public isBuiltIn = true;

    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        //Brightscript allows anything passed "as object", so as long as a type is provided, this is true
        return !!targetType;
    }

    public static instance = new ObjectType();

    public toString() {
        return 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }

    getMemberType(name: string, options: GetTypeOptions) {
        if (options.ignoreDefaultDynamicMembers) {
            return undefined;
        }
        return DynamicType.instance;
    }

    isEqual(otherType: BscType) {
        return isObjectType(otherType) && this.checkCompatibilityBasedOnMembers(otherType, SymbolTypeFlag.runtime);
    }

    get returnType() {
        return DynamicType.instance;
    }
}


BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('object', ObjectType.instance);
