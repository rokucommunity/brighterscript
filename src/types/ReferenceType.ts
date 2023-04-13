import type { SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlags } from '../SymbolTable';
import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ReferenceType implements BscType {
    constructor(
        public name: string,
        private tableProvider: SymbolTableProvider
    ) { }

    public isAssignableTo(targetType: BscType) {
        return this.resolve()?.isAssignableTo(targetType);
    }

    public isConvertibleTo(targetType: BscType) {
        return this.resolve()?.isConvertibleTo(targetType);
    }

    public toString() {
        return this.resolve()?.toString();
    }

    public toTypeString(): string {
        return this.resolve()?.toTypeString();
    }

    /**
     * Resolves the type based on the original name and the table provider
     * Is public because there are situation when we may want to know if the resolved type is a function/class, etc.
     */
    public resolve(): BscType {
        // eslint-disable-next-line no-bitwise
        return this.tableProvider()?.getSymbol(this.name, SymbolTypeFlags.runtime | SymbolTypeFlags.typetime)?.[0]?.type ?? DynamicType.instance;
    }
}
