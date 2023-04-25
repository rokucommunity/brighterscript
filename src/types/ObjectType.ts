import type { SymbolTypeFlags } from '../SymbolTable';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ObjectType extends BscType {
    constructor(
        public typeText?: string
    ) {
        super();
    }

    public isAssignableTo(targetType: BscType) {
        return (
            targetType instanceof ObjectType ||
            targetType instanceof DynamicType
        );
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }

    public toString() {
        return this.typeText ?? 'object';
    }

    public toTypeString(): string {
        return this.toString();
    }

    getMemberType(name: string, flags: SymbolTypeFlags) {
        // An object can only have runtime members
        return super.getMemberType(name, flags) ?? DynamicType.instance;
    }
}
