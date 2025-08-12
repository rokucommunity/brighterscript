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
import { isExpression, isStatement } from '../astUtils/reflection';

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
     * Clone this node and all of its children. This creates a completely detached and identical copy of the AST.
     * All tokens, statements, expressions, range, and location are cloned.
     */
    public abstract clone();

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


    /**
     * Get the root of this expression chain.
     * For example, `alpha.beta(charlie.delta)`, the roots would be the DottedGetExpression for `delta`, and the `CallExpression for `beta(...)`.
     */
    public getExpressionChainRoot(): Expression | undefined {
        let node: Expression = this;

        while (node) {
            //if the node is a root, return it
            if (node.isExpressionChainRoot) {
                return node;
                //if we have a parent, do another iteration
            } else if (isExpression(node.parent)) {
                node = node.parent;
            } else {
                //there's no parent, this node must be the root
                return node;
            }
        }
        return undefined;
    }

    /**
     * Is this node the root of an expression chain?
     */
    public get isExpressionChainRoot() {
        //if any of these conditions are true, then this node is an expression chain root
        if (
            //if there is no parent,
            !this.parent ||
            //our parent is a `Statement`
            isStatement(this.parent) ||
            //is NOT a part of our parents expression chain
            this.parent.childIsInExpressionChain?.(this) === false
        ) {
            return true;
        }
        return false;
    }

    /**
     * Is the node a direct child in the expression chain of this node?
     * @param child
     */
    protected abstract childIsInExpressionChain(child: AstNode): boolean;
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

    protected childIsInExpressionChain(child: AstNode): boolean {
        // statements cannot contribute child nodes to the same expression chain
        return false;
    }
}


/** A BrightScript expression */
export abstract class Expression extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitExpressions;
}
