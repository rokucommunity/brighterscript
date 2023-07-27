import { isDynamicType, isObjectType, isVoidType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';

export class VoidType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public readonly kind = BscTypeKind.VoidType;

    public static instance = new VoidType('void');

    public isTypeCompatible(targetType: BscType) {
        return (
            isVoidType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType)
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
}

BuiltInInterfaceAdder.primitiveTypeInstanceCache.set('void', VoidType.instance);
