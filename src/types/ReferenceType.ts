import type { GetTypeOptions } from '../interfaces';
import type { CacheVerifierProvider } from '../CacheVerifier';
import type { GetSymbolTypeOptions, SymbolTypeGetterProvider } from '../SymbolTable';
import type { SymbolTypeFlags } from '../SymbolTable';
import { isDynamicType, isReferenceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { BscTypeKind } from './BscTypeKind';

export function referenceTypeFactory(memberKey: string, fullName, flags: SymbolTypeFlags, tableProvider: SymbolTypeGetterProvider) {
    return new ReferenceType(memberKey, fullName, flags, tableProvider);
}

export class ReferenceType extends BscType {

    /**
     * ReferenceTypes are used when the actual type may be resolved later from a Symbol table
     * @param memberKey which key do we use to look up this type in the given table?
     * @param fullName the full/display name for this type
     * @param flags is this type available at typetime, runtime, etc.
     * @param tableProvider function that returns a SymbolTable that we use for the lookup.
     */
    constructor(public memberKey: string, public fullName, public flags: SymbolTypeFlags, private tableProvider: SymbolTypeGetterProvider, private cacheVerifierProvider?: CacheVerifierProvider) {
        super(memberKey);
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: (target, propName, receiver) => {

                if (propName === '__reflection') {
                    // Cheeky way to get `isReferenceType` reflection to work
                    return this.__reflection;
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
                        const resolvedType = this.resolve();
                        if (resolvedType && !isReferenceType(resolvedType)) {
                            return resolvedType.isEqual(targetType);
                        } else if (isReferenceType(targetType)) {
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

                    if (propName === 'getMemberType') {
                        // We're looking for a member of a reference type
                        // Since we don't know what type this is, yet, return ReferenceType
                        return (memberName: string, options: GetTypeOptions) => {
                            const resolvedType = this.resolve();
                            if (resolvedType) {
                                return resolvedType.getMemberType(memberName, options);
                            }
                            const refLookUp = `${memberName.toLowerCase()}-${options.flags}`;
                            let memberTypeReference = this.memberTypeReferences.get(refLookUp);
                            if (memberTypeReference) {
                                return memberTypeReference;

                            }
                            memberTypeReference = new ReferenceType(memberName, this.makeMemberFullName(memberName), options.flags, this.futureMemberTableProvider, this.cacheVerifierProvider);
                            this.memberTypeReferences.set(refLookUp, memberTypeReference);
                            return memberTypeReference;
                        };
                    } else if (propName === 'toString') {
                        // This type was never found
                        // For diagnostics, we should return the expected name of of the type
                        return () => this.fullName;
                    } else if (propName === 'toTypeString') {
                        // For transpilation, we should 'dynamic'
                        return () => 'dynamic';
                    } else if (propName === 'returnType') {
                        let propRefType = this.propertyTypeReference.get(propName);
                        if (!propRefType) {
                            propRefType = new TypePropertyReferenceType(this, propName);
                            this.propertyTypeReference.set(propName, propRefType);
                        }
                        return propRefType;
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

                if (!innerType) {
                    innerType = DynamicType.instance;
                }
                const result = Reflect.get(innerType, propName, innerType);
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

    public readonly kind = BscTypeKind.ReferenceType;

    /**
     * Resolves the type based on the original name and the table provider
     */
    private resolve(): BscType {
        const symbolTable = this.tableProvider();
        if (!symbolTable) {
            return;
        }
        // Look for circular references
        let resolvedType = symbolTable.getSymbolType(this.memberKey, { flags: this.flags });
        if (!resolvedType) {
            // could not find this member
            return;
        }
        if (isReferenceType(resolvedType)) {
            if (this.referenceChain.has(resolvedType)) {
                // this is a circular reference
                this.circRefCount++;
            }
            if (this.circRefCount > 1) {
                //It is possible that we could properly resolve the case that one reference points to itself
                //see test: '[Scope][symbolTable lookups with enhanced typing][finds correct class field type with default value enums are used]
                return;
            }
            this.referenceChain.add(resolvedType);
        } else {
            this.circRefCount = 0;
            this.referenceChain.clear();
        }
        return resolvedType;
    }

    get __reflection() {
        return { name: 'ReferenceType' };
    }

    makeMemberFullName(memberName: string) {
        return this.fullName + '.' + memberName;
    }
    private circRefCount = 0;

    private referenceChain = new Set<BscType>();

    private propertyTypeReference = new Map<string, TypePropertyReferenceType>();

    private memberTypeReferences = new Map<string, ReferenceType>();

    private futureMemberTableProvider = () => {
        return {
            getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                const resolvedType = this.resolve();
                if (resolvedType) {
                    return resolvedType.getMemberType(innerName, innerOptions);
                }
            }
        };
    };
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
                    if (propName === 'getMemberType') {
                        //If we're calling `getMemberType()`, we need it to proxy to using the actual symbol table
                        //So if that symbol is ever populated, the correct type is passed through
                        return (memberName: string, options: GetSymbolTypeOptions) => {
                            const fullMemberName = this.outerType.toString() + '.' + memberName;
                            return new ReferenceType(memberName, fullMemberName, options.flags, () => {
                                return {
                                    getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                                        return this.outerType?.[this.propertyName]?.getMemberType(innerName, innerOptions);
                                    }
                                };
                            });
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
