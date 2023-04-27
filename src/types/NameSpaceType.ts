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

    getMemberType(name: string, flags: SymbolTypeFlags) {
        return super.getMemberType(name, flags) ?? new ReferenceType(name, flags, () => this.memberTable);
    }

}
