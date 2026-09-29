import type { GetTypeOptions, TypeCompatibilityData } from '../interfaces';
import { isComponentType, isInheritableType, isReferenceType } from '../astUtils/reflection';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { BscType } from './BscType';
import type { ReferenceType } from './ReferenceType';
import { DynamicType } from './DynamicType';
import type { TypeParameterType } from './TypeParameterType';
import { createTypeParameterBindings, getTypeArgumentsDisplayText, getTypeKey, getTypeParametersDisplayText, substituteTypeParameters } from './TypeParameterHelpers';

export abstract class InheritableType extends BscType {

    constructor(public name: string, public readonly parentType?: InheritableType | ReferenceType) {
        super(name);
        if (parentType) {
            this.memberTable.pushParentProvider(() => this.parentType.memberTable);
        }
    }

    getMemberType(memberName: string, options: GetTypeOptions) {
        const hasRoAssociativeArrayAsAncestor = this.name.toLowerCase() === 'roassociativearray' || this.getAncestorTypeList()?.find(ancestorType => ancestorType.name.toLowerCase() === 'roassociativearray');

        const isComponentWithUnknownDynamicMember = isComponentType(this) && options.changeUnknownNodeMemberToDynamic;

        if (hasRoAssociativeArrayAsAncestor || isComponentWithUnknownDynamicMember) {
            const foundMember = super.getMemberType(memberName, options);
            if (foundMember) {
                return foundMember;
            }
            if (!options?.ignoreDefaultDynamicMembers) {
                return DynamicType.instance;
            }
            return undefined;
        }

        const resultType = super.getMemberType(memberName, { ...options, fullName: memberName, tableProvider: () => this.memberTable });
        return resultType;
    }

    /**
     * The type parameters declared by this generic class/interface (eg. the `T` in `class Queue<T>`).
     * Only set on the declaration's type - instances created with type arguments (eg. `Queue<integer>`) have `typeArguments` instead
     */
    public typeParameters?: TypeParameterType[];

    /**
     * The type arguments this type was instantiated with (eg. `[integer]` for `Queue<integer>`). Only set on instantiated types
     */
    public typeArguments?: BscType[];

    /**
     * For an instantiated generic type (eg. `Queue<integer>`), the type of the generic declaration (`Queue<T>`)
     */
    public genericDeclaration?: InheritableType;

    private instantiationCache: Map<string, InheritableType>;

    /**
     * Is this a generic declaration that has not been given type arguments?
     */
    public get isGenericDeclaration() {
        return !!this.typeParameters?.length && !this.typeArguments;
    }

    /**
     * Create the type that results from supplying type arguments to this generic declaration
     * (eg. `Queue<T>` + `[integer]` -> `Queue<integer>`). Every member type has the type parameters substituted.
     * Results are cached per set of type arguments
     */
    public instantiate(typeArguments: BscType[]): this {
        const declaration = this.genericDeclaration ?? this;
        if (!declaration.typeParameters?.length) {
            return this;
        }
        const bindings = createTypeParameterBindings(declaration.typeParameters, typeArguments);
        const resolvedTypeArguments = declaration.typeParameters.map(typeParam => bindings.get(typeParam.id));
        const cacheKey = resolvedTypeArguments.map(arg => getTypeKey(arg)).join(',');
        declaration.instantiationCache ??= new Map();
        const cached = declaration.instantiationCache.get(cacheKey);
        if (cached) {
            return cached as this;
        }
        const parentType = declaration.parentType ? substituteTypeParameters(declaration.parentType, bindings) : undefined;
        const instance = declaration.createInstance(parentType as InheritableType | ReferenceType);
        instance.typeArguments = resolvedTypeArguments;
        instance.genericDeclaration = declaration;
        instance.isBuiltIn = declaration.isBuiltIn;
        //register before copying members so self-referential members (eg. `function clone() as Queue<T>`) reuse this instance
        declaration.instantiationCache.set(cacheKey, instance);
        // eslint-disable-next-line no-bitwise
        for (const symbol of declaration.memberTable.getOwnSymbols(-1 as SymbolTypeFlag)) {
            instance.memberTable.addSymbol(symbol.name, symbol.data, substituteTypeParameters(symbol.type, bindings), symbol.flags);
        }
        return instance as this;
    }

    /**
     * Create a new, empty type of the same kind as this one (used by `instantiate()`)
     */
    protected createInstance(parentType?: InheritableType | ReferenceType): InheritableType {
        const ctor = this.constructor as new (name: string, parentType?: InheritableType | ReferenceType) => InheritableType;
        return new ctor(this.name, parentType);
    }

