import type { SymbolTypeFlags } from '../SymbolTable';
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

}
