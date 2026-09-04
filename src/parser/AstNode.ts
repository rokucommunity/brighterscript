import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import { WalkMode } from '../astUtils/visitors';
import type { Position, Range } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { InternalWalkMode } from '../astUtils/visitors';
import type { SymbolTable } from '../SymbolTable';
import type { BrsTranspileState } from './BrsTranspileState';
import type { TranspileResult } from '../interfaces';
import type { AnnotationExpression } from './Expression';
import util from '../util';

/**
 * A BrightScript AST node
 */
export abstract class AstNode {
    /**
     *  The starting and ending location of the node.
     */
    public abstract range: Range | undefined;

    public abstract transpile(state: BrsTranspileState): TranspileResult;

    /**
     * Get the typedef for this node. (defaults to transpiling the node, should be overridden by subclasses if there's a more specific typedef requirement)
     */
    public getTypedef(state: BrsTranspileState) {
        return this.transpile(state);
    }

    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitStatements;

    public abstract walk(visitor: WalkVisitor, options: WalkOptions);

    /**
     * The parent node for this statement. This is set dynamically during `onFileValidate`, and should not be set directly.
     */
    public parent?: AstNode;

    /**
     * Certain expressions or statements can have a symbol table (such as blocks, functions, namespace bodies, etc).
     * If you're interested in getting the closest SymbolTable, use `getSymbolTable` instead.
     */
    public symbolTable?: SymbolTable;

    /**
     * Get the closest symbol table for this node
     */
    public getSymbolTable(): SymbolTable {
        let node: AstNode = this;
        while (node) {
            if (node.symbolTable) {
                return node.symbolTable;
            }
            node = node.parent!;
        }

        //justification: we are following a chain of nodes until we get to one with a SymbolTable,
        //and the top-level node will always have a SymbolTable. So we'll never hit this undefined,
        //but it is not so easy to convince the typechecker of this.
        return undefined as any;
    }

    /**
     * Walk upward and return the first node that results in `true` from the matcher.
     * @param matcher a function called for each node. If you return true, this function returns the specified node. If you return a node, that node is returned. all other return values continue the loop
     *                The function's second parameter is a cancellation token. If you'd like to short-circuit the walk, call `cancellationToken.cancel()`, then this function will return `undefined`
     */
    public findAncestor<TNode extends AstNode = AstNode>(matcher: (node: AstNode, cancellationToken: CancellationTokenSource) => boolean | AstNode | undefined | void): TNode | undefined {
        let node = this.parent;

        const cancel = new CancellationTokenSource();
        while (node) {
            let matcherValue = matcher(node, cancel);
            if (cancel.token.isCancellationRequested) {
                return;
            }
            if (matcherValue) {
                cancel.cancel();
                return (matcherValue === true ? node : matcherValue) as TNode;

            }
            node = node.parent;
        }
    }

    /**
     * Find the first child where the matcher evaluates to true.
     * @param matcher a function called for each node. If you return true, this function returns the specified node. If you return a node, that node is returned. all other return values continue the loop
     */
    public findChild<TNode = AstNode>(matcher: (node: AstNode, cancellationSource) => boolean | AstNode | undefined | void, options?: WalkOptions): TNode | undefined {
        const cancel = new CancellationTokenSource();
        let result: AstNode | undefined;
        this.walk((node) => {
            const matcherValue = matcher(node, cancel);
            if (matcherValue) {
                cancel.cancel();
                result = matcherValue === true ? node : matcherValue;
            }
        }, {
            walkMode: WalkMode.visitAllRecursive,
            ...options ?? {},
            cancel: cancel.token
        });
        return result as unknown as TNode;
    }

    /**
     * FInd the deepest child that includes the given position
     */
    public findChildAtPosition<TNodeType extends AstNode = AstNode>(position: Position, options?: WalkOptions): TNodeType | undefined {
        return this.findChild<TNodeType>((node) => {
            //if the current node includes this range, keep that node
            if (util.rangeContains(node.range, position)) {
                return node.findChildAtPosition(position, options) ?? node;
            }
        }, options);
    }

