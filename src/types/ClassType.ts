import type { SymbolTypeFlags } from '../SymbolTable';
import { isClassType, isDynamicType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export class ClassType extends BscType {

    constructor(public name: string) {
        super(name);
    }

    getMemberType(name: string, flags: SymbolTypeFlags) {
        return super.getMemberType(name, flags) ?? new ReferenceType(name, flags, () => this.memberTable);
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    public isAssignableTo(targetType: BscType) {
        //TODO for now, if the custom types have the same name, assume they're the same thing
        if (isClassType(targetType) && targetType.name === this.name) {
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
