import { isNamespaceType } from '../astUtils/reflection';
import type { GetTypeOptions } from '../interfaces';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';

export class NamespaceType extends BscType {

    constructor(public name: string) {
        super(name);
    }

    public readonly kind = BscTypeKind.NamespaceType;

    public toString() {
        return this.name;
    }

    getMemberType(name: string, options: GetTypeOptions) {
        const fullName = this.toString() + '.' + name;
        return super.getMemberType(name, { ...options, fullName: fullName, tableProvider: () => this.memberTable });
    }

    isEqual(targetType: BscType): boolean {
        return isNamespaceType(targetType) && targetType.name === this.name;
    }

}
