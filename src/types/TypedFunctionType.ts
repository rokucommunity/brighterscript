import { isDynamicType, isNeverType, isObjectType, isTypedFunctionType, isTypeStatementType } from '../astUtils/reflection';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

/**
 * A type predicate on a function's return type, i.e. `function isFoo(x) as x is Foo`
 */
export interface TypePredicate {
    /**
     * The name of the parameter this predicate is about
     */
    parameterName: string;
    /**
     * The type the argument is known to be when the function returns true
     */
    type: BscType;
}

export class TypedFunctionType extends BaseFunctionType {
    constructor(
        public returnType: BscType
    ) {
        super();
    }

    public readonly kind = BscTypeKind.TypedFunctionType;

    /**
     * The name of the function for this type. Can be null
     */
    public name: string;

    /**
     * Determines if this is a sub or not
     */
    public isSub = false;

    /**
     * Does this function accept more args than just those in this.params
     */
    public isVariadic = false;

    public params = [] as Array<{ name: string; type: BscType; isOptional: boolean }>;

    /**
     * If this function is a type guard (i.e. `as x is Foo`), the parameter it narrows and the type it narrows it to
     */
    public typePredicate: TypePredicate;

    public setTypePredicate(typePredicate: TypePredicate) {
        this.typePredicate = typePredicate;
        return this;
    }

    /**
     * Get the index of the parameter this function's type predicate is about, or -1 if there is none
     */
    public getTypePredicateParameterIndex() {
        const parameterName = this.typePredicate?.parameterName?.toLowerCase();
        if (!parameterName) {
            return -1;
        }
        return this.params.findIndex(param => param.name?.toLowerCase() === parameterName);
    }

    public setName(name: string) {
        this.name = name;
        return this;
    }

    public setSub(isSub: boolean) {
        this.isSub = isSub;
        return this;
    }

    public addParameter(name: string, type: BscType, isOptional: boolean) {
        this.params.push({
            name: name,
            type: type,
            isOptional: isOptional === true ? true : false
        });
        return this;
    }

    public isTypeCompatible(targetType: BscType, data: TypeCompatibilityData = {}) {
        data = data || {};
        if (!data.actualType) {
            data.actualType = targetType;
        }
        while (isTypeStatementType(targetType)) {
            targetType = targetType.wrappedType;
        }
        if (
            isNeverType(targetType) ||
            isDynamicType(targetType) ||
            isObjectType(targetType) ||
            isUnionTypeCompatible(this, targetType, data)
        ) {
            return true;
        }
        if (isTypedFunctionType(targetType)) {
            if (this === targetType) {
                return true;
            }
            return this.checkParamsAndReturnValue(targetType, true, (t1, t2, d) => t1.isTypeCompatible(t2, d), data);
        }
        return false;
    }

    public toString() {
        let paramTexts = [];
        for (let param of this.params) {
            paramTexts.push(`${param.name}${param.isOptional ? '?' : ''} as ${param.type.toString()}`);
        }
        let variadicText = '';
        if (this.isVariadic) {
            if (paramTexts.length > 0) {
                variadicText += ', ';
            }
            variadicText += '...';
        }
        const returnTypeText = this.typePredicate ? `${this.typePredicate.parameterName} is ${this.typePredicate.type?.toString()}` : this.returnType.toString();
        return `${this.isSub ? 'sub' : 'function'} ${this.name ?? ''}(${paramTexts.join(', ')}${variadicText}) as ${returnTypeText}`;
    }

    public toTypeString(): string {
        return 'Function';
    }

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}) {
        if (isTypedFunctionType(targetType)) {
            const checkNames = data?.allowNameEquality ?? true;
            if (checkNames && this.toString().toLowerCase() === targetType.toString().toLowerCase()) {
                // this function has the same param names and types and return type as the target
                return true;
            }
            return this.checkParamsAndReturnValue(targetType, false, (t1, t2, predData = {}) => {
                return t1.isEqual(t2, { ...predData, allowNameEquality: checkNames });
            }, data);
        }
        return false;
    }

    private checkParamsAndReturnValue(targetType: TypedFunctionType, allowOptionalParamDifferences: boolean, predicate: (type1: BscType, type2: BscType, data: TypeCompatibilityData) => boolean, data?: TypeCompatibilityData) {
        //compare all parameters
        let len = Math.max(this.params.length, targetType.params.length);
        for (let i = 0; i < len; i++) {
            let myParam = this.params[i];
            let targetParam = targetType.params[i];
            const paramTypeData: TypeCompatibilityData = {};
            if (allowOptionalParamDifferences && !myParam && targetParam.isOptional) {
                // target func has MORE (optional) params... that's ok
                break;
            }

            if (!myParam || !targetParam || !predicate(myParam.type, targetParam.type, paramTypeData)) {
                data = data ?? {};
                data.parameterMismatches = data.parameterMismatches ?? [];
                paramTypeData.expectedType = paramTypeData.expectedType ?? myParam?.type;
                paramTypeData.actualType = paramTypeData.actualType ?? targetParam?.type;
                if (!targetParam || !myParam) {
                    data.expectedParamCount = this.params.length;
                    data.actualParamCount = targetType.params.length;
                }
                data.parameterMismatches.push({ index: i, data: paramTypeData });
                data.expectedType = data.expectedType ?? this;
                data.actualType = data.actualType ?? targetType;
                return false;
            }
            if ((!allowOptionalParamDifferences && myParam.isOptional !== targetParam.isOptional) ||
                (!myParam.isOptional && targetParam.isOptional)) {
                data = data ?? {};
                data.parameterMismatches = data.parameterMismatches ?? [];
                data.parameterMismatches.push({ index: i, expectedOptional: myParam.isOptional, actualOptional: targetParam.isOptional, data: paramTypeData });
                data.expectedType = this;
                data.actualType = targetType;
                return false;
            }
        }
        //compare return type
        const returnTypeData: TypeCompatibilityData = {};
        if (!this.returnType || !targetType.returnType || !predicate(this.returnType, targetType.returnType, data)) {
            data = data ?? {};
            returnTypeData.expectedType = returnTypeData.expectedType ?? this.returnType;
            returnTypeData.actualType = returnTypeData.actualType ?? targetType.returnType;
            data.returnTypeMismatch = returnTypeData;
            data.expectedType = this;
            data.actualType = targetType;
            return false;
        }
        //compare type predicates. Any function returning a boolean can be used where a type guard is not expected,
        //but where a type guard is expected, the target must be a type guard for the same parameter.
        //when checking equality (no optional param differences allowed), both must have the same predicate
        if (this.typePredicate || (!allowOptionalParamDifferences && targetType.typePredicate)) {
            if (!this.typePredicate ||
                !targetType.typePredicate ||
                targetType.getTypePredicateParameterIndex() !== this.getTypePredicateParameterIndex() ||
                !predicate(this.typePredicate.type, targetType.typePredicate.type, {})
            ) {
                data = data ?? {};
                data.expectedType = data.expectedType ?? this;
                data.actualType = data.actualType ?? targetType;
                return false;
            }
        }
        //compare Variadic
        if (this.isVariadic !== targetType.isVariadic) {
            data = data ?? {};
            data.expectedVariadic = this.isVariadic;
            data.actualVariadic = targetType.isVariadic;
            data.expectedType = data.expectedType ?? this;
            data.actualType = data.actualType ?? targetType;
            return false;
        }
        //made it here, all params and return type pass predicate
        return true;
    }
}

BuiltInInterfaceAdder.typedFunctionFactory = (returnType: BscType) => {
    return new TypedFunctionType(returnType);
};
