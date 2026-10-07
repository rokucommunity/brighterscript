import { isBinaryExpression, isConditionalCompileStatement, isEndStatement, isExitStatement, isForEachStatement, isForStatement, isGotoStatement, isGroupingExpression, isIfStatement, isLabelStatement, isLiteralExpression, isReturnStatement, isThrowStatement, isContinueStatement, isTryCatchStatement, isUnaryExpression, isWhileStatement } from '../../astUtils/reflection';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import type { FunctionExpression } from '../../parser/Expression';
import type { Block, ConditionalCompileStatement, ForEachStatement, ForStatement, IfStatement, WhileStatement } from '../../parser/Statement';
import util from '../../util';
import type { Location } from 'vscode-languageserver';

/**
 * Find the runs of statements in a function body that control flow can never reach, given the current `bs_const` values.
 *
 * Reachability flows through the statements in order. Once a statement makes control leave (return, throw, end, goto, exit, continue,
 * an `if` where every branch exits, a `try` where both blocks exit, or an infinite `while`), the statements that follow are
 * unreachable up to the next label, at any depth, because a label is a possible `goto` target. A label resets reachability from that point
 * to the end of its block, and the code after the statement that contains the label is reachable unless a later exit occurs.
 * `stop` does not exit, since execution resumes when the debugger continues.
 * The active branch of a conditional compile statement is analyzed as if its statements were written inline in the enclosing block,
 * so an exit in it makes the code after `#end if` unreachable. Inactive branches are ignored completely.
 * Nested anonymous functions are not entered, they need their own call.
 *
 * A run is one diagnostic, from its first statement to its last. A run that spans a conditional compile boundary stays one range
 * when it begins before the `#if`. A run that begins inside an active branch ends at `#end if`, and the code after it is a separate run.
 * Statements that contain a label are never part of a run themselves, only the statements inside them that precede the label are.
 * A `while` loop that contains a label and is entered unreachable is analyzed as reachable from the top of its body, because a `goto` to the label
 * lets the loop run again from its first statement. No run extends across such a loop's header.
 *
 * Every statement is visited a constant number of times, so the cost is linear in the number of statements.
 */
export function findUnreachableRegions(func: FunctionExpression): ControlFlowAnalysis {
    const analysis = new ReachabilityAnalysis(func);
    analysis.analyzeBlock(func.body, undefined);
    return {
        regions: analysis.regions,
        unreachableNodes: analysis.unreachableNodes,
        coveredConditionalCompileChains: analysis.coveredConditionalCompileChains,
        partiallyCoveredConditionalCompileChains: analysis.partiallyCoveredConditionalCompileChains
    };
}

/**
 * Is the node inside a branch of a conditional compile statement that the device never compiles?
 */
export function isInsideInactiveConditionalCompileBranch(node: AstNode): boolean {
    let child: AstNode = node;
    let parent = node.parent;
    while (parent) {
        if (isConditionalCompileStatement(parent) && parent.resolution) {
            if (child === parent.thenBranch && !(parent.resolution.isReached && parent.resolution.isConditionTrue)) {
                return true;
            }
            if (child === parent.elseBranch && !isConditionalCompileStatement(child) && !(parent.resolution.isReached && !parent.resolution.isConditionTrue)) {
                return true;
            }
        }
        child = parent;
        parent = parent.parent;
    }
    return false;
}

/**
 * Fold a condition made only of `true`, `false`, parentheses, `not`, `and` and `or`.
 * Comparisons, arithmetic, consts, enums and calls are never folded.
 * @returns the value of the condition, or undefined when it is not known
 */
export function evaluateLiteralCondition(expression: Expression | undefined): boolean | undefined {
    if (isGroupingExpression(expression)) {
        return evaluateLiteralCondition(expression.expression);
    } else if (isLiteralExpression(expression)) {
        if (expression.tokens.value.kind === TokenKind.True) {
            return true;
        } else if (expression.tokens.value.kind === TokenKind.False) {
            return false;
        }
    } else if (isUnaryExpression(expression) && expression.tokens.operator.kind === TokenKind.Not) {
        const operandValue = evaluateLiteralCondition(expression.right);
        return operandValue === undefined ? undefined : !operandValue;
    } else if (isBinaryExpression(expression)) {
        const operatorKind = expression.tokens.operator.kind;
        if (operatorKind === TokenKind.And || operatorKind === TokenKind.Or) {
            const leftValue = evaluateLiteralCondition(expression.left);
            const rightValue = evaluateLiteralCondition(expression.right);
            const decidingValue = operatorKind === TokenKind.And ? false : true;
            if (leftValue === decidingValue || rightValue === decidingValue) {
                return decidingValue;
            } else if (leftValue !== undefined && rightValue !== undefined) {
                return !decidingValue;
            }
        }
    }
    return undefined;
}

