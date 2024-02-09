import type { GetTypeOptions, TypeChainEntry, TypeCompatibilityData } from '../interfaces';
import type { GetSymbolTypeOptions, SymbolTypeGetterProvider } from '../SymbolTable';
import type { SymbolTypeFlag } from '../SymbolTableFlag';
import { isAnyReferenceType, isComponentType, isDynamicType, isReferenceType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { DynamicType } from './DynamicType';
import { BscTypeKind } from './BscTypeKind';
import type { Token } from '../lexer/Token';

export function referenceTypeFactory(memberKey: string, fullName, flags: SymbolTypeFlag, tableProvider: SymbolTypeGetterProvider) {
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
    constructor(public memberKey: string, public fullName, public flags: SymbolTypeFlag, private tableProvider: SymbolTypeGetterProvider) {
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
                        while (resultSoFar && isReferenceType(resultSoFar)) {
                            resultSoFar = (resultSoFar as any).getTarget?.();
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
                    return (targetType: BscType, data?: TypeCompatibilityData) => {
                        if (!targetType) {
                            return false;
                        }
                        const resolvedType = this.resolve();
                        let equal = false;
                        if (resolvedType && !isReferenceType(resolvedType)) {
                            equal = resolvedType.isEqual(targetType, data);
                        } else if (isReferenceType(targetType)) {
                            equal = this.fullName.toLowerCase() === targetType.fullName.toLowerCase() &&
                                (this.tableProvider === targetType.tableProvider ||
                                    this.tableProvider().name === targetType.tableProvider().name);
                        } else {
                            equal = targetType.isEqual(this, data);
                        }
                        return equal;
                    };
                }
                if (propName === 'isTypeCompatible') {
                    //Need to be able to check equality without resolution, because resolution need to check equality
                    //To see if you need to make a UnionType
                    return (targetType: BscType, data?: TypeCompatibilityData) => {
                        if (!targetType) {
                            return false;
                        }
                        if (isDynamicType(targetType)) {
                            return true;
                        }
                        const resolvedType = this.resolve();
                        if (resolvedType && !isReferenceType(resolvedType)) {
                            return resolvedType.isTypeCompatible(targetType, data);
                        } else if (isReferenceType(targetType)) {
                            return this.fullName.toLowerCase() === targetType.fullName.toLowerCase() &&
                                this.tableProvider === targetType.tableProvider;
                        }
                        return targetType.isTypeCompatible(this, data);
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
                            memberTypeReference = new ReferenceType(memberName, this.makeMemberFullName(memberName), options.flags, this.futureMemberTableProvider);
                            this.memberTypeReferences.set(refLookUp, memberTypeReference);
                            return memberTypeReference;
                        };
                    } else if (propName === 'getCallFuncType') {
                        // We're looking for a callfunc member of a reference type
                        // Since we don't know what type this is, yet, return ReferenceType
                        return (memberName: string, options: GetTypeOptions) => {
                            const resolvedType = this.resolve();
                            if (isComponentType(resolvedType)) {
                                return resolvedType.getCallFuncType(memberName, options);
                            }
                            const refLookUp = `${memberName.toLowerCase()}-${options.flags}-callfunc`;
                            let callFuncMemberTypeReference = this.callFuncMemberTypeReferences.get(refLookUp);
                            if (callFuncMemberTypeReference) {
                                return callFuncMemberTypeReference;

                            }
                            callFuncMemberTypeReference = new ReferenceType(memberName, this.makeMemberFullName(memberName), options.flags, this.futureCallFuncMemberTableProvider);
                            this.callFuncMemberTypeReferences.set(refLookUp, callFuncMemberTypeReference);
                            return callFuncMemberTypeReference;
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
                    } else if (propName === 'getMemberTable') {
                        return () => {
                            return this.memberTable;
                        };
                    } else if (propName === 'callFuncTable') {
                        return (this as any).callFuncMemberTable;
                    } else if (propName === 'getCallFuncTable') {
                        return () => {
                            return (this as any).callFuncMemberTable;
                        };
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
                    } else if (propName === 'addBuiltInInterfaces') {
                        // this is an unknown type. There is no use in adding built in interfaces
                        // return no-op function
                        return () => { };
                    } else if (propName === 'hasAddedBuiltInInterfaces') {
                        // this is an unknown type. There is no use in adding built in interfaces
                        return true;
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
                    return false;
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
        let resolvedType = symbolTable.getSymbolType(this.memberKey, { flags: this.flags, onlyCacheResolvedTypes: true });
        if (!resolvedType) {
            // could not find this member
            return;
        }
        if (isAnyReferenceType(resolvedType)) {
            // If this is a referenceType, keep digging down until we have a non reference Type.
            while (resolvedType && isAnyReferenceType(resolvedType)) {
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
                resolvedType = (resolvedType as any).getTarget?.();
            }
            this.tableProvider().setCachedType(this.memberKey, { type: resolvedType }, { flags: this.flags });
        }

        if (resolvedType && !isAnyReferenceType(resolvedType)) {
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
    private callFuncMemberTypeReferences = new Map<string, ReferenceType>();

    private futureMemberTableProvider = () => {
        return {
            name: `FutureMemberTableProvider: '${this.__identifier}'`,
            getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                const resolvedType = this.resolve();
                if (resolvedType) {
                    return resolvedType.getMemberType(innerName, innerOptions);
                }
            },
            setCachedType: (innerName: string, innerResolvedTypeCacheEntry: TypeChainEntry, options: GetSymbolTypeOptions) => {
                const resolvedType = this.resolve();
                if (resolvedType) {
                    resolvedType.memberTable.setCachedType(innerName, innerResolvedTypeCacheEntry, options);
                }
            }
        };
    };

    private futureCallFuncMemberTableProvider = () => {
        return {
            name: `FutureCallFuncMemberTableProvider: '${this.__identifier}'`,
            getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                const resolvedType = this.resolve();
                if (isComponentType(resolvedType)) {
                    return resolvedType.getCallFuncType(innerName, innerOptions);
                }
            },
            setCachedType: (innerName: string, innerResolvedTypeCacheEntry: TypeChainEntry, options: GetSymbolTypeOptions) => {
                const resolvedType = this.resolve();
                if (isComponentType(resolvedType)) {
                    resolvedType.getCallFuncTable().setCachedType(innerName, innerResolvedTypeCacheEntry, options);
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

                if (isAnyReferenceType(this.outerType) && !this.outerType.isResolvable()) {
                    if (propName === 'getMemberType') {
                        //If we're calling `getMemberType()`, we need it to proxy to using the actual symbol table
                        //So if that symbol is ever populated, the correct type is passed through
                        return (memberName: string, options: GetSymbolTypeOptions) => {
                            const fullMemberName = this.outerType.toString() + '.' + memberName;
                            return new ReferenceType(memberName, fullMemberName, options.flags, () => {
                                return {
                                    name: `TypePropertyReferenceType : '${fullMemberName}'`,
                                    getSymbolType: (innerName: string, innerOptions: GetTypeOptions) => {
                                        return this.outerType?.[this.propertyName]?.getMemberType(innerName, innerOptions);
                                    },
                                    setCachedType: (innerName: string, innerTypeCacheEntry: TypeChainEntry, innerOptions: GetTypeOptions) => {
                                        return this.outerType?.[this.propertyName]?.memberTable.setCachedType(innerName, innerTypeCacheEntry, innerOptions);
                                    }
                                };
                            });
                        };
                    }
                    if (propName === 'isResolvable') {
                        return () => false;
                    }
                }
                let inner = this.outerType?.[this.propertyName];

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


/**
 * Use this class for when there is a binary operator and either the left hand side and/or the right hand side
 * are ReferenceTypes
 */
export class BinaryOperatorReferenceType extends BscType {
    cachedType: BscType;

    constructor(public leftType: BscType, public operator: Token, public rightType: BscType, binaryOpResolver: (lType: BscType, operator: Token, rType: BscType) => BscType) {
        super(operator.text);
        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: (target, propName, receiver) => {

                if (propName === '__reflection') {
                    // Cheeky way to get `BinaryOperatorReferenceType` reflection to work
                    return { name: 'BinaryOperatorReferenceType' };
                }

                let resultType: BscType = this.cachedType ?? DynamicType.instance;
                if (!this.cachedType) {
                    if ((isAnyReferenceType(this.leftType) && !this.leftType.isResolvable()) ||
                        (isAnyReferenceType(this.rightType) && !this.rightType.isResolvable())
                    ) {
                        if (propName === 'isResolvable') {
                            return () => false;
                        }
                        if (propName === 'getTarget') {
                            return () => undefined;
                        }
                    } else {
                        resultType = binaryOpResolver(this.leftType, this.operator, this.rightType);
                        this.cachedType = resultType;
                    }

                }
                if (resultType) {
                    const result = Reflect.get(resultType, propName, resultType);
                    return result;
                }
            }
        });
    }
}