    /**
     * Links all child nodes to their parent AstNode, and the same with symbol tables. This performs a full AST walk, so you should use this sparingly
     */
    public link() {
        //the act of walking causes the nodes to be linked
        this.walk(() => { }, {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    /**
     * The child node that this node continues its chain into, or undefined if this node
     * does not form a chain.
     *
     * An expression "chain" is a sequence of accesses/calls applied to a single base value,
     * such as `alpha.beta[1].charlie()`. Chains are stored inverted in the AST: the outermost
     * node is the top of the tree and the base value is the deepest descendant. This getter
     * returns the single child that continues the chain, ignoring children (such as call
     * arguments or index expressions) that merely *contain* other, unrelated chains.
     *
     * Nodes that form a chain override this.
     */
    public get chainChild(): AstNode | undefined {
        return undefined;
    }

    /**
     * The parent node, but only when this node continues that parent's chain.
     *
     * This is what makes it possible to walk to the "end" of a chain without accidentally
     * stepping out into an unrelated enclosing expression. For example, in
     * `doSomething(alpha.beta)`, walking `.parent` from `alpha` eventually reaches the
     * `CallExpression`, but `alpha.beta` is an *argument* of that call rather than part of
     * its chain, so the `DottedGetExpression` returns `undefined` here and the walk stops.
     */
    public get chainParent(): AstNode | undefined {
        const parent = this.parent;
        return parent?.chainChild === this ? parent : undefined;
    }

    /**
     * Is this node the start (i.e. the base value) of an expression chain?
     *
     * This is the "end" of the chain that a `.parent` walk terminates at. For `alpha.beta.charlie`,
     * the `VariableExpression` for `alpha` is the chain start.
     */
    public isChainStart(): boolean {
        return !this.chainChild;
    }

    /**
     * Is this node the end (i.e. the outermost node) of an expression chain?
     *
     * A node is terminal when nothing above it continues its chain, meaning it represents the
     * complete expression rather than some inner piece of one. Every statement is terminal, and
     * so is any expression that isn't itself a chain link of its parent.
     *
     * For example, given:
     * ```
     * print alpha.beta.charlie(1 + 2)
     * ```
     * the following nodes are terminal:
     * - `PrintStatement`
     * - `CallExpression` (`alpha.beta.charlie(1 + 2)`) — the whole chain
     * - `BinaryExpression` (`1 + 2`) — a new chain, since it's an argument
     * - `LiteralExpression` (`1`) and `LiteralExpression` (`2`)
     *
     * while `alpha.beta.charlie`, `alpha.beta`, and `alpha` are not, because each is a link in
     * the chain ending at the `CallExpression`.
     */
    public isTerminal(): boolean {
        return !this.chainParent;
    }

    /**
     * Walk up the chain and return its outermost (terminal) node. Returns this node when it is
     * already terminal.
     *
     * For `alpha.beta.charlie(1 + 2)`, calling this on `alpha` returns the `CallExpression`.
     */
    public getChainEnd<TNode extends AstNode = AstNode>(): TNode {
        let node: AstNode = this;
        let chainParent: AstNode;
        while ((chainParent = node.chainParent)) {
            node = chainParent;
        }
        return node as TNode;
    }

    /**
     * Walk down the chain and return its innermost node (the base value the chain is applied to).
     * Returns this node when it is already the start of a chain.
     *
     * For `alpha.beta.charlie(1 + 2)`, calling this on the `CallExpression` returns the
     * `VariableExpression` for `alpha`.
     */
    public getChainStart<TNode extends AstNode = AstNode>(): TNode {
        let node: AstNode = this;
        let chainChild: AstNode;
        while ((chainChild = node.chainChild)) {
            node = chainChild;
        }
        return node as TNode;
    }

    /**
     * Get every node in this node's chain, ordered from the chain start (base value) to the
     * chain end (outermost node). The returned array always includes this node.
     *
     * For any node in `alpha.beta.charlie(1 + 2)`, this returns
     * `[alpha, alpha.beta, alpha.beta.charlie, alpha.beta.charlie(1 + 2)]`.
     */
    public getChain(): AstNode[] {
        const result: AstNode[] = [];
        let node: AstNode = this.getChainEnd();
        while (node) {
            result.unshift(node);
            node = node.chainChild;
        }
        return result;
    }

    /**
     * Clone this node and all of its children. This creates a completely detached and identical copy of the AST.
     * All tokens, statements, expressions, range, and location are cloned.
     */
    public abstract clone(): AstNode;

    /**
     * Helper function for creating a clone. This will clone any attached annotations, as well as reparent the cloned node's children to the clone
     */
    protected finalizeClone<T extends AstNode>(
        clone: T,
        propsToReparent?: Array<{ [K in keyof T]: T[K] extends AstNode | AstNode[] ? K : never }[keyof T]>
    ) {
        //clone the annotations if they exist
        if (Array.isArray((this as unknown as Statement).annotations)) {
            (clone as unknown as Statement).annotations = (this as unknown as Statement).annotations?.map(x => x.clone());
        }
        //reparent all of the supplied props
        for (let key of propsToReparent ?? []) {
            const children = (Array.isArray(clone?.[key]) ? clone[key] : [clone?.[key]]) as any[];
            for (let child of children ?? []) {
                if (child) {
                    (clone[key as any] as AstNode).parent = clone;
                }
            }
        }
        return clone;
    }
}

export abstract class Statement extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitStatements;
    /**
     * Annotations for this statement
     */
    public annotations: AnnotationExpression[] | undefined;

    public abstract clone(): Statement;
}


/** A BrightScript expression */
export abstract class Expression extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitExpressions;

    public abstract clone(): Expression;
}
