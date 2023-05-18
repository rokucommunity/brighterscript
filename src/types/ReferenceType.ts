import type { CacheVerifierProvider } from '../CacheVerifier';
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
    constructor(public memberKey: string, public fullName, public flags: SymbolTypeFlags, private tableProvider: SymbolTypesGetterProvider, private cacheVerifierProvider?: CacheVerifierProvider) {
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
                        let resultSoFar = this.resolve();
                        while (isReferenceType(resultSoFar)) {
                            resultSoFar = (resultSoFar as any).getTarget();
                        }
                        return !!resultSoFar;
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
                                this.tableProvider === targetType.tableProvider;
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
                            const resolvedType = this.resolve();
                            if (resolvedType) {
                                return resolvedType.getMemberTypes(memberName, flags);
                            }

                            const refLookUp = `${memberName.toLowerCase()}-${flags}`;
                            let memberTypeReference = this.memberTypeReferences.get(refLookUp) ?? new ReferenceType(memberName, this.makeMemberFullName(memberName), flags, () => {
                                return {
                                    getSymbolTypes: (innerName: string, innerFlags: SymbolTypeFlags) => {
                                        const resolvedType = this.resolve();
                                        if (resolvedType) {
                                            return resolvedType.getMemberTypes(innerName, innerFlags);
                                        }
                                    },
                                    getCachedType: (name, options) => {
                                        return this.memberTable.getCachedType(name, options);
                                    },
                                    setCachedType: (name, type, options) => {
                                        return this.memberTable.setCachedType(name, type, options);
                                    }
                                };
                            }, this.cacheVerifierProvider);
                            return [memberTypeReference];
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
                        return this.memberTable;
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
        const symbolTable = this.tableProvider();
        if (!symbolTable) {
            return;
        }
        let cacheOptions = { flags: this.flags, cacheVerifierProvider: this.cacheVerifierProvider };
        let resolvedType = symbolTable.getCachedType(this.memberKey, cacheOptions);
        if (resolvedType && !isReferenceType(resolvedType)) {
            return resolvedType;
        }
        resolvedType = getUniqueType(symbolTable.getSymbolTypes(this.memberKey, this.flags));
        if (resolvedType && !isReferenceType(resolvedType)) {
            symbolTable.setCachedType(this.memberKey, resolvedType, cacheOptions);
        }
        return resolvedType;
    }

    makeMemberFullName(memberName: string) {
        return this.fullName + '.' + memberName;
    }

    private referenceChain = new Set<BscType>();

    private returnTypePropertyReference: TypePropertyReferenceType;

    private memberTypeReferences = new Map<string, ReferenceType>();
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
    constructor(public outerType: BscType, public propertyName: string, private cacheVerifierProvider?: CacheVerifierProvider) {
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
                            const fullMemberName = this.outerType.toString() + '.' + memberName;
                            return [new ReferenceType(memberName, fullMemberName, flags, () => {
                                return {
                                    getSymbolTypes: (innerName: string, innerFlags: SymbolTypeFlags) => {
                                        return this.outerType?.[this.propertyName]?.getMemberTypes(innerName, innerFlags);
                                    },
                                    getCachedType: (name, options) => this.outerType?.[this.propertyName]?.memberTable?.getCachedType(name, options),
                                    setCachedType: (name, type, options) => this.outerType?.[this.propertyName]?.memberTable?.setCachedType(name, type, options)
                                };
                            }, this.cacheVerifierProvider)];
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
