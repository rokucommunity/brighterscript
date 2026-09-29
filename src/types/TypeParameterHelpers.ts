/* eslint-disable no-bitwise */
import type { BscType } from './BscType';
import { isAnyReferenceType, isArrayType, isDynamicType, isInheritableType, isIntersectionType, isInvalidType, isReferenceType, isTypedFunctionType, isTypeParameterType, isTypeStatementType, isUninitializedType, isUnionType, isVoidType } from '../astUtils/reflection';
import type { TypeParameterType } from './TypeParameterType';
import { ArrayType } from './ArrayType';
import { UnionType } from './UnionType';
import { IntersectionType } from './IntersectionType';
import { TypedFunctionType } from './TypedFunctionType';
import { TypeStatementType } from './TypeStatementType';
import { DynamicType } from './DynamicType';

/**
 * Maps a type parameter (by its `id`) to the type it has been bound to
 */
export type TypeParameterBindings = Map<number, BscType>;

const maxDepth = 12;

/**
 * If `type` is a reference that can currently be resolved, return the resolved type; otherwise return `type` unchanged.
 */
export function resolveIfPossible(type: BscType): BscType {
    if (isAnyReferenceType(type) && type.isResolvable()) {
        const target = (type as any).getTarget?.();
        if (target) {
            return target;
        }
    }
    return type;
}

/**
 * Build the bindings for a generic declaration given the explicit type arguments. Missing arguments fall back to the
 * parameter's constraint (or `dynamic`)
 */
export function createTypeParameterBindings(typeParameters: TypeParameterType[], typeArguments: BscType[]): TypeParameterBindings {
    const bindings: TypeParameterBindings = new Map();
    for (let i = 0; i < (typeParameters?.length ?? 0); i++) {
        const typeParam = typeParameters[i];
        bindings.set(typeParam.id, typeArguments?.[i] ?? typeParam.constraint ?? DynamicType.instance);
    }
    return bindings;
}

/**
 * Does this type mention any type parameter (deeply)? Used to skip substitution work for the common, non-generic case
 */
export function containsTypeParameter(type: BscType, depth = 0): boolean {
    if (!type || depth > maxDepth) {
        return false;
    }
    if (isReferenceType(type)) {
        if (type.typeArguments?.length) {
            return type.typeArguments.some(arg => containsTypeParameter(arg, depth + 1));
        }
        return false;
    }
    if (isTypeParameterType(type)) {
        return true;
    }
    if (isArrayType(type)) {
        return type.innerTypes.some(inner => containsTypeParameter(inner, depth + 1));
    }
    if (isUnionType(type) || isIntersectionType(type)) {
        return type.types.some(inner => containsTypeParameter(inner, depth + 1));
    }
    if (isTypeStatementType(type)) {
        return containsTypeParameter(type.wrappedType, depth + 1);
    }
    if (isTypedFunctionType(type)) {
        return containsTypeParameter(type.returnType, depth + 1) || type.params.some(param => containsTypeParameter(param.type, depth + 1));
    }
    if (isInheritableType(type) && type.typeArguments?.length) {
        return type.typeArguments.some(arg => containsTypeParameter(arg, depth + 1));
    }
    return false;
}

/**
 * Replace every bound type parameter found in `type` with its binding, rebuilding compound types as needed.
 * Types that don't mention any bound type parameter are returned as-is (same instance).
 */
