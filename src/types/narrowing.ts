import { isAnyReferenceType, isAssignmentStatement, isAugmentedAssignmentStatement, isBinaryExpression, isBlock, isCallExpression, isContinueStatement, isDottedGetExpression, isDottedSetStatement, isDynamicType, isEndStatement, isExitStatement, isForEachStatement, isForStatement, isFunctionExpression, isGotoStatement, isGroupingExpression, isIfStatement, isIncrementStatement, isIndexedSetStatement, isInvalidType, isInvalidTypeLike, isObjectType, isReturnStatement, isThrowStatement, isTryCatchStatement, isTypedFunctionType, isUnaryExpression, isUnionType, isVariableExpression, isWhileStatement } from '../astUtils/reflection';
import type { AstNode, Expression, Statement } from '../parser/AstNode';
import type { FunctionExpression } from '../parser/Expression';
import type { Block, IfStatement } from '../parser/Statement';
import type { GetTypeOptions } from '../interfaces';
import { TokenKind } from '../lexer/TokenKind';
import { SymbolTypeFlag } from '../SymbolTypeFlag';
import { SymbolTable } from '../SymbolTable';
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
 * Get the narrowings a condition applies to the variable `path` when the condition is true (or false, when `assumeTrue` is false)
 */
function getConditionNarrowings(condition: Expression, path: string, assumeTrue: boolean, options: GetTypeOptions): Narrowing[] {
    if (isGroupingExpression(condition)) {
        return getConditionNarrowings(condition.expression, path, assumeTrue, options);
    }
    if (isUnaryExpression(condition) && condition.tokens.operator?.kind === TokenKind.Not) {
        return getConditionNarrowings(condition.right, path, !assumeTrue, options);
    }
    if (isBinaryExpression(condition)) {
        const operatorKind = condition.tokens.operator?.kind;
        //both sides of `a and b` are true when it is true, and both sides of `a or b` are false when it is false
        if ((operatorKind === TokenKind.And && assumeTrue) || (operatorKind === TokenKind.Or && !assumeTrue)) {
            return [
                ...getConditionNarrowings(condition.left, path, assumeTrue, options),
                ...getConditionNarrowings(condition.right, path, assumeTrue, options)
            ];
        }
        //when `a or b` is true, at least one side is, so the variable is one of the two narrowed types
        if (operatorKind === TokenKind.Or && assumeTrue) {
            const leftNarrowings = getConditionNarrowings(condition.left, path, true, options);
            const rightNarrowings = getConditionNarrowings(condition.right, path, true, options);
            if (leftNarrowings.length === 0 || rightNarrowings.length === 0) {
                return [];
            }
            return [(type) => getUniqueType([applyNarrowings(type, leftNarrowings), applyNarrowings(type, rightNarrowings)], unionTypeFactory)];
        }
        return [];
    }
    if (isCallExpression(condition)) {
        return getTypeGuardCallNarrowings(condition, path, assumeTrue, options);
    }
    return [];
}

/**
 * Get the narrowing from a call to a type guard (i.e. `isFoo(x)` or `isFoo(m.x)`) on the reference `path`
 */
