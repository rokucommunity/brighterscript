import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isCallableType, isDynamicType, isInvalidType, isObjectType, isTypeParameterType, isTypeStatementType } from '../astUtils/reflection';
import { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { DynamicType } from './DynamicType';
import { isUnionTypeCompatible } from './helpers';

let nextTypeParameterId = 1;

/**
 * A type parameter declared on a generic function, class or interface (eg. the `T` in `function first<T>(items as T[]) as T`).
 *
 * Inside the generic declaration, a value of type `T` is opaque: only another `T` (or `dynamic`/`invalid`/`object`) can be used
 * where a `T` is expected. When a `T` is used where some concrete type is expected, it is treated as its constraint
 * (eg. `T extends Node` is usable as a `Node`), or as an unknown when it has no constraint.
 *
 * When the generic declaration is used (eg. `Queue<integer>` or a call to `first([1, 2, 3])`), type parameters are
 * replaced with the supplied (or inferred) type arguments. See `TypeParameterHelpers.ts`.
 */
export class TypeParameterType extends BscType {

    constructor(
        public name: string,
        /**
         * The upper bound of this type parameter (eg. `T extends SomeType`). `undefined` when there is no constraint
         */
        public constraint?: BscType
    ) {
        super(name);
    }

    public readonly kind = BscTypeKind.TypeParameterType;

    /**
     * Unique identity for this type parameter declaration. Type identity must survive being wrapped in `ReferenceType` proxies,
     * so equality checks and substitution use this id instead of object identity
     */
    public readonly id = nextTypeParameterId++;

    /**
     * The type that a value of this type parameter is known to be: the constraint, or `dynamic` when unconstrained
     */
    public get effectiveType(): BscType {
        return this.constraint ?? DynamicType.instance;
    }

    public isResolvable(): boolean {
        return true;
    }

    /**
     * Can a value of `targetType` be used where this type parameter is expected?
     * Only the same type parameter (or the "anything" types) qualify - the caller doesn't get to pick what `T` is.
     */
    public isTypeCompatible(targetType: BscType, data?: TypeCompatibilityData) {
        while (isTypeStatementType(targetType)) {
            targetType = targetType.wrappedType;
        }
        if (!targetType) {
            return false;
        }
        if (this.isEqual(targetType)) {
            return true;
        }
        if (isDynamicType(targetType) || isInvalidType(targetType) || isObjectType(targetType)) {
            return true;
        }
        if (isUnionTypeCompatible(this, targetType, data)) {
            return true;
        }
        return false;
    }

    public toString() {
        return this.name;
    }

    public toTypeString(): string {
        //type parameters have no runtime representation. Constrained parameters can safely use the constraint's runtime type
        return this.constraint ? this.constraint.toTypeString() : 'dynamic';
    }

    public isEqual(targetType: BscType): boolean {
        if (targetType === this) {
            return true;
        }
        if (isTypeParameterType(targetType)) {
            //same declaration (identity survives ReferenceType proxies via `id`).
            //Fall back to name equality so the same generic function declared in multiple scopes compares as equal
            return targetType.id === this.id || targetType.name?.toLowerCase() === this.name?.toLowerCase();
        }
        return false;
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        return this.effectiveType.getMemberType(memberName, options);
    }

    getMemberTable() {
        return this.effectiveType.getMemberTable();
    }

    addBuiltInInterfaces() {
        if (!this.hasAddedBuiltInInterfaces) {
            this.effectiveType.addBuiltInInterfaces();
            this.hasAddedBuiltInInterfaces = true;
        }
    }

    getCallFuncType(name: string, options: GetTypeOptions): BscType {
        return this.effectiveType.getCallFuncType(name, options);
    }

    getCallFuncTable() {
        return this.effectiveType.getCallFuncTable();
    }

    get returnType() {
        if (isCallableType(this.constraint)) {
            return this.constraint.returnType;
        }
        return undefined;
    }
}
