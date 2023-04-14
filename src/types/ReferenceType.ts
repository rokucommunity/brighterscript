import type { SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlags } from '../SymbolTable';
import type { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ReferenceType implements BscType {
    constructor(public name: string, private tableProvider: SymbolTableProvider) {
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: (target, propName, receiver) => {

                if (propName === '__reflection') {
                    // Cheeky way to get `isReferenceType` reflection to work
                    return { name: 'ReferenceType' };
                }
                //There may be some need to specifically get members on ReferenceType in the future
                // eg: if (Reflect.has(target, name)) {
                //   return Reflect.get(target, propName, receiver);

                // Look for circular references
                let innerType = this.resolve();
                if (this.referenceChain.has(innerType)) {
                    innerType = DynamicType.instance;
                }
                this.referenceChain.add(innerType);
                const result = Reflect.get(innerType, propName, innerType);
                this.referenceChain.clear();
                return result;
            },
            set: (target, name, value, receiver) => {
                //There may be some need to specifically set members on ReferenceType in the future
                // eg: if (Reflect.has(target, name)) {
                //   return Reflect.set(target, name, value, receiver);

                // Look for circular references
                let innerType = this.resolve();
                if (this.referenceChain.has(innerType)) {
                    innerType = DynamicType.instance;
                }
                const result = Reflect.set(innerType, name, value, innerType);
                this.referenceChain.clear();
                return result;
            }
        });

    }

    /**
     * Resolves the type based on the original name and the table provider
     */
    private resolve(): BscType {
        // eslint-disable-next-line no-bitwise
        return this.tableProvider()?.getSymbol(this.name, SymbolTypeFlags.runtime | SymbolTypeFlags.typetime)?.[0]?.type ?? DynamicType.instance;
    }

    public isAssignableTo(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }

    public isConvertibleTo(targetType: BscType): boolean {
        throw new Error('Method not implemented.');
    }

    public toString(): string {
        throw new Error('Method not implemented.');
    }

    public toTypeString(): string {
        throw new Error('Method not implemented.');
    }

    private referenceChain = new Set<BscType>();
}