function getTypeGuardCallNarrowings(call: Expression & { callee: Expression; args: Expression[] }, path: string, assumeTrue: boolean, options: GetTypeOptions): Narrowing[] {
    //only look up the function if the reference is passed to it
    const isPathPassed = call.args.some(arg => getReferencePath(arg) === path);
    if (!isPathPassed) {
        return [];
    }
    //the function itself is not narrowed. Narrowing it would mean looking at every earlier condition again, for every condition
    const calleeType = call.callee.getType({ flags: SymbolTypeFlag.runtime, statementIndex: options.statementIndex, skipNarrowing: true });
    if (!isTypedFunctionType(calleeType) || !calleeType.typePredicate) {
        return [];
    }
    const arg = call.args[calleeType.getTypePredicateParameterIndex()];
    if (getReferencePath(arg) !== path) {
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
 * Get the reference path of an expression that narrowing can track: a variable (`x`), or a chain of dotted gets on one (`m.top.content`).
 * Paths are lower case, since brightscript is case insensitive
 */
export function getReferencePath(expression: AstNode): string {
    if (isVariableExpression(expression)) {
        return expression.getName()?.toLowerCase();
    } else if (isDottedGetExpression(expression)) {
        const objPath = getReferencePath(expression.obj);
        const name = expression.tokens.name?.text;
        if (objPath && name) {
            return `${objPath}.${name.toLowerCase()}`;
        }
    }
}

/**
 * Does the statement assign a new value to the reference `path`, or to what it is a member of (i.e. `m.top = x` changes `m.top.content`)?
 */
function assignsPath(node: AstNode, path: string): boolean {
    let assignedPath: string;
    if (isAssignmentStatement(node)) {
        assignedPath = node.tokens.name?.text?.toLowerCase();
    } else if (isDottedSetStatement(node)) {
        const objPath = getReferencePath(node.obj);
        assignedPath = objPath && `${objPath}.${node.tokens.name?.text?.toLowerCase()}`;
    } else if (isIndexedSetStatement(node)) {
        //any member of the object could have changed
        const objPath = getReferencePath(node.obj);
        return !!objPath && path.startsWith(`${objPath}.`);
    } else if (isAugmentedAssignmentStatement(node)) {
        assignedPath = getReferencePath(node.item);
    } else if (isIncrementStatement(node)) {
        assignedPath = getReferencePath(node.value);
    } else if (isForEachStatement(node)) {
        assignedPath = node.tokens.item?.text?.toLowerCase();
    }
    return !!assignedPath && (path === assignedPath || path.startsWith(`${assignedPath}.`));
}

function isLoop(node: AstNode) {
    return isWhileStatement(node) || isForStatement(node) || isForEachStatement(node);
}

/**
 * Does `container` (or any statement inside it, not counting nested functions) assign a new value to the reference `path`?
 */
function isAssignedIn(container: AstNode, path: string) {
    if (assignsPath(container, path)) {
        return true;
    }
    const assignment = container.findChild((child) => assignsPath(child, path), { walkMode: WalkMode.visitStatements });
    return !!assignment;
}

/**
 * Could this condition narrow the variable? That is, does it pass the variable to a function call, in a form `getConditionNarrowings` understands?
 * This only looks at the AST, so it is a cheap way to skip narrowing for most variables
 */
function canConditionNarrow(condition: Expression, path: string): boolean {
    if (isGroupingExpression(condition)) {
        return canConditionNarrow(condition.expression, path);
    } else if (isUnaryExpression(condition)) {
        return canConditionNarrow(condition.right, path);
    } else if (isBinaryExpression(condition)) {
        return canConditionNarrow(condition.left, path) || canConditionNarrow(condition.right, path);
    } else if (isCallExpression(condition)) {
        return condition.args.some(arg => getReferencePath(arg) === path);
    }
    return false;
}

/**
 * Does any branch of the if statement (including `else if`s and the final `else`) always exit?
 */
function hasExitingBranch(ifStatement: IfStatement) {
    let branch: IfStatement | Block = ifStatement;
    while (isIfStatement(branch)) {
        if (blockAlwaysExits(branch.thenBranch)) {
            return true;
        }
        branch = branch.elseBranch;
    }
    return blockAlwaysExits(branch);
}

/**
 * Could an earlier if statement in the block narrow the variable for the statements after it?
 */
function canEarlyExitNarrow(ifStatement: IfStatement, path: string) {
    let branch: IfStatement | Block = ifStatement;
    let canNarrow = false;
    while (isIfStatement(branch) && !canNarrow) {
        canNarrow = canConditionNarrow(branch.condition, path);
        branch = branch.elseBranch;
    }
    return canNarrow && hasExitingBranch(ifStatement);
}

/**
 * For each block, the if statements that have a branch that always exits (with their index in the block),
 * and for each reference path, the index of the first of those that could narrow it
 */
const earlyExitCache = new WeakMap<Block, {
    cacheKey: string;
    ifStatements: Array<{ index: number; ifStatement: IfStatement }>;
    firstIndexByPath: Map<string, number>;
}>();

/**
 * Get the index of the first if statement in the block that exits early and could narrow the reference `path`, or -1 if there is none.
 * Most blocks have no such if statements
 */
function getFirstEarlyExitIndex(block: Block, path: string) {
    const cacheKey = getCacheKey();
    let cached = earlyExitCache.get(block);
    if (!cached || cached.cacheKey !== cacheKey) {
        const ifStatements = [] as Array<{ index: number; ifStatement: IfStatement }>;
        for (let i = 0; i < block.statements.length; i++) {
            const statement = block.statements[i];
            if (isIfStatement(statement) && hasExitingBranch(statement)) {
                ifStatements.push({ index: i, ifStatement: statement });
            }
        }
        cached = { cacheKey: cacheKey, ifStatements: ifStatements, firstIndexByPath: new Map() };
        earlyExitCache.set(block, cached);
    }
    let firstIndex = cached.firstIndexByPath.get(path);
    if (firstIndex === undefined) {
        firstIndex = cached.ifStatements.find(x => canEarlyExitNarrow(x.ifStatement, path))?.index ?? -1;
        cached.firstIndexByPath.set(path, firstIndex);
    }
    return firstIndex;
}

/**
 * Is there any condition the variable has passed that could narrow it?
 */
function hasNarrowingCandidate(node: AstNode, path: string, func: AstNode) {
    let child: AstNode = node;
    let parent = node.parent;
    while (parent && parent !== func) {
        if (isBlock(parent)) {
            const firstIndex = getFirstEarlyExitIndex(parent, path);
            if (firstIndex >= 0 && firstIndex < parent.statements.indexOf(child as Statement)) {
                return true;
            }
        } else if (isIfStatement(parent) && child !== parent.condition) {
            if (canConditionNarrow(parent.condition, path)) {
                return true;
            }
        } else if (isBinaryExpression(parent) && child === parent.right) {
            if (canConditionNarrow(parent.left, path)) {
                return true;
            }
        }
        child = parent;
        parent = parent.parent;
    }
    return false;
}

/**
 * Does running this statement always leave the block it is in (i.e. `return`, `throw`, `exit for`, `continue`),
 * so the statements after it in the block never run?
 */
function alwaysExits(statement: AstNode): boolean {
    if (isReturnStatement(statement) || isThrowStatement(statement) || isEndStatement(statement) || isExitStatement(statement) || isContinueStatement(statement)) {
        return true;
    }
    if (isIfStatement(statement)) {
        //every branch must exit, including a final `else`
        let branch: IfStatement | Block = statement;
        while (isIfStatement(branch)) {
            if (!blockAlwaysExits(branch.thenBranch)) {
                return false;
            }
            branch = branch.elseBranch;
        }
        return !!branch && blockAlwaysExits(branch);
    }
    if (isTryCatchStatement(statement)) {
        return blockAlwaysExits(statement.tryBranch) && blockAlwaysExits(statement.catchStatement?.catchBranch);
    }
    return false;
}

function blockAlwaysExits(block: Block): boolean {
    return !!block?.statements?.some(alwaysExits);
}

/**
 * Get the narrowings for the statements after an if statement that has branches which always exit.
 * i.e. after `if not isFoo(x) then return`, `x` is known to be `Foo`
 */
function getEarlyExitNarrowings(ifStatement: IfStatement, path: string, options: GetTypeOptions): Narrowing[] {
    //the if statement and its `else if`s, and the final `else` (if there is one)
    const conditions: IfStatement[] = [];
    let finalElse: Block;
    let branch: IfStatement | Block = ifStatement;
    while (isIfStatement(branch)) {
        conditions.push(branch);
        branch = branch.elseBranch;
    }
    finalElse = branch;
    const exitingBranches = new Set<Block>([...conditions.map(x => x.thenBranch), finalElse].filter(x => blockAlwaysExits(x)));
    if (exitingBranches.size === 0) {
        return [];
    }
    //each way control can get past the if statement, and what is known on that way
    const paths: Narrowing[][] = [];
    //every earlier condition was false
    let earlierConditionsFalse: Narrowing[] = [];
    for (const condition of conditions) {
        if (!exitingBranches.has(condition.thenBranch)) {
            paths.push([...earlierConditionsFalse, ...getConditionNarrowings(condition.condition, path, true, options)]);
        }
        earlierConditionsFalse = [...earlierConditionsFalse, ...getConditionNarrowings(condition.condition, path, false, options)];
    }
    //the final `else`, or skipping every branch when there isn't one
    if (!finalElse || !exitingBranches.has(finalElse)) {
        paths.push(earlierConditionsFalse);
    }
    if (paths.length === 0) {
        //nothing after the if statement can run
        return [];
    }
    if (paths.length === 1) {
        return paths[0];
    }
    return [(type) => getUniqueType(paths.map(path => applyNarrowings(type, path)), unionTypeFactory)];
}

/**
 * Functions with `goto` can jump past an early exit, so early exits don't narrow in them
 */
const hasGotoCache = new WeakMap<AstNode, boolean>();
function hasGoto(func: FunctionExpression) {
    let result = hasGotoCache.get(func);
    if (result === undefined) {
        result = !!func?.body?.findChild(isGotoStatement, { walkMode: WalkMode.visitStatements });
        hasGotoCache.set(func, result);
    }
    return result;
}

/**
 * The narrowed type of a variable on entry to an if statement that exits early, so a later use of the variable
 * doesn't need to look at every earlier condition again.
 * Like the symbol tables' type cache, this is only valid until the scopes are linked again (i.e. `cacheVerifier` gets a new token)
 */
const entryTypeCache = new WeakMap<AstNode, Map<string, { cacheKey: string; type: BscType; result: BscType }>>();

function getCacheKey() {
    return SymbolTable.cacheVerifier?.getToken();
}

/**
 * Get the type of a variable at an early exit if statement, narrowed by the conditions before it
 */
function getEntryType(ifStatement: IfStatement, path: string, type: BscType, options: GetTypeOptions, func: FunctionExpression) {
    const cacheKey = getCacheKey();
    if (!cacheKey) {
        return narrowFrom(ifStatement, path, type, options, func);
    }
    let cache = entryTypeCache.get(ifStatement);
    const cached = cache?.get(path);
    //lookups can return a new (but equal) type object each time
    if (cached && cached.cacheKey === cacheKey && (cached.type === type || cached.type.isEqual(type))) {
        return cached.result;
    }
    const result = narrowFrom(ifStatement, path, type, options, func);
    if (!cache) {
        cache = new Map();
        entryTypeCache.set(ifStatement, cache);
    }
    cache.set(path, { cacheKey: cacheKey, type: type, result: result });
    return result;
}

/**
 * Narrow the type of a variable used at `start`, by the conditions it is known to have passed
 */
function narrowFrom(start: AstNode, path: string, type: BscType, options: GetTypeOptions, func: FunctionExpression): BscType {
    //collected from the latest condition back to the earliest
    const narrowings: Narrowing[][] = [];
    let child: AstNode = start;
    let parent = start.parent;
    walk: while (parent && parent !== func) {
        if (isBlock(parent)) {
            //look back through the statements before this one, for if statements that exit early
            const statements = parent.statements;
            for (let i = statements.indexOf(child as Statement) - 1; i >= 0; i--) {
                const statement = statements[i];
                if (isAssignedIn(statement, path)) {
                    //the variable has a new value, so earlier conditions are not about it anymore
                    break walk;
                }
                if (isIfStatement(statement) && canEarlyExitNarrow(statement, path) && !hasGoto(func)) {
                    //everything before this if statement is already known on entry to it
                    narrowings.push(getEarlyExitNarrowings(statement, path, options));
                    type = getEntryType(statement, path, type, options, func);
                    break walk;
                }
            }
        } else if (isIfStatement(parent) && child !== parent.condition) {
            narrowings.push(getConditionNarrowings(parent.condition, path, child === parent.thenBranch, options));
        } else if (isBinaryExpression(parent) && child === parent.right) {
            //the right side of `a and b` only runs when `a` is true, and the right side of `a or b` only runs when `a` is false
            const operatorKind = parent.tokens.operator?.kind;
            if (operatorKind === TokenKind.And || operatorKind === TokenKind.Or) {
                narrowings.push(getConditionNarrowings(parent.left, path, operatorKind === TokenKind.And, options));
            }
        } else if (isLoop(parent) && isAssignedIn(parent, path)) {
            //a later iteration could run after the variable gets a new value further down the loop,
            //so conditions from outside the loop are not about it anymore
            break;
        }
        child = parent;
        parent = parent.parent;
    }
    //apply the earliest conditions first
    for (let i = narrowings.length - 1; i >= 0; i--) {
        type = applyNarrowings(type, narrowings[i]);
    }
    return type;
}

/**
 * Get the type of a variable (or a dotted path on one, like `m.top.content`), narrowed by the conditions it is known to have passed:
 * the if statements it is inside of, earlier if statements in its block whose branches always exit,
 * and the left side of `and`/`or` expressions it is on the right side of
 * @param node the variable or dotted get expression
 * @param type the type of the variable, before narrowing
 */
export function getNarrowedType(node: Expression, type: BscType, options: GetTypeOptions): BscType {
    // eslint-disable-next-line no-bitwise
    if (!type || !(options.flags & SymbolTypeFlag.runtime) || options.skipNarrowing) {
        return type;
    }
    const path = getReferencePath(node);
    if (!path) {
        return type;
    }
    const func = node.findAncestor<FunctionExpression>(isFunctionExpression);
    if (!hasNarrowingCandidate(node, path, func)) {
        return type;
    }
    return narrowFrom(node, path, type, options, func);
}
