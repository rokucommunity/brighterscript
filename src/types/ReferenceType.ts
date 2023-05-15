import type { SymbolTypesGetterProvider } from '../SymbolTable';
import type { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isReferenceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { getUniqueType } from './helpers';

export class ReferenceType extends BscType {

    /**
     * ReferenceTypes are used when the actual type may be resolved later from a Symbol table
     * @param memberKey which key do we use to look up this type in the given table?
     * @param fullName the full/display name for this type
     * @param flags is this type available at typetime, runtime, etc.
     * @param tableProvider function that returns a SymbolTable that we use for the lookup.
     */
    constructor(public memberKey: string, public fullName, public flags: SymbolTypeFlags, private tableProvider: SymbolTypesGetterProvider) {
        super(memberKey);
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: (target, propName, receiver) => {

                if (propName === '__reflection') {
                    // Cheeky way to get `isReferenceType` reflection to work
                    return { name: 'ReferenceType' };
                }
                if (propName === '__identifier') {
                    // Cheeky way to get `isReferenceType` reflection to work
                    return this.__identifier;
                }
                if (propName === 'fullName') {
                    return this.fullName;
                }
                if (propName === 'isResolvable') {
                    return () => {
                        return !!this.resolve();
                    };
                }
                if (propName === 'getTarget') {
                    return () => {
                        return this.resolve();
                    };
                }
                if (propName === 'tableProvider') {
                    return this.tableProvider;
                }
                if (propName === 'isEqual') {
                    //Need to be able to check equality without resolution, because resolution need to check equality
                    //To see if you need to make a UnionType
                    return (targetType: BscType) => {
                        if (isReferenceType(targetType)) {
                            return this.fullName.toLowerCase() === targetType.fullName.toLowerCase() &&
                                this.tableProvider() === targetType.tableProvider();
                        }
                        return targetType.isEqual(this);
                    };
                }

                //There may be some need to specifically get members on ReferenceType in the future
                // eg: if (Reflect.has(target, name)) {
                //   return Reflect.get(target, propName, receiver);

                let innerType = this.resolve();

                if (!innerType) {
                    // No real BscType found - we may need to handle some specific cases

                    if (propName === 'getMemberTypes') {
                        // We're looking for a member of a reference type
                        // Since we don't know what type this is, yet, return ReferenceType
                        return (memberName: string, flags: SymbolTypeFlags) => {
                            return [new ReferenceType(memberName, this.makeMemberFullName(memberName), flags, () => {
                                const resolvedType = this.resolve();
                                if (resolvedType) {
                                    return resolvedType.memberTable;
                                }
                            })];
                        };
                    } else if (propName === 'toString') {
                        // This type was never found
                        // For diagnostics, we should return the expected name of of the type
                        return () => this.fullName;
                    } else if (propName === 'toTypeString') {
                        // For transpilation, we should 'dynamic'
                        return () => 'dynamic';
                    } else if (propName === 'returnType') {
                        this.returnTypePropertyReference = this.returnTypePropertyReference ?? new TypePropertyReferenceType(this, propName);
                        return this.returnTypePropertyReference;
                    } else if (propName === 'memberTable') {
                        return this.tableProvider();
                    } else if (propName === 'isTypeCompatible') {
                        return (targetType: BscType) => {
                            return isDynamicType(targetType);
                        };
                    } else if (propName === 'isEqual') {
                        return (targetType: BscType) => {
                            if (isReferenceType(targetType)) {
                                return this.fullName.toLowerCase() === targetType.toString().toLowerCase() &&
                                    this.tableProvider() === targetType.tableProvider();
                            }
                            return false;
                        };
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
        return getUniqueType(this.tableProvider()?.getSymbolTypes(this.memberKey, this.flags));
    }

    makeMemberFullName(memberName: string) {
        return this.fullName + '.' + memberName;
    }

    private referenceChain = new Set<BscType>();

    private returnTypePropertyReference: TypePropertyReferenceType;
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
export class TypePropertyReferenceType extends BscType {
    constructor(public outerType: BscType, public propertyName: string) {
        super(propertyName);
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: (target, propName, receiver) => {

                if (propName === '__reflection') {
                    // Cheeky way to get `isTypePropertyReferenceType` reflection to work
                    return { name: 'TypePropertyReferenceType' };
                }

                if (isReferenceType(this.outerType) && !this.outerType.isResolvable()) {
                    if (propName === 'getMemberTypes') {
                        //If we're calling `getMemberTypes()`, we need it to proxy to using the actual symbol table
                        //So if that symbol is ever populated, the correct type is passed through
                        return (memberName: string, flags: SymbolTypeFlags) => {
                            const fullMemberMame = this.outerType.toString() + '.' + memberName;
                            return [new ReferenceType(memberName, fullMemberMame, flags, () => {
                                return (this.outerType[this.propertyName] as any)?.memberTable;
                            })];
                        };
                    }
                    if (propName === 'isResolvable') {
                        return () => false;
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
