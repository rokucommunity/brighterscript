import { isAnyReferenceType, isAssignmentStatement, isAugmentedAssignmentStatement, isBinaryExpression, isCallExpression, isDynamicType, isForEachStatement, isForStatement, isFunctionExpression, isGroupingExpression, isIfStatement, isIncrementStatement, isInvalidType, isInvalidTypeLike, isObjectType, isTypedFunctionType, isUnaryExpression, isUnionType, isVariableExpression, isWhileStatement } from '../astUtils/reflection';
import type { AstNode, Expression } from '../parser/AstNode';
import type { GetTypeOptions } from '../interfaces';
import { TokenKind } from '../lexer/TokenKind';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { WalkMode } from '../astUtils/visitors';
import type { BscType } from './BscType';
import { NeverType } from './NeverType';
import { getUniqueType } from './helpers';
import { unionTypeFactory } from './UnionType';
import type { UnionType } from './UnionType';

/**
 * Narrows a type
 */
type Narrowing = (type: BscType) => BscType;

/**
 * Is the type unknown, so it can't be used for narrowing?
 */
function isUnresolved(type: BscType) {
    return !type || (isAnyReferenceType(type) && !type.isResolvable());
}

/**
 * Would a type guard for `guardType` return true for a value of type `memberType`?
 * Objects are implicitly allowed to be `invalid`, but a type guard returning true means the value is not `invalid`
 */
function isGuardedBy(memberType: BscType, guardType: BscType) {
    if (isInvalidType(memberType) && !isInvalidTypeLike(guardType) && !isDynamicType(guardType)) {
        return false;
    }
    return guardType.isTypeCompatible(memberType);
}

/**
 * Get the members of a union type, including the members of any nested unions (i.e. `(a or b) or c`)
 */
function getUnionMembers(type: UnionType): BscType[] {
    return type.types.flatMap(memberType => (isUnionType(memberType) ? getUnionMembers(memberType) : [memberType]));
}

/**
 * Get the type of a value of type `type` when a type guard for `guardType` returns true
 */
export function narrowTypeTo(type: BscType, guardType: BscType): BscType {
    if (isUnresolved(type) || isUnresolved(guardType)) {
        return type;
    }
    if (isDynamicType(type) || isObjectType(type)) {
        return guardType;
    }
    if (isUnionType(type)) {
        //keep only the members of the union the guard allows
        const narrowedTypes = getUnionMembers(type)
            .filter(memberType => isDynamicType(memberType) || isObjectType(memberType) || isGuardedBy(memberType, guardType))
            .map(memberType => (isDynamicType(memberType) || isObjectType(memberType) ? guardType : memberType));
        if (narrowedTypes.length > 0) {
            return getUniqueType(narrowedTypes, unionTypeFactory);
        }
        return guardType;
    }
    if (isGuardedBy(type, guardType)) {
        //the type is already at least as specific as the guard
        return type;
    }
    //trust the guard
    return guardType;
}

/**
 * Get the type of a value of type `type` when a type guard for `guardType` returns false
 */
export function excludeType(type: BscType, guardType: BscType): BscType {
    if (isUnresolved(type) || isUnresolved(guardType)) {
        return type;
    }
    if (isDynamicType(type) || isObjectType(type)) {
        return type;
    }
    if (isUnionType(type)) {
        const remainingTypes = getUnionMembers(type).filter(memberType => isDynamicType(memberType) || isObjectType(memberType) || !isGuardedBy(memberType, guardType));
        if (remainingTypes.length === 0) {
            return NeverType.instance;
        }
        return getUniqueType(remainingTypes, unionTypeFactory);
    }
    if (isGuardedBy(type, guardType)) {
        return NeverType.instance;
    }
    return type;
}

/**
 * Get the narrowings a condition applies to the variable `variableName` when the condition is true (or false, when `assumeTrue` is false)
 */
function getConditionNarrowings(condition: Expression, variableName: string, assumeTrue: boolean, options: GetTypeOptions): Narrowing[] {
    if (isGroupingExpression(condition)) {
        return getConditionNarrowings(condition.expression, variableName, assumeTrue, options);
    }
    if (isUnaryExpression(condition) && condition.tokens.operator?.kind === TokenKind.Not) {
        return getConditionNarrowings(condition.right, variableName, !assumeTrue, options);
    }
    if (isBinaryExpression(condition)) {
        const operatorKind = condition.tokens.operator?.kind;
        //both sides of `a and b` are true when it is true, and both sides of `a or b` are false when it is false
        if ((operatorKind === TokenKind.And && assumeTrue) || (operatorKind === TokenKind.Or && !assumeTrue)) {
            return [
                ...getConditionNarrowings(condition.left, variableName, assumeTrue, options),
                ...getConditionNarrowings(condition.right, variableName, assumeTrue, options)
            ];
        }
        //when `a or b` is true, at least one side is, so the variable is one of the two narrowed types
        if (operatorKind === TokenKind.Or && assumeTrue) {
            const leftNarrowings = getConditionNarrowings(condition.left, variableName, true, options);
            const rightNarrowings = getConditionNarrowings(condition.right, variableName, true, options);
            if (leftNarrowings.length === 0 || rightNarrowings.length === 0) {
                return [];
            }
            return [(type) => getUniqueType([applyNarrowings(type, leftNarrowings), applyNarrowings(type, rightNarrowings)], unionTypeFactory)];
        }
        return [];
    }
    if (isCallExpression(condition)) {
        return getTypeGuardCallNarrowings(condition, variableName, assumeTrue, options);
    }
    return [];
}