export function substituteTypeParameters(type: BscType, bindings: TypeParameterBindings, depth = 0): BscType {
    if (!type || !bindings || bindings.size === 0 || depth > maxDepth) {
        return type;
    }
    if (isReferenceType(type)) {
        if (type.isResolvable()) {
            const target = type.getTarget();
            if (target && !isAnyReferenceType(target)) {
                return substituteTypeParameters(target, bindings, depth + 1);
            }
            return type;
        }
        //unresolved reference with type arguments (eg. `Queue<T>` where `Queue` lives in another file) - substitute inside the arguments
        if (type.typeArguments?.length) {
            const newArgs = substituteAll(type.typeArguments, bindings, depth);
            return newArgs ? type.withTypeArguments(newArgs) : type;
        }
        return type;
    }
    if (isAnyReferenceType(type)) {
        //other deferred types (TypePropertyReferenceType, etc.) - only substitute when they have already resolved
        const target = resolveIfPossible(type);
        if (target !== type) {
            return substituteTypeParameters(target, bindings, depth + 1);
        }
        return type;
    }
    if (isTypeParameterType(type)) {
        return bindings.get(type.id) ?? type;
    }
    if (isArrayType(type)) {
        const newInner = substituteAll(type.innerTypes, bindings, depth);
        return newInner ? new ArrayType(...newInner) : type;
    }
    if (isUnionType(type)) {
        const newTypes = substituteAll(type.types, bindings, depth);
        return newTypes ? new UnionType(newTypes) : type;
    }
    if (isIntersectionType(type)) {
        const newTypes = substituteAll(type.types, bindings, depth);
        return newTypes ? new IntersectionType(newTypes) : type;
    }
    if (isTypeStatementType(type)) {
        const newWrapped = substituteTypeParameters(type.wrappedType, bindings, depth + 1);
        return newWrapped !== type.wrappedType ? new TypeStatementType(type.name, newWrapped) : type;
    }
    if (isTypedFunctionType(type)) {
        //a generic function's own type parameters are not substituted (they are bound per-call)
        let effectiveBindings = bindings;
        if (type.typeParameters?.length) {
            effectiveBindings = new Map(bindings);
            for (const ownParam of type.typeParameters) {
                effectiveBindings.delete(ownParam.id);
            }
            if (effectiveBindings.size === 0) {
                return type;
            }
        }
        let changed = false;
        const newParams = type.params.map(param => {
            const newParamType = substituteTypeParameters(param.type, effectiveBindings, depth + 1);
            changed = changed || newParamType !== param.type;
            return { name: param.name, type: newParamType, isOptional: param.isOptional };
        });
        const newReturnType = substituteTypeParameters(type.returnType, effectiveBindings, depth + 1);
        changed = changed || newReturnType !== type.returnType;
        if (!changed) {
            return type;
        }
        const result = new TypedFunctionType(newReturnType);
        result.name = type.name;
        result.isSub = type.isSub;
        result.isVariadic = type.isVariadic;
        result.isBuiltIn = type.isBuiltIn;
        result.typeParameters = type.typeParameters;
        result.params = newParams;
        return result;
    }
    if (isInheritableType(type) && type.typeArguments?.length && type.genericDeclaration) {
        const newArgs = substituteAll(type.typeArguments, bindings, depth);
        return newArgs ? type.genericDeclaration.instantiate(newArgs) : type;
    }
    return type;
}

/**
 * Substitute into each type in the list. Returns `undefined` when nothing changed
 */
function substituteAll(types: BscType[], bindings: TypeParameterBindings, depth: number): BscType[] | undefined {
    let changed = false;
    const result = types.map(inner => {
        const newInner = substituteTypeParameters(inner, bindings, depth + 1);
        changed = changed || newInner !== inner;
        return newInner;
    });
    return changed ? result : undefined;
}

/**
 * Apply type arguments to a generic type (eg. `Queue` + `[integer]` -> `Queue<integer>`).
 * - generic classes/interfaces are instantiated
 * - unresolved references remember the type arguments and instantiate once they resolve
 * - anything else is returned unchanged (the validator reports the misuse)
 */
export function applyTypeArguments(baseType: BscType, typeArguments: BscType[], depth = 0): BscType {
    //note: an empty (but defined) list means "instantiate with default type arguments" (eg. `new Queue()`)
    if (!baseType || !typeArguments || depth > maxDepth) {
        return baseType;
    }
    if (isReferenceType(baseType)) {
        if (baseType.isResolvable()) {
            const target = baseType.getTarget();
            if (target && !isAnyReferenceType(target)) {
                return applyTypeArguments(target, typeArguments, depth + 1);
            }
        }
        return baseType.withTypeArguments(typeArguments);
    }
    if (isTypeStatementType(baseType)) {
        return applyTypeArguments(baseType.wrappedType, typeArguments, depth + 1);
    }
    if (isInheritableType(baseType) && baseType.typeParameters?.length) {
        return baseType.instantiate(typeArguments);
    }
    return baseType;
}

/**
 * Infer the type arguments for a call to a generic function by matching each parameter type against the type of the
 * argument supplied for it (eg. `first(items as T[])` called with `integer[]` binds `T` to `integer`).
 * Type parameters that can't be inferred are bound to their constraint (or `dynamic`).
 */
