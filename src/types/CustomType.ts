import { isCustomType, isDynamicType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export class CustomType extends BscType {

    constructor(public name: string) {
        super(name);
    }

    getMemberType(name: string) {
        return super.getMemberType(name) ?? new ReferenceType(name, () => this.symbolTable);
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'object';
    }

    public isAssignableTo(targetType: BscType) {
        //TODO for now, if the custom types have the same name, assume they're the same thing
        if (isCustomType(targetType) && targetType.name === this.name) {
            return true;
        } else if (isDynamicType(targetType)) {
            return true;
        } else {
            return false;
        }
    }

    public isConvertibleTo(targetType: BscType) {
        return this.isAssignableTo(targetType);
    }
}
