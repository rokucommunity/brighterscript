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
    public findAncestor<TNode extends AstNode = AstNode>(matcher: (node: AstNode) => node is TNode): TNode | undefined;
    public findAncestor<TNode extends AstNode = AstNode>(matcher: (node: AstNode, cancellationToken: CancellationTokenSource) => boolean | AstNode | undefined | void): TNode | undefined;
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
     * The previous step in this expression, or undefined if this node doesn't build on another
     * expression. Overridden by dotted/indexed gets, calls, and other chaining nodes.
     *
     * Each node in a chain spans a whole prefix of the source, so this walks to the next-shorter
     * prefix. In `a.b.c`:
     * ```
     * a.b.c   .previousInChain -> a.b
     * a.b     .previousInChain -> a
     * a       .previousInChain -> undefined
     * ```
     * (`b` and `c` are name tokens on those nodes, not nodes of their own)
     *
     * Note this walks toward the AST *child*, since chains are stored inverted: the full
     * expression is the top node and its base is the deepest descendant. It is not `parent`
     * reversed - args and index values have a `parent` but are never a `previousInChain`,
     * because they're separate expressions that merely sit inside this one:
     * ```
     * a.b(c)   //CallExpression.previousInChain is `a.b`, NOT `c`
     * a[c]     //IndexedGetExpression.previousInChain is `a`, NOT `c`
     * ```
     */
    public get previousInChain(): AstNode | undefined {
        return undefined;
    }

    /**
     * Is this node a complete expression, rather than one step inside a longer one?
     *
     * True when nothing chains onto this node. Statements are always terminal. Use this to find
     * whole expressions while walking, instead of also matching every prefix inside them.
     *
     * ```
     * print a.b.c(1)
     * // a.b.c(1)  terminal - the whole expression
     * // a.b.c     no       - a.b.c(1) chains onto it
     * // a.b       no       - a.b.c chains onto it
     * // a         no       - a.b chains onto it
     * // 1         terminal - an argument, so its own expression
     * ```
     *
     * A nested node is still terminal when it's an argument rather than something chained onto.
     * Here `a.b` is terminal even though it sits inside the call:
     * ```
     * print doSomething(a.b)
     * ```
     *
     * Requires `parent` to be set, so the node must already be linked (see `link()`). An
     * unlinked node has no parent, so it reports `true`.
     */
    public isTerminal(): boolean {
        //walk up, then back down: if we don't land on ourselves, nothing chains onto us
        return this.parent === undefined || this.parent.previousInChain !== this;
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