const reasons = {
    return: 'Unreachable code after return',
    throw: 'Unreachable code after throw',
    end: 'Unreachable code after end',
    goto: 'Unreachable code after goto',
    exitFor: 'Unreachable code after exit for',
    exitWhile: 'Unreachable code after exit while',
    exit: 'Unreachable code after exit',
    continue: 'Unreachable code after continue',
    ifBranchesExit: 'Unreachable code after an if statement whose branches all exit',
    tryCatchExit: 'Unreachable code after a try/catch whose blocks both exit',
    infiniteLoop: 'Unreachable code after an infinite loop',
    conditionAlwaysFalse: 'Unreachable code: condition is always false',
    earlierConditionAlwaysTrue: 'Unreachable code: an earlier condition is always true'
};

/**
 * Reasons that mark a branch the condition rules out, as opposed to a branch that exits on its own
 */
const conditionReasons = new Set<string>([reasons.conditionAlwaysFalse, reasons.earlierConditionAlwaysTrue]);

class ReachabilityAnalysis {
    public readonly regions: UnreachableRegion[] = [];

    /**
     * The statements that sit inside a reported run
     */
    public readonly unreachableNodes = new Set<AstNode>();

    /**
     * The first statement of every conditional compile chain that a reported run extends past the end of
     */
    public readonly coveredConditionalCompileChains = new Set<AstNode>();

    /**
     * The first statement of every conditional compile chain that a reported run enters but ends inside, mapped to that run's location
     */
    public readonly partiallyCoveredConditionalCompileChains = new Map<AstNode, Location>();

    /**
     * Statements that contain a label at any depth, not counting nested functions or inactive conditional compile branches
     */
    private readonly labelContainers = new Set<Statement>();

    /**
     * Why control cannot reach the statement being visited, or undefined when it can
     */
    private exitReason: string | undefined;

    private run: UnreachableRun | undefined;

    private gotoCount = 0;

    private readonly loops: LoopState[] = [];

    constructor(func: FunctionExpression) {
        this.markLabelContainersInStatements(func.body?.statements);
    }

    /**
     * Analyze a block starting from the given reachability.
     * @returns the reachability at the end of the block
     */
    public analyzeBlock(block: Block | undefined, entryReason: string | undefined): string | undefined {
        this.exitReason = entryReason;
        for (const statement of block?.statements ?? []) {
            this.analyzeStatement(statement);
        }
        this.flushRun();
        return this.exitReason;
    }

    private analyzeStatement(statement: Statement) {
        if (isLabelStatement(statement)) {
            this.flushRun();
            this.exitReason = undefined;
            return;
        } else if (isConditionalCompileStatement(statement)) {
            this.analyzeConditionalCompile(statement);
            return;
        }
        const entryReason = this.exitReason;
        if (entryReason && !this.labelContainers.has(statement)) {
            this.extendRun(statement, entryReason);
            this.skipStatement(statement, 0, 0);
            return;
        }
        if (isReturnStatement(statement)) {
            this.exitReason = reasons.return;
        } else if (isThrowStatement(statement)) {
            this.exitReason = reasons.throw;
        } else if (isEndStatement(statement)) {
            this.exitReason = reasons.end;
        } else if (isGotoStatement(statement)) {
            this.gotoCount++;
            this.exitReason = reasons.goto;
        } else if (isExitStatement(statement)) {
            const loopKind = statement.tokens.loopType?.kind;
            this.recordLoopJump(loopKind, 'hasExit');
            if (loopKind === TokenKind.For) {
                this.exitReason = reasons.exitFor;
            } else if (loopKind === TokenKind.While) {
                this.exitReason = reasons.exitWhile;
            } else {
                this.exitReason = reasons.exit;
            }
        } else if (isContinueStatement(statement)) {
            this.recordLoopJump(statement.tokens.loopType?.kind, 'hasContinue');
            this.exitReason = reasons.continue;
        } else if (isIfStatement(statement)) {
            this.exitReason = this.analyzeIf(statement, entryReason);
        } else if (isTryCatchStatement(statement)) {
            const tryEnd = this.analyzeBlock(statement.tryBranch, entryReason);
            const catchEnd = this.analyzeBlock(statement.catchStatement?.catchBranch, entryReason);
            this.exitReason = this.mergeBranchEnds(entryReason, [tryEnd, catchEnd], reasons.tryCatchExit, false);
        } else if (isWhileStatement(statement) || isForStatement(statement) || isForEachStatement(statement)) {
            this.exitReason = this.analyzeLoop(statement, entryReason);
        }
    }

