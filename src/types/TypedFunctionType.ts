import { isDynamicType, isObjectType, isTypedFunctionType, isTypeStatementType } from '../astUtils/reflection';
import { BaseFunctionType } from './BaseFunctionType';
import type { BscType } from './BscType';
import { BscTypeKind } from './BscTypeKind';
import { isUnionTypeCompatible } from './helpers';
import { BuiltInInterfaceAdder } from './BuiltInInterfaceAdder';
import type { TypeCompatibilityData } from '../interfaces';

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

    /**
     * Is this a closure: an arrow function that captures variables from the function it is written in?
     * Closures are associative arrays at runtime (`{ ctx: {...}, fn: function(__bsc_ctx, ...) }`) rather than plain functions,
     * so they are never interchangeable with `function` types, `dynamic` or `object`
     */
    public isClosure = false;

    public params = [] as Array<{ name: string; type: BscType; isOptional: boolean }>;

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
            //a closure is an AA at runtime and a plain function is not, so neither can stand in for the other
            if (this.isClosure !== targetType.isClosure) {
                data.expectedType = data.expectedType ?? this;
                data.actualType = data.actualType ?? targetType;
                return false;
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
        let keyword = this.isSub ? 'sub' : 'function';
        if (this.isClosure) {
            keyword = 'closure';
        }
        return `${keyword} ${this.name ?? ''}(${paramTexts.join(', ')}${variadicText}) as ${this.returnType.toString()}`;
    }

    public toTypeString(): string {
        //closures are associative arrays at runtime
        return this.isClosure ? 'object' : 'Function';
    }

    isEqual(targetType: BscType, data: TypeCompatibilityData = {}) {
        if (isTypedFunctionType(targetType)) {
            if (this.isClosure !== targetType.isClosure) {
                return false;
            }
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
