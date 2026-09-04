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
     * The child that this node reaches through, for nodes like `a.b` that wrap another
     * expression. Overridden by dotted/indexed gets, calls, etc. Everything else returns undefined.
     *
     * Given `a.b`, the `DottedGetExpression` for `a.b` returns the `VariableExpression` for `a`.
     *
     * Only the wrapped expression counts. Call args and index values are excluded, because
     * they're separate expressions that merely sit inside this one:
     * ```
     * a.b(c)      //CallExpression.chainChild is `a.b`,  NOT `c`
     * a[c]        //IndexedGetExpression.chainChild is `a`, NOT `c`
     * ```
     */
    public get chainChild(): AstNode | undefined {
        return undefined;
    }

    /**
     * Is this node the outermost node of its expression? (i.e. is nothing else reaching down
     * through it via `chainChild`)
     *
     * Statements are always terminal. Use this to find whole expressions while walking, instead
     * of also matching the fragments inside them.
     *
     * ```
     * print a.b.c(1)
     * // a.b.c(1)  terminal - the whole expression
     * // a.b.c     no       - a.b.c(1) reaches through it
     * // a.b       no       - a.b.c reaches through it
     * // a         no       - a.b reaches through it
     * // 1         terminal - an argument, so its own expression
     * ```
     *
     * Note that an inner node can still be terminal when it's an argument rather than something
     * being reached through. Here `a.b` is terminal even though it's nested inside the call:
     * ```
     * print doSomething(a.b)
     * ```
     *
     * Requires `parent` to be set, so the node must already be linked (see `link()`).
     */
    public isTerminal(): boolean {
        return this.parent?.chainChild !== this;
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