    private analyzeIf(ifStatement: IfStatement, entryReason: string | undefined): string | undefined {
        const branchEnds: Array<string | undefined> = [];
        let hasFinalElse = false;
        let isEarlierConditionTrue = false;
        let branch: IfStatement | Block | undefined = ifStatement;
        while (branch) {
            if (isIfStatement(branch)) {
                const conditionValue = evaluateLiteralCondition(branch.condition);
                let conditionReason: string | undefined;
                if (isEarlierConditionTrue) {
                    conditionReason = reasons.earlierConditionAlwaysTrue;
                } else if (conditionValue === false) {
                    conditionReason = reasons.conditionAlwaysFalse;
                }
                branchEnds.push(this.analyzeBlock(branch.thenBranch, entryReason ?? conditionReason));
                isEarlierConditionTrue = isEarlierConditionTrue || conditionValue === true;
                branch = branch.elseBranch;
            } else {
                hasFinalElse = true;
                branchEnds.push(this.analyzeBlock(branch, entryReason ?? (isEarlierConditionTrue ? reasons.earlierConditionAlwaysTrue : undefined)));
                branch = undefined;
            }
        }
        return this.mergeBranchEnds(entryReason, branchEnds, reasons.ifBranchesExit, !hasFinalElse);
    }

    /**
     * @param entryReason why control could not reach the statement that owns the branches, if it could not
     * @param branchEnds the reachability at the end of each branch
     * @param exhaustiveReason the reason reported when every branch exits
     * @param hasFallthrough can control skip every branch, such as an `if` with no `else`
     * @returns the reachability after the statement that owns the branches
     */
    private mergeBranchEnds(entryReason: string | undefined, branchEnds: Array<string | undefined>, exhaustiveReason: string, hasFallthrough: boolean): string | undefined {
        if (entryReason) {
            return branchEnds.some(branchEnd => !branchEnd) ? undefined : entryReason;
        }
        const everyBranchExits = !hasFallthrough && branchEnds.every(branchEnd => branchEnd && !conditionReasons.has(branchEnd));
        return everyBranchExits ? exhaustiveReason : undefined;
    }

    private analyzeLoop(loopStatement: WhileStatement | ForStatement | ForEachStatement, entryReason: string | undefined): string | undefined {
        const isWhile = isWhileStatement(loopStatement);
        const conditionValue = isWhile ? evaluateLiteralCondition(loopStatement.condition) : undefined;
        const loop: LoopState = { kind: isWhile ? TokenKind.While : TokenKind.For, hasExit: false, hasContinue: false };
        const gotoCountBefore = this.gotoCount;
        const isBodyReachableFromLoopBack = isWhile && !!entryReason && conditionValue !== false && this.labelContainers.has(loopStatement);
        if (isBodyReachableFromLoopBack) {
            this.flushRun();
        }
        this.loops.push(loop);
        const bodyEnd = this.analyzeBlock(loopStatement.body, isBodyReachableFromLoopBack ? undefined : entryReason ?? (conditionValue === false ? reasons.conditionAlwaysFalse : undefined));
        this.loops.pop();
        const hasGoto = this.gotoCount !== gotoCountBefore;
        if (isBodyReachableFromLoopBack) {
            return loop.hasExit || hasGoto || conditionValue !== true ? undefined : entryReason;
        } else if (entryReason) {
            const isLoopHeadReachable = !bodyEnd || loop.hasContinue;
            const canLeaveLoop = loop.hasExit || hasGoto || (isLoopHeadReachable && conditionValue !== true);
            return canLeaveLoop ? undefined : entryReason;
        }
        return conditionValue === true && !loop.hasExit && !hasGoto ? reasons.infiniteLoop : undefined;
    }

