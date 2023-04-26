import type { SymbolTypeFlags } from '../SymbolTable';
import { isObjectType } from '../astUtils/reflection';
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
        // TODO: How should we handle accessing properties of an object?
        // For example, we could add fields as properties to m.top, but there could be other members added programmatically
        return super.getMemberType(name, flags) ?? DynamicType.instance;
    }

    public equals(targetType: BscType): boolean {
        return isObjectType(targetType) && this.isAssignableTo(targetType);
    }
}