/**
 * Get the narrowing from a call to a type guard (i.e. `isFoo(x)`) on the variable `variableName`
 */
function getTypeGuardCallNarrowings(call: Expression & { callee: Expression; args: Expression[] }, variableName: string, assumeTrue: boolean, options: GetTypeOptions): Narrowing[] {
    //only look up the function if the variable is passed to it
    const isVariablePassed = call.args.some(arg => isVariableExpression(arg) && arg.getName()?.toLowerCase() === variableName);
    if (!isVariablePassed) {
        return [];
    }
    const calleeType = call.callee.getType({ flags: SymbolTypeFlag.runtime, statementIndex: options.statementIndex });
    if (!isTypedFunctionType(calleeType) || !calleeType.typePredicate) {
        return [];
    }
    const arg = call.args[calleeType.getTypePredicateParameterIndex()];
    if (!isVariableExpression(arg) || arg.getName()?.toLowerCase() !== variableName) {
        return [];
    }
    const guardType = calleeType.typePredicate.type;
    return [(type) => (assumeTrue ? narrowTypeTo(type, guardType) : excludeType(type, guardType))];
}

function applyNarrowings(type: BscType, narrowings: Narrowing[]) {
    for (const narrowing of narrowings) {
        type = narrowing(type);
    }
    return type;
}

/**
 * Get the name of the variable a statement assigns to, if any
 */
function getAssignedVariableName(node: AstNode): string {
    if (isAssignmentStatement(node)) {
        return node.tokens.name?.text;
    } else if ((isAugmentedAssignmentStatement(node) && isVariableExpression(node.item)) || (isIncrementStatement(node) && isVariableExpression(node.value))) {
        const target = isAugmentedAssignmentStatement(node) ? node.item : (node as any).value;
        return target.getName();
    } else if (isForEachStatement(node)) {
        return node.tokens.item?.text;
    }
}

function isLoop(node: AstNode) {
    return isWhileStatement(node) || isForStatement(node) || isForEachStatement(node);
}

/**
 * Could the variable have been assigned a new value inside `container` (an if statement's branch) by the time `node` runs?
 * That is, by an assignment before `node`, or by an assignment anywhere in a loop around `node`
 */
function isReassignedBefore(container: AstNode, variableName: string, node: AstNode) {
    const func = node.findAncestor(isFunctionExpression);
    //the outermost loop around the node that is inside the container
    let loop: AstNode;
    for (let current = node.parent; current && current !== container; current = current.parent) {
        if (isLoop(current)) {
            loop = current;
        }
    }
    const assignment = container.findChild((child) => {
        if (getAssignedVariableName(child)?.toLowerCase() !== variableName) {
            return false;
        }
        //assignments inside nested functions are to a different variable
        if (child.findAncestor(isFunctionExpression) !== func) {
            return false;
        }
        if (child.startPosition < node.startPosition) {
            return true;
        }
        return !!loop && !!child.findAncestor(ancestor => ancestor === loop);
    }, { walkMode: WalkMode.visitStatementsRecursive });
    return !!assignment;
}

/**
 * Get the type of a variable, narrowed by the conditions of the if statements and `and`/`or` expressions it is inside of
 * @param node the variable expression
 * @param type the type of the variable, before narrowing
 */
export function getNarrowedVariableType(node: Expression, type: BscType, options: GetTypeOptions): BscType {
    // eslint-disable-next-line no-bitwise
    if (!type || !(options.flags & SymbolTypeFlag.runtime) || !isVariableExpression(node)) {
        return type;
    }
    const variableName = node.getName()?.toLowerCase();
    if (!variableName) {
        return type;
    }
    //collected from the innermost condition outward
    const narrowings: Narrowing[][] = [];
    let child: AstNode = node;
    let parent = node.parent;
    while (parent && !isFunctionExpression(parent)) {
        if (isIfStatement(parent) && child !== parent.condition) {
            if (isReassignedBefore(child, variableName, node)) {
                //the variable has a new value, so this condition (and any outer ones) are not about it anymore
                break;
            }
            narrowings.push(getConditionNarrowings(parent.condition, variableName, child === parent.thenBranch, options));
        } else if (isBinaryExpression(parent) && child === parent.right) {
            //the right side of `a and b` only runs when `a` is true, and the right side of `a or b` only runs when `a` is false
            const operatorKind = parent.tokens.operator?.kind;
            if (operatorKind === TokenKind.And || operatorKind === TokenKind.Or) {
                narrowings.push(getConditionNarrowings(parent.left, variableName, operatorKind === TokenKind.And, options));
            }
        }
        child = parent;
        parent = parent.parent;
    }
    //apply the outermost conditions first
    for (let i = narrowings.length - 1; i >= 0; i--) {
        type = applyNarrowings(type, narrowings[i]);
    }
    return type;
}