    /**
     * Analyze the active branch inline. A run that is already open when the chain starts continues through it as one range.
     * That range covers the chain's inactive branches only when it extends past the end of the chain, which is decided when the run is flushed.
     * A run that begins inside the chain ends where the chain ends, so it never overlaps the hint for an inactive branch of the same chain.
     */
    private analyzeConditionalCompile(statement: ConditionalCompileStatement) {
        const runAtEntry = this.run;
        this.run?.enteredChains.push(statement);
        for (const branchStatement of getActiveConditionalCompileBranch(statement)?.statements ?? []) {
            this.analyzeStatement(branchStatement);
        }
        if (this.run !== runAtEntry) {
            this.flushRun();
        }
    }

    /**
     * Visit a statement that is entirely unreachable, only to count the gotos and loop exits inside it.
     * A jump counts toward the enclosing loops it targets, which keeps a `while true` from being reported as infinite on the strength of dead code.
     * @param statement the unreachable statement
     * @param nestedWhileDepth how many `while` loops inside the statement enclose the current one
     * @param nestedForDepth how many `for` and `for each` loops inside the statement enclose the current one
     */
    private skipStatement(statement: Statement, nestedWhileDepth: number, nestedForDepth: number) {
        if (isGotoStatement(statement)) {
            this.gotoCount++;
        } else if (isExitStatement(statement) || isContinueStatement(statement)) {
            const loopKind = statement.tokens.loopType?.kind;
            const nestedDepth = loopKind === TokenKind.For ? nestedForDepth : nestedWhileDepth;
            if (nestedDepth === 0) {
                this.recordLoopJump(loopKind, isExitStatement(statement) ? 'hasExit' : 'hasContinue');
            }
        } else if (isIfStatement(statement)) {
            let branch: IfStatement | Block | undefined = statement;
            while (branch) {
                if (isIfStatement(branch)) {
                    this.skipBlock(branch.thenBranch, nestedWhileDepth, nestedForDepth);
                    branch = branch.elseBranch;
                } else {
                    this.skipBlock(branch, nestedWhileDepth, nestedForDepth);
                    branch = undefined;
                }
            }
        } else if (isTryCatchStatement(statement)) {
            this.skipBlock(statement.tryBranch, nestedWhileDepth, nestedForDepth);
            this.skipBlock(statement.catchStatement?.catchBranch, nestedWhileDepth, nestedForDepth);
        } else if (isWhileStatement(statement)) {
            this.skipBlock(statement.body, nestedWhileDepth + 1, nestedForDepth);
        } else if (isForStatement(statement) || isForEachStatement(statement)) {
            this.skipBlock(statement.body, nestedWhileDepth, nestedForDepth + 1);
        } else if (isConditionalCompileStatement(statement)) {
            this.skipBlock(getActiveConditionalCompileBranch(statement), nestedWhileDepth, nestedForDepth);
        }
    }

    private skipBlock(block: Block | undefined, nestedWhileDepth: number, nestedForDepth: number) {
        for (const statement of block?.statements ?? []) {
            this.skipStatement(statement, nestedWhileDepth, nestedForDepth);
        }
    }

    /**
     * Note an `exit` or `continue` on the innermost loop of the kind it targets
     */
    private recordLoopJump(loopKind: TokenKind | undefined, flag: 'hasExit' | 'hasContinue') {
        const targetKind = loopKind === TokenKind.For ? TokenKind.For : TokenKind.While;
        for (let index = this.loops.length - 1; index >= 0; index--) {
            if (this.loops[index].kind === targetKind) {
                this.loops[index][flag] = true;
                return;
            }
        }
    }

    private extendRun(statement: Statement, reason: string) {
        if (!statement.location) {
            return;
        }
        this.unreachableNodes.add(statement);
        if (!this.run) {
            this.run = { first: statement, last: statement, reason: reason, enteredChains: [] };
        }
        this.run.last = statement;
    }

    private flushRun() {
        if (!this.run) {
            return;
        }
        const location = util.createBoundingLocation(this.run.first, this.run.last);
        if (location) {
            this.regions.push({ location: location, message: this.run.reason });
            for (const chain of this.run.enteredChains) {
                this.classifyChainCoverage(chain, location);
            }
        }
        this.run = undefined;
    }

