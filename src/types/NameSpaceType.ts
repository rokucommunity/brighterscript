import type { SymbolTypeFlags } from '../SymbolTable';
import { isNamespaceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export class NamespaceType extends BscType {

    constructor(public name: string) {
        super(name);
    }

    public toString() {
        return this.name;
    }

    getMemberTypes(name: string, flags: SymbolTypeFlags) {
        return super.getMemberTypes(name, flags) ?? [new ReferenceType(name, flags, () => this.memberTable)];
    }

    isEqual(targetType: BscType): boolean {
        return isNamespaceType(targetType) && targetType.name === this.name;
    }

}
