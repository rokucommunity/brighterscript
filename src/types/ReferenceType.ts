import type { SymbolTableProvider } from '../SymbolTable';
import { SymbolTypeFlags } from '../SymbolTable';
import { isReferenceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';

export class ReferenceType extends BscType {
    constructor(public name: string, private tableProvider: SymbolTableProvider) {
        super(name);
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

                let innerType = this.resolve();

                if (!innerType) {
                    // No real BscType found - we may need to handle some specific cases

                    if (propName === 'getMemberType') {
                        // We're looking for a member of a reference type
                        // Since we don't know what type this is, yet, return ReferenceType
                        return (memberName: string, flags: SymbolTypeFlags) => {
                            return new ReferenceType(memberName, () => {
                                return (this.resolve() as any)?.symbolTable;
                            });
                        };
                    } else if (propName === 'toString') {
                        // This type was never found
                        // For diagnostics, we should return the expected name of of the type
                        return () => this.name;
                    } else if (propName === 'toTypeString') {
                        // For transpilation, we should 'dynamic'
                        return () => 'dynamic';
                    } else if (propName === 'returnType') {
                        return new PropertyReferenceType(this, propName);
                    }
                }

                // Look for circular references
                if (!innerType || this.referenceChain.has(innerType)) {
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

                let innerType = this.resolve();

                // Look for circular references
                if (!innerType || this.referenceChain.has(innerType)) {
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
        return this.tableProvider()?.getSymbol(this.name, SymbolTypeFlags.runtime | SymbolTypeFlags.typetime)?.[0]?.type;
    }

    private referenceChain = new Set<BscType>();
}

/**
 * Use this class for when you need to reference a property of a BscType, and that property is also a BscType,
 * Especially when the instance with the property may not have been instantiated/discovered yet
 *
 * For Example, FunctionType.returnType --- if the FunctionExpression has not been walked yet, it will be a ReferenceType
 * if we just access .returnType on a ReferenceType that doesn't have access to an actual FunctionType yet, .returnType will be undefined
 * So when we use this class, it maintains that reference to a potential ReferenceType, and this class will change from
 * returning undefined to the ACTUAL .returnType when the ReferenceType can be resolved.
 *
 * This is really cool. It's like programming with time-travel.
 */
export class PropertyReferenceType extends BscType {
    constructor(public outerType: BscType, public propertyName: string) {
        super(propertyName);
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: (target, propName, receiver) => {

                if (propName === '__reflection') {
                    // Cheeky way to get `isPropertyReferenceType` reflection to work
                    return { name: 'PropertyReferenceType' };
                }

                if (isReferenceType(this.outerType)) {
                    if (propName === 'getMemberType') {
                        //If we're calling `getMemberType()`, we need it to proxy to using the actual symbol table
                        //So if that symbol is ever populated, the correct type is passed through
                        return (memberName: string, flags: SymbolTypeFlags) => {
                            return new ReferenceType(memberName, () => {
                                return (this.outerType[this.propertyName] as any)?.symbolTable;
                            });
                        };
                    }
                }
                let inner = this.outerType[this.propertyName];

                if (!inner) {
                    inner = DynamicType.instance;
                }

                if (inner) {
                    const result = Reflect.get(inner, propName, inner);
                    return result;
                }
            },
            set: (target, name, value, receiver) => {
                //There may be some need to specifically set members on ReferenceType in the future
                // eg: if (Reflect.has(target, name)) {
                //   return Reflect.set(target, name, value, receiver);

                let inner = this.outerType[this.propertyName];

                if (inner) {
                    const result = Reflect.set(inner, name, value, inner);
                    return result;
                }
            }
        });
    }
}