export function inferTypeArguments(typeParameters: TypeParameterType[], paramTypes: BscType[], argTypes: BscType[]): TypeParameterBindings {
    const bindings: TypeParameterBindings = new Map();
    if (!typeParameters?.length) {
        return bindings;
    }
    const inferrableIds = new Set(typeParameters.map(typeParam => typeParam.id));
    const count = Math.min(paramTypes?.length ?? 0, argTypes?.length ?? 0);
    for (let i = 0; i < count; i++) {
        unify(paramTypes[i], argTypes[i], inferrableIds, bindings, 0);
    }
    for (const typeParam of typeParameters) {
        if (!bindings.has(typeParam.id)) {
            bindings.set(typeParam.id, typeParam.constraint ?? DynamicType.instance);
        }
    }
    return bindings;
}

/**
 * Structural matching of a parameter type against an argument type, recording bindings for the type parameters encountered
 */
function unify(paramType: BscType, argType: BscType, inferrableIds: Set<number>, bindings: TypeParameterBindings, depth: number) {
    if (!paramType || !argType || depth > maxDepth) {
        return;
    }
    paramType = resolveIfPossible(paramType);
    argType = resolveIfPossible(argType);
    while (isTypeStatementType(paramType)) {
        paramType = paramType.wrappedType;
    }
    while (isTypeStatementType(argType)) {
        argType = argType.wrappedType;
    }
    if (isTypeParameterType(paramType) && inferrableIds.has(paramType.id)) {
        if (isTypeParameterType(argType) && argType.id === paramType.id) {
            return;
        }
        if (isUninitializedType(argType) || isVoidType(argType)) {
            return;
        }
        const existing = bindings.get(paramType.id);
        //first binding wins, except that a "know nothing" binding (invalid/dynamic) gives way to something more specific
        if (!existing || ((isInvalidType(existing) || isDynamicType(existing)) && !isInvalidType(argType) && !isDynamicType(argType))) {
            bindings.set(paramType.id, argType);
        }
        return;
    }
    if (isArrayType(paramType)) {
        if (isArrayType(argType)) {
            unify(paramType.defaultType, argType.defaultType, inferrableIds, bindings, depth + 1);
        }
        return;
    }
    if (isTypedFunctionType(paramType)) {
        if (isTypedFunctionType(argType)) {
            const count = Math.min(paramType.params.length, argType.params.length);
            for (let i = 0; i < count; i++) {
                unify(paramType.params[i].type, argType.params[i].type, inferrableIds, bindings, depth + 1);
            }
            unify(paramType.returnType, argType.returnType, inferrableIds, bindings, depth + 1);
        }
        return;
    }
    if (isUnionType(paramType) || isIntersectionType(paramType)) {
        for (const inner of paramType.types) {
            unify(inner, argType, inferrableIds, bindings, depth + 1);
        }
        return;
    }
    const paramTypeArgs = getTypeArguments(paramType);
    if (paramTypeArgs?.length) {
        //find the argument's ancestor that is an instance of the same generic declaration (eg. param `Queue<T>`, arg `IntQueue extends Queue<integer>`)
        const paramName = getGenericName(paramType);
        let current: BscType = argType;
        let ancestorDepth = 0;
        while (current && ancestorDepth++ < maxDepth) {
            current = resolveIfPossible(current);
            if (isInheritableType(current) && current.name?.toLowerCase() === paramName) {
                const argTypeArgs = current.typeArguments ?? [];
                for (let i = 0; i < paramTypeArgs.length; i++) {
                    unify(paramTypeArgs[i], argTypeArgs[i], inferrableIds, bindings, depth + 1);
                }
                return;
            }
            current = isInheritableType(current) ? current.parentType : undefined;
        }
    }
}

function getTypeArguments(type: BscType): BscType[] | undefined {
    if (isReferenceType(type)) {
        return type.typeArguments;
    }
    if (isInheritableType(type)) {
        return type.typeArguments;
    }
    return undefined;
}

function getGenericName(type: BscType): string {
    if (isReferenceType(type)) {
        return (type.memberKey ?? type.fullName)?.toLowerCase();
    }
    if (isInheritableType(type)) {
        return type.name?.toLowerCase();
    }
    return undefined;
}

/**
 * Infer the bindings for a generic function's type parameters from the types of the arguments in a call to it
 */
export function inferTypeArgumentsForCall(funcType: TypedFunctionType, argTypes: BscType[]): TypeParameterBindings {
    return inferTypeArguments(funcType?.typeParameters, funcType?.params?.map(param => param.type) ?? [], argTypes);
}

/**
 * Get a copy of a generic function type with its type parameters replaced by the types inferred from the given argument types.
 * Non-generic functions are returned unchanged.
 */