    private classifyChainCoverage(chain: ConditionalCompileStatement, runLocation: Location) {
        const chainRange = chain.location?.range;
        if (!chainRange) {
            return;
        }
        if (util.comparePosition(runLocation.range.end, chainRange.end) >= 0) {
            this.coveredConditionalCompileChains.add(chain);
        } else if (util.comparePosition(runLocation.range.end, chainRange.start) > 0) {
            this.partiallyCoveredConditionalCompileChains.set(chain, runLocation);
        }
    }

    private markLabelContainersInStatements(statements: Statement[] | undefined): boolean {
        let hasLabel = false;
        for (const statement of statements ?? []) {
            hasLabel = this.markLabelContainer(statement) || hasLabel;
        }
        return hasLabel;
    }

    private markLabelContainersInBlock(block: Block | undefined): boolean {
        return this.markLabelContainersInStatements(block?.statements);
    }

    /**
     * @returns true when the statement is a label or contains one
     */
    private markLabelContainer(statement: Statement): boolean {
        let hasLabel = false;
        if (isLabelStatement(statement)) {
            return true;
        } else if (isIfStatement(statement)) {
            let branch: IfStatement | Block | undefined = statement;
            while (branch) {
                if (isIfStatement(branch)) {
                    hasLabel = this.markLabelContainersInBlock(branch.thenBranch) || hasLabel;
                    branch = branch.elseBranch;
                } else {
                    hasLabel = this.markLabelContainersInBlock(branch) || hasLabel;
                    branch = undefined;
                }
            }
        } else if (isTryCatchStatement(statement)) {
            hasLabel = this.markLabelContainersInBlock(statement.tryBranch);
            hasLabel = this.markLabelContainersInBlock(statement.catchStatement?.catchBranch) || hasLabel;
        } else if (isWhileStatement(statement) || isForStatement(statement) || isForEachStatement(statement)) {
            hasLabel = this.markLabelContainersInBlock(statement.body);
        } else if (isConditionalCompileStatement(statement)) {
            hasLabel = this.markLabelContainersInBlock(getActiveConditionalCompileBranch(statement));
        }
        if (hasLabel) {
            this.labelContainers.add(statement);
        }
        return hasLabel;
    }
}

/**
 * The branch of a conditional compile chain that the device compiles, if any
 */
function getActiveConditionalCompileBranch(chainStart: ConditionalCompileStatement): Block | undefined {
    let statement = chainStart;
    while (statement?.resolution) {
        const resolution = statement.resolution;
        if (resolution.isReached && resolution.isConditionTrue) {
            return statement.thenBranch;
        }
        const elseBranch = statement.elseBranch;
        if (isConditionalCompileStatement(elseBranch)) {
            statement = elseBranch;
        } else {
            return elseBranch && resolution.isReached ? elseBranch : undefined;
        }
    }
    return undefined;
}

export interface ControlFlowAnalysis {
    regions: UnreachableRegion[];
    /**
     * The statements that sit inside a reported run. A node inside one of them is already covered by that report.
     */
    unreachableNodes: Set<AstNode>;
    /**
     * The first statement of each conditional compile chain that a reported run extends past the end of.
     * The run that covers the chain also covers its inactive branches.
     */
    coveredConditionalCompileChains: Set<AstNode>;
    /**
     * The first statement of each conditional compile chain that a reported run enters but ends inside, mapped to that run's location.
     * Only the inactive branches that the run overlaps are covered by it.
     */
    partiallyCoveredConditionalCompileChains: Map<AstNode, Location>;
}

export interface UnreachableRegion {
    /**
     * From the start of the first unreachable statement to the end of the last one
     */
    location: Location;
    /**
     * The complete diagnostic message
     */
    message: string;
}

interface UnreachableRun {
    first: Statement;
    last: Statement;
    reason: string;
    /**
     * The conditional compile chains whose first statement was reached while this run was open
     */
    enteredChains: ConditionalCompileStatement[];
}

interface LoopState {
    kind: TokenKind.For | TokenKind.While;
    /**
     * Does an `exit` target this loop?
     */
    hasExit: boolean;
    /**
     * Does a `continue` target this loop?
     */
    hasContinue: boolean;
}
