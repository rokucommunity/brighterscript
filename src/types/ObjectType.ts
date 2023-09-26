import { SymbolTypeFlag } from '../SymbolTable';
import { isObjectType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import { DynamicType } from './DynamicType';

export class ObjectType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.ObjectType;

    public isTypeCompatible(targetType: BscType) {
        //Brightscript allows anything passed "as object", so as long as a type is provided, this is true
        return !!targetType;
    }

    public toString() {
        return this.typeText ?? 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }

    getMemberType(name: string, options: GetTypeOptions) {
        // TODO: How should we handle accessing properties of an object?
        // For example, we could add fields as properties to m.top, but there could be other members added programmatically
        return super.getMemberType(name, options) ?? DynamicType.instance;
    }

    isEqual(otherType: BscType) {
        return isObjectType(otherType) && this.checkCompatibilityBasedOnMembers(otherType, SymbolTypeFlag.runtime);
    }
}


BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('object', new ObjectType('object'));
