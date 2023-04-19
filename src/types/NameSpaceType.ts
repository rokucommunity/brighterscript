import { BscType } from './BscType';
import { ReferenceType } from './ReferenceType';

export class NamespaceType extends BscType {

    constructor(public name: string) {
        super(name);
    }

    public toString() {
        return this.name;
    }

    getMemberType(name: string) {
        return super.getMemberType(name) ?? new ReferenceType(name, () => this.symbolTable);
    }
}