    public toString() {
        if (this.typeArguments?.length) {
            return this.name + getTypeArgumentsDisplayText(this.typeArguments);
        }
        if (this.typeParameters?.length) {
            return this.name + getTypeParametersDisplayText(this.typeParameters);
        }
        return this.name;
    }

    public toTypeString(): string {
        return 'dynamic';
    }

    protected getAncestorTypeList(): InheritableType[] {
        const ancestors = [];
        let currentParentType = this.parentType;
        while (currentParentType) {
            if (isInheritableType(currentParentType)) {
                ancestors.push(currentParentType);
                currentParentType = currentParentType.parentType;
            } else {
                break;
            }
        }
        return ancestors;
    }

    /**
     *  Checks if other type is an ancestor of this
     */
    isTypeAncestor(otherType: BscType) {
        if (!isInheritableType(otherType)) {
            return false;
        }
        // Check if targetType is an ancestor of this
        const ancestors = this.getAncestorTypeList();
        if (ancestors?.find(ancestorType => ancestorType.isEqual(otherType))) {
            return true;
        }
        return false;
    }

    /**
     *  Checks if other type is an descendent of this
     */
    isTypeDescendent(otherType: BscType) {
        if (!isInheritableType(otherType)) {
            return false;
        }
        return otherType.isTypeAncestor(this);
    }

    /**
     * Gets a string representation of the Interface that looks like javascript
     * Useful for debugging
     */
    private toJSString() {
        // eslint-disable-next-line no-bitwise
        const flags = 3 as SymbolTypeFlag; //SymbolTypeFlags.runtime | SymbolTypeFlags.typetime;
        let result = '{';
        const memberSymbols = (this.memberTable?.getAllSymbols(flags) || []).sort((a, b) => a.name.localeCompare(b.name));
        for (const symbol of memberSymbols) {
            let symbolTypeString = symbol.type.toString();
            if (isInheritableType(symbol.type)) {
                symbolTypeString = symbol.type.toJSString();
            }
            result += ' ' + symbol.name + ': ' + symbolTypeString + ';';
        }
        if (memberSymbols.length > 0) {
            result += ' ';
        }
        return result + '}';
    }

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}): boolean {
        if (this === targetType) {
            return true;
        }
        if (isReferenceType(targetType)) {
            const lowerTargetName = (targetType.memberKey ?? targetType.fullName).toLowerCase();
            const myLowerName = this.name.toLowerCase();

            if (myLowerName === lowerTargetName) {
                return true;
            }
            //check non-namespaced version
            if (myLowerName.split('.').pop() === lowerTargetName) {
                return true;
            }
        }
        if (!isInheritableType(targetType)) {
            return false;
        }
        if (!targetType) {
            return false;
        }
        if (this === targetType) {
            return true;
        }
        if (data?.allowNameEquality) {
            const thisKind = (this as any).kind;
            if (thisKind && thisKind === (targetType as any).kind) {
                if (this.toString().toLowerCase() === targetType.toString().toLowerCase()) {
                    return true;
                }
            }
        }

        if (this.isAncestorUnresolvedReferenceType() || targetType.isAncestorUnresolvedReferenceType()) {
            return this.name.toLowerCase() === targetType.name?.toLowerCase() &&
                this.isParentTypeEqual(targetType, data);
        }
        return this.name.toLowerCase() === targetType.name?.toLowerCase() &&
            this.isParentTypeEqual(targetType, data) &&
            this.checkCompatibilityBasedOnMembers(targetType, SymbolTypeFlag.runtime, data) &&
            targetType.checkCompatibilityBasedOnMembers(this, SymbolTypeFlag.runtime, data);
    }

    protected isParentTypeEqual(targetType: BscType, data?: TypeCompatibilityData): boolean {
        if (isInheritableType(targetType)) {
            const targetParent = targetType.parentType;
            if (this.parentType && !targetParent) {
                return false;
            } else if (!this.parentType && !targetParent) {
                return true;
            } else if (!this.parentType && targetParent) {
                return false;
            }
            if (isReferenceType(targetParent) || isReferenceType(this.parentType)) {
                let thisParentName = isReferenceType(this.parentType) ? this.parentType.memberKey ?? this.parentType.fullName : this.parentType.name;
                let targetParentName = isReferenceType(targetParent) ? targetParent.memberKey ?? targetParent.fullName : targetParent.name;
                return thisParentName.toLowerCase() === targetParentName.toLowerCase();
            }
            return this.parentType.isEqual(targetParent, data);
        }
        return false;
    }

    protected isAncestorUnresolvedReferenceType() {
        let p = this as InheritableType | ReferenceType;
        while (p) {
            if (isReferenceType(p) && !p.isResolvable()) {
                return true;
            }
            p = (p as InheritableType).parentType;

        }
        return false;
    }
}
