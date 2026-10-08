import type { Position, Range } from 'vscode-languageserver';
import { isConditionalCompileConstStatement, isConditionalCompileStatement, isLiteralBoolean } from '../astUtils/reflection';
import type { WalkOptions, WalkVisitor } from '../astUtils/visitors';
import { InternalWalkMode, WalkMode } from '../astUtils/visitors';
import type { Token } from '../lexer/Token';
import { TokenKind } from '../lexer/TokenKind';
import { util } from '../util';
import type { AstNode, Expression } from './AstNode';
import type { ConditionalCompileConstStatement, ConditionalCompileStatement } from './Statement';

/**
 * Works out which branches of a file's `#if` / `#else if` / `#else` statements the device would compile.
 *
 * The tree is walked once, in source order, starting from the given constants (normally the manifest `bs_const` values).
 * A `#const` takes effect only when every enclosing branch is active, and only for the `#if` statements that follow it.
 *
 * An evaluation describes the AST and constants as they were when it was created, and nothing is stored on the AST.
 * Each `BrsFile` keeps a single evaluation, and replaces it when `ast.bsConsts` no longer matches the constants the evaluation started from
 * (so a constant change applies to the next walk or lookup), or when the file is validated after it changed (so an edit to the AST applies then).
 */
export class ConditionalCompileEvaluator {

    /**
     * @param root the top of the tree to evaluate (normally the file's `Body`)
     * @param startingBsConsts the constants in effect before the first statement, with names in lowercase. Defaults to the constants of the tree (`ast.bsConsts`).
     */
    constructor(root: AstNode, startingBsConsts?: Map<string, boolean>) {
        this.root = root;
        this.startingBsConsts = new Map(startingBsConsts ?? root.getBsConsts());
        this.bsConsts = new Map(this.startingBsConsts);
        this.evaluate(root);
    }

    /**
     * The top of the evaluated tree
     */
    public readonly root: AstNode;

    /**
     * A copy of the constants this evaluation started from, with names in lowercase
     */
    public readonly startingBsConsts: ReadonlyMap<string, boolean>;

