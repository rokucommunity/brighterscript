import { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { ReferenceType } from './ReferenceType';

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

    getMemberType(name: string) {
        return super.getMemberType(name) ?? new ReferenceType(name, () => this.memberTable);
    }
}
