import { isArrayType, isBrsFile, isCallExpression, isTypedFunctionType, isPrimitiveType } from '../astUtils/reflection';
import type { CallExpression, DottedGetExpression, FunctionExpression, NewExpression, VariableExpression } from '../parser/Expression';
import type { BscType, TypeContext } from './BscType';
import { LazyType } from './LazyType';
import type { Token } from '../lexer/Token';
import { UninitializedType } from './UninitializedType';
import { ParseMode } from '../parser/Parser';
import { CustomType } from './CustomType';
import { DynamicType } from './DynamicType';

/**
 * Gets the return type of a function, taking into account that the function may not have been declared yet
 * If the callee already exists in symbol table, use that return type
 * otherwise, make a lazy type which will not compute its type until the file is done parsing
 *
 * @param call the Expression to process
 * @param functionExpression the wrapping function expression
 * @return the best guess type of that expression
 */
export function getTypeFromCallExpression(call: CallExpression, functionExpression: FunctionExpression): BscType {
    let calleeName = ((call.callee as any).name as Token);
    if (calleeName) {
        const currentKnownType = functionExpression.symbolTable.getSymbolType(calleeName.text.toLowerCase());
        if (isTypedFunctionType(currentKnownType)) {
            return currentKnownType.returnType;
        }
        if (currentKnownType) {
            // this will probably only happen if a functionName has been assigned to something else previously?
            return currentKnownType;
        }
        return new LazyType((context?: TypeContext) => {
            let futureType: BscType;
            if (isBrsFile(context?.file)) {
                const file = context.file;
                futureType = file.getSymbolTypeFromToken(calleeName, functionExpression, context.scope)?.type;
            } else {
                // Give best guess if there is no file context
                futureType = functionExpression.symbolTable.getSymbolType(calleeName.text);
            }
            if (isTypedFunctionType(futureType)) {
                return futureType.returnType;
            }

            return futureType;
        });
    } else {
        //return dynamic if we can't figure out the type
        return new DynamicType();
    }
}

/**
 * Gets the type of a variable
 * if it already exists in symbol table, use that type
 * otherwise defer the type until first read, which will allow us to derive types from variables defined after this one (like from a loop perhaps)
 *
 * @param variable the Expression to process
 * @param functionExpression the wrapping function expression
 * @return the best guess type of that expression
 */
export function getTypeFromVariableExpression(variable: VariableExpression, functionExpression: FunctionExpression): BscType {
    let variableName = variable.name.text.toLowerCase();
    const currentKnownType = functionExpression.symbolTable.getSymbolType(variableName);
    if (isPrimitiveType(currentKnownType) || isArrayType(currentKnownType)) {
        // for "contextless" types, eg. myVar = 3.14
        return currentKnownType;
    }
    return resolveLazyType(variable.name, functionExpression);
}

/**
 * Gets the type of a variable
 * if it already exists in symbol table, use that type
 * otherwise defer the type until first read, which will allow us to derive types from variables defined after this one (like from a loop perhaps)
 *
 * @param newExp the Expression to process
 * @param functionExpression the wrapping function expression
 * @return the best guess type of that expression
 */
export function getTypeFromNewExpression(newExp: NewExpression, functionExpression: FunctionExpression): BscType {
    let className = newExp.className.getName(ParseMode.BrighterScript);
    return new LazyType((context?: TypeContext) => {
        return new CustomType(className, context?.scope?.getClass(className, functionExpression.namespaceName?.getName())?.memberTable);
    });
}


function resolveLazyType(currentToken: Token, functionExpression: FunctionExpression) {
    return new LazyType((context?: TypeContext) => {
        let futureType: BscType;
        if (isBrsFile(context?.file)) {
            const file = context.file;
            futureType = file.getSymbolTypeFromToken(currentToken, functionExpression, context.scope)?.type;
        } else {
            // Give best guess if there is no file context
            futureType = functionExpression.symbolTable.getSymbolType(currentToken.text) ?? new UninitializedType();
        }
        return futureType;
    });
}

/**
 * Gets the type of a variable
 * if it already exists in symbol table, use that type
 * otherwise defer the type until first read, which will allow us to derive types from variables defined after this one (like from a loop perhaps)
 *
 * @param variable the Expression to process
 * @param functionExpression the wrapping function expression
 * @return the best guess type of that expression
 */
export function getTypeFromDottedGetExpression(expr: DottedGetExpression, functionExpression: FunctionExpression): BscType {
    const currentToken = isCallExpression(expr) ? ((expr.callee) as any).name : expr.name;

    return resolveLazyType(currentToken, functionExpression);
}