    /**
     * Do the two sets of constants hold the same names and values? A missing set is the same as an empty one.
     */
    public static areBsConstsEqual(first: ReadonlyMap<string, boolean> | undefined, second: ReadonlyMap<string, boolean> | undefined) {
        if ((first?.size ?? 0) !== (second?.size ?? 0)) {
            return false;
        }
        if (first && second) {
            for (const [name, value] of first) {
                if (second.get(name) !== value) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Make a file's evaluation available to the nodes of its tree, so every consumer shares it.
     * @internal
     * @param root the top of the file's tree
     */
    public static registerFileEvaluation(root: AstNode, source: ConditionalCompileEvaluatorSource) {
        ConditionalCompileEvaluator.fileSources.set(root, source);
    }

    /**
     * Remove the registration made by `registerFileEvaluation`
     * @internal
     * @param root the top of the file's tree
     */
    public static unregisterFileEvaluation(root: AstNode | undefined) {
        if (root) {
            ConditionalCompileEvaluator.fileSources.delete(root);
        }
    }

    /**
     * Get the evaluation of the file that contains the given node, or undefined when the node does not belong to a registered file
     * or the file has no conditional compile statements.
     */
    public static findFileEvaluation(node: AstNode) {
        return ConditionalCompileEvaluator.fileSources.get(node.getRoot() ?? node)?.conditionalCompileEvaluator;
    }

    private static fileSources = new WeakMap<AstNode, ConditionalCompileEvaluatorSource>();

    private static walkEvaluations = new WeakMap<WalkOptions, ConditionalCompileEvaluator>();

    /**
     * Get the evaluation of the file that contains the given node. When the tree does not belong to a file
     * (or the file has no evaluation) a new evaluation of the tree is created, so keep the result when asking repeatedly.
     * @param node any node of the tree
     * @param startingBsConsts replaces the constants of the tree and always creates a new evaluation
     */
    public static forNode(node: AstNode, startingBsConsts?: Map<string, boolean>) {
        const root = node.getRoot() ?? node;
        if (!startingBsConsts) {
            const fileEvaluator = ConditionalCompileEvaluator.findFileEvaluation(root);
            if (fileEvaluator) {
                return fileEvaluator;
            }
        }
        return new ConditionalCompileEvaluator(root, startingBsConsts);
    }

    /**
     * Get the evaluation to use for a walk that reached the given node.
     * This is the file's evaluation, unless `options.bsConsts` is given. Explicit constants always evaluate the tree again with those constants.
     * An evaluation created for the walk is reused by later walks with the same options object, as long as the tree and the constants are unchanged.
     */
    public static forWalk(node: AstNode, options: WalkOptions) {
        const root = node.getRoot() ?? node;
        if (!options.bsConsts) {
            const fileEvaluator = ConditionalCompileEvaluator.findFileEvaluation(root);
            if (fileEvaluator) {
                return fileEvaluator;
            }
        }
        let walkEvaluator = ConditionalCompileEvaluator.walkEvaluations.get(options);
        if (walkEvaluator?.root !== root || !ConditionalCompileEvaluator.areBsConstsEqual(walkEvaluator.startingBsConsts, options.bsConsts ?? root.getBsConsts())) {
            walkEvaluator = new ConditionalCompileEvaluator(root, options.bsConsts);
            ConditionalCompileEvaluator.walkEvaluations.set(options, walkEvaluator);
        }
        return walkEvaluator;
    }

    /**
     * Every `#const` in an active branch that redeclares a constant already in effect, as the token that names it.
     * The first declaration keeps its value.
     */
    public readonly duplicateConstNames: Token[] = [];

    /**
     * The value of every `#const` in an active branch that is not `true` or `false`. These declare nothing.
     */
    public readonly invalidConstValues: Expression[] = [];

    /**
     * Every condition token that the device evaluates (every enclosing branch is active) and that names a constant which was never declared
     */
    public readonly undeclaredConditionNames: Token[] = [];

    /**
     * Is the `then` branch of this statement compiled?
     */
    public isThenBranchActive(statement: ConditionalCompileStatement): boolean {
        return this.getBranchActivity(statement).isThenActive;
    }

    /**
     * Is the `else` branch (a block, or the next `#else if` statement) of this statement compiled?
     */
    public isElseBranchActive(statement: ConditionalCompileStatement): boolean {
        return this.getBranchActivity(statement).isElseActive;
    }

    /**
     * Is this node compiled? False when it sits in an inactive branch of any enclosing conditional compile statement.
     * When a boundary is given, only the conditional compile statements between the node and the boundary are considered.
     * Use this to ask about a node of a declaration that is itself inside an inactive branch, such as the members of an inactive class.
     */
    public isNodeActive(node: AstNode, boundary?: AstNode): boolean {
        let child = node;
        let ancestor = node.parent;
        while (ancestor && ancestor !== boundary) {
            if (isConditionalCompileStatement(ancestor)) {
                const isConditionTrue = this.getBranchActivity(ancestor).isConditionTrue;
                if (child === ancestor.thenBranch ? !isConditionTrue : isConditionTrue) {
                    return false;
                }
            }
            child = ancestor;
            ancestor = ancestor.parent;
        }
        return true;
    }

    /**
     * Does the range start inside the code of an inactive branch?
     * The `#if` / `#else if` / `#else` / `#end if` lines themselves are never inside a branch.
     */
    public isRangeInInactiveBranch(range: Range | undefined): boolean {
        if (!range) {
            return false;
        }
        const ranges = this.getMergedInactiveRanges();
        //find the last inactive range that starts at or before the position
        let low = 0;
        let high = ranges.length - 1;
        let candidate: Range | undefined;
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            if (util.comparePosition(ranges[middle].start, range.start) <= 0) {
                candidate = ranges[middle];
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return !!candidate && util.comparePosition(range.start, candidate.end) < 0;
    }

    private bsConsts: Map<string, boolean>;

    private branchActivities = new Map<ConditionalCompileStatement, BranchActivity>();

    private inactiveRanges: Range[] = [];

    private mergedInactiveRanges: Range[] | undefined;

    private isEvaluating = true;

    private evaluate(root: AstNode) {
        const visitor: WalkVisitor = (node) => {
            this.visitNode(node);
        };
        visitor(root);
        root.walk(visitor, {
            // eslint-disable-next-line no-bitwise
            walkMode: WalkMode.visitStatementsRecursive | InternalWalkMode.visitFalseConditionalCompilationBlocks
        });
        this.isEvaluating = false;
    }

    /**
     * The inactive ranges sorted by start, with overlapping and nested ranges combined
     */
    private getMergedInactiveRanges() {
        if (!this.mergedInactiveRanges) {
            const merged: Range[] = [];
            const sorted = [...this.inactiveRanges].sort((a, b) => util.comparePosition(a.start, b.start));
            for (const range of sorted) {
                const previous = merged[merged.length - 1];
                if (previous && util.comparePosition(range.start, previous.end) <= 0) {
                    if (util.comparePosition(range.end, previous.end) > 0) {
                        previous.end = range.end;
                    }
                } else {
                    merged.push({ start: range.start, end: range.end });
                }
            }
            this.mergedInactiveRanges = merged;
        }
        return this.mergedInactiveRanges;
    }

    private visitNode(node: AstNode) {
        if (isConditionalCompileStatement(node)) {
            this.getBranchActivity(node);
        } else if (isConditionalCompileConstStatement(node) && this.isNodeActive(node)) {
            this.declareConst(node);
        }
    }

    /**
     * Get the activity of the branches of a statement.
     * During the evaluation walk the first call for every statement happens at its position in the file, using the constants in effect there.
     * A statement the evaluation never visited (such as one added to the tree afterward) is evaluated against the constants in effect after the last statement
     * of the tree. That answer is not remembered, and it reports no diagnostics and no inactive ranges.
     * Because the constants are those of the end of the file, a `#const` that comes later in the file than an inserted `#if` is applied to it,
     * even though the device would not apply it.
     */
    private getBranchActivity(statement: ConditionalCompileStatement): BranchActivity {
        let activity = this.branchActivities.get(statement);
        if (!activity) {
            const isReached = this.isNodeActive(statement);
            const conditionValue = this.getConditionValue(statement, isReached && this.isEvaluating);
            activity = {
                isConditionTrue: conditionValue,
                isThenActive: isReached && conditionValue,
                isElseActive: isReached && !conditionValue
            };
            if (this.isEvaluating) {
                this.branchActivities.set(statement, activity);
                this.addInactiveRanges(statement, activity);
            }
        }
        return activity;
    }

    private getConditionValue(statement: ConditionalCompileStatement, shouldReportUndeclared: boolean) {
        const condition = statement.tokens.condition;
        let value: boolean;
        if (condition?.kind === TokenKind.True) {
            value = true;
        } else if (condition?.kind === TokenKind.False) {
            value = false;
        } else {
            const constNameLower = condition?.text.toLowerCase();
            if (shouldReportUndeclared && !this.bsConsts.has(constNameLower) && condition) {
                this.undeclaredConditionNames.push(condition);
            }
            //an undeclared constant is false
            value = this.bsConsts.get(constNameLower) === true;
        }
        return statement.tokens.not ? !value : value;
    }

    private declareConst(statement: ConditionalCompileConstStatement) {
        const assignment = statement.assignment;
        if (!isLiteralBoolean(assignment.value)) {
            this.invalidConstValues.push(assignment.value);
            return;
        }
        const constName = assignment.tokens.name;
        const constNameLower = constName.text.toLowerCase();
        if (this.bsConsts.has(constNameLower)) {
            this.duplicateConstNames.push(constName);
        } else {
            this.bsConsts.set(constNameLower, assignment.value.tokens.value.text.toLowerCase() === 'true');
        }
    }

    private addInactiveRanges(statement: ConditionalCompileStatement, activity: BranchActivity) {
        const tokens = statement.tokens;
        const elseStatement = isConditionalCompileStatement(statement.elseBranch) ? statement.elseBranch : undefined;
        if (!activity.isThenActive) {
            this.addInactiveRange(tokens.condition?.location?.range ?? tokens.hashIf?.location?.range, (tokens.hashElse ?? elseStatement?.tokens.hashIf ?? tokens.hashEndIf)?.location?.range?.start);
        }
        //an `#else if` statement describes its own branches
        if (!activity.isElseActive && tokens.hashElse) {
            this.addInactiveRange(tokens.hashElse.location?.range, tokens.hashEndIf?.location?.range?.start);
        }
    }

    /**
     * @param directiveRange the range of the last token of the directive that opens the branch. The branch starts on the following line.
     */
    private addInactiveRange(directiveRange: Range | undefined, end: Position | undefined) {
        if (directiveRange) {
            const start = { line: directiveRange.end.line + 1, character: 0 };
            this.mergedInactiveRanges = undefined;
            //a missing terminator means the branch runs to the end of the file
            this.inactiveRanges.push({
                start: start,
                end: end ?? { line: Number.MAX_SAFE_INTEGER, character: Number.MAX_SAFE_INTEGER }
            });
        }
    }
}

interface BranchActivity {
    /**
     * The value of the condition (including `not`), whether or not the statement is reached
     */
    isConditionTrue: boolean;
    isThenActive: boolean;
    isElseActive: boolean;
}

/**
 * Something that owns the evaluation of a file, and replaces it whenever the file is validated again
 */
export interface ConditionalCompileEvaluatorSource {
    /**
     * The evaluation of the file, or undefined when the file has no conditional compile statements
     */
    readonly conditionalCompileEvaluator: ConditionalCompileEvaluator | undefined;
}
