import { isBrsFile, isCallExpression, isFunctionType } from '../astUtils/reflection';
import type { CallExpression, DottedGetExpression, FunctionExpression, VariableExpression } from '../parser/Expression';
import type { BscType } from './BscType';
import { LazyType } from './LazyType';
import type { LazyTypeContext } from './LazyType';
import type { Token } from '../lexer/Token';
import { UninitializedType } from './UninitializedType';

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
        if (isFunctionType(currentKnownType)) {
            return currentKnownType.returnType;
        }
        if (currentKnownType) {
            // this will probably only happen if a functionName has been assigned to something else previously?
            return currentKnownType;
        }
        return new LazyType((context?: LazyTypeContext) => {
            // Give best guess if there is no file context
            let futureType = functionExpression.symbolTable.getSymbolType(calleeName.text);
            if (isBrsFile(context?.file)) {
                const file = context.file;
                if (context.scope) {
                    // Scope was passed in.. it is already linked
                    futureType = file.getSymbolTypeFromToken(calleeName, functionExpression, context.scope)?.type;
                } else {
                    const scopes = file.program.getScopesForFile(file);
                    for (const scope of scopes) {
                        scope.linkSymbolTable();
                        futureType = file.getSymbolTypeFromToken(calleeName, functionExpression, scope)?.type;
                        scope.unlinkSymbolTable();
                        if (futureType) {
                            break;
                        }
                    }
                }

            }
            if (isFunctionType(futureType)) {
                return futureType.returnType;
            }

            return futureType;
        });
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
    if (currentKnownType) {
        return currentKnownType;
    }
    return new LazyType((context?: LazyTypeContext) => {
        return functionExpression.symbolTable.getSymbolType(variableName, true, context);
    });
}


function resolveLazyType(currentToken: Token, functionExpression: FunctionExpression) {
    return new LazyType((context?: LazyTypeContext) => {
        let futureType = new UninitializedType();
        if (isBrsFile(context?.file)) {
            const file = context.file;
            if (context.scope) {
                // Scope was passed in.. it is already linked
                futureType = file.getSymbolTypeFromToken(currentToken, functionExpression, context.scope)?.type;
            } else {
                const scopes = file.program.getScopesForFile(file);
                for (const scope of scopes) {
                    scope.linkSymbolTable();
                    futureType = file.getSymbolTypeFromToken(currentToken, functionExpression, scope)?.type;
                    scope.unlinkSymbolTable();
                    if (futureType) {
                        break;
                    }
                }
            }
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