export function instantiateFunctionForCall(funcType: TypedFunctionType, argTypes: BscType[]): TypedFunctionType {
    if (!funcType?.typeParameters?.length) {
        return funcType;
    }
    return instantiateFunction(funcType, inferTypeArgumentsForCall(funcType, argTypes));
}

/**
 * Find inferred/supplied type arguments that don't satisfy their type parameter's constraint
 */
export function findConstraintViolations(typeParameters: TypeParameterType[], bindings: TypeParameterBindings): Array<{ typeParameter: TypeParameterType; typeArgument: BscType }> {
    const violations = [] as Array<{ typeParameter: TypeParameterType; typeArgument: BscType }>;
    for (const typeParam of typeParameters ?? []) {
        const constraint = typeParam.constraint;
        const typeArgument = bindings?.get(typeParam.id);
        if (!constraint?.isResolvable() || !typeArgument?.isResolvable() || isTypeParameterType(typeArgument)) {
            continue;
        }
        if (!constraint.isTypeCompatible(typeArgument, {})) {
            violations.push({ typeParameter: typeParam, typeArgument: typeArgument });
        }
    }
    return violations;
}

/**
 * Get a copy of a generic function type with its type parameters replaced according to `bindings`
 */
export function instantiateFunction(funcType: TypedFunctionType, bindings: TypeParameterBindings): TypedFunctionType {
    if (!funcType?.typeParameters?.length || !bindings?.size) {
        return funcType;
    }
    const result = new TypedFunctionType(substituteTypeParameters(funcType.returnType, bindings));
    result.name = funcType.name;
    result.isSub = funcType.isSub;
    result.isVariadic = funcType.isVariadic;
    result.isBuiltIn = funcType.isBuiltIn;
    result.params = funcType.params.map(param => {
        return { name: param.name, type: substituteTypeParameters(param.type, bindings), isOptional: param.isOptional };
    });
    //this instance is no longer generic
    result.typeParameters = undefined;
    return result;
}

/**
 * A structural key for a type, used to cache instantiations of generic types (eg. `Queue<integer>`).
 * Type parameters are keyed by identity so two different `T`s never collide.
 */
export function getTypeKey(type: BscType, depth = 0): string {
    if (!type || depth > maxDepth) {
        return '?';
    }
    if (isReferenceType(type)) {
        if (type.isResolvable()) {
            const target = type.getTarget();
            if (target && !isAnyReferenceType(target)) {
                return getTypeKey(target, depth + 1);
            }
        }
        const args = type.typeArguments?.length ? `<${type.typeArguments.map(arg => getTypeKey(arg, depth + 1)).join(',')}>` : '';
        return `ref:${type.fullName?.toLowerCase()}${args}`;
    }
    if (isTypeParameterType(type)) {
        return `$${type.id}`;
    }
    if (isArrayType(type)) {
        return `Array<${type.innerTypes.map(inner => getTypeKey(inner, depth + 1)).join(',')}>`;
    }
    if (isUnionType(type) || isIntersectionType(type)) {
        return `(${type.types.map(inner => getTypeKey(inner, depth + 1)).join(isUnionType(type) ? ' or ' : ' and ')})`;
    }
    if (isTypeStatementType(type)) {
        return getTypeKey(type.wrappedType, depth + 1);
    }
    if (isInheritableType(type) && type.typeArguments?.length) {
        return `${type.name?.toLowerCase()}<${type.typeArguments.map(arg => getTypeKey(arg, depth + 1)).join(',')}>`;
    }
    if (isTypedFunctionType(type)) {
        return `func(${type.params.map(param => getTypeKey(param.type, depth + 1)).join(',')})=>${getTypeKey(type.returnType, depth + 1)}`;
    }
    return type.toString?.() ?? '?';
}

/**
 * Get the display text of a type parameter list, eg. `<T, U extends Node>`
 */
export function getTypeParametersDisplayText(typeParameters: TypeParameterType[]): string {
    if (!typeParameters?.length) {
        return '';
    }
    return `<${typeParameters.map(typeParam => {
        return typeParam.constraint ? `${typeParam.name} extends ${typeParam.constraint.toString()}` : typeParam.name;
    }).join(', ')}>`;
}

/**
 * Get the display text of a type argument list, eg. `<integer, string>`
 */
export function getTypeArgumentsDisplayText(typeArguments: BscType[]): string {
    if (!typeArguments?.length) {
        return '';
    }
    return `<${typeArguments.map(arg => arg?.toString() ?? 'dynamic').join(', ')}>`;
}

