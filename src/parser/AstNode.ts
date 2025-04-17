import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import { WalkMode } from '../astUtils/visitors';
import type { Location, Position } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { InternalWalkMode } from '../astUtils/visitors';
import type { SymbolTable } from '../SymbolTable';
import type { BrsTranspileState } from './BrsTranspileState';
import type { GetTypeOptions, TranspileResult } from '../interfaces';
import type { AnnotationExpression } from './Expression';
import util from '../util';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';
import type { Token } from '../lexer/Token';

/**
 * A BrightScript AST node
 */
export abstract class AstNode {
    public abstract kind: AstNodeKind;
    /**
     *  The starting and ending location of the node.
     */
    public abstract location?: Location | undefined;

    public abstract transpile(state: BrsTranspileState): TranspileResult;

    /**
     * Optional property, set at the top level with a map of conditional compile consts and their values
     */
    public bsConsts?: Map<string, boolean>;

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
     * Find a list of all children first child where the matcher evaluates to true.
     * @param matcher a function called for each node. If you return true, the specified node is included in the results. If you return a node,
     * that node is returned. all other return values exclude that value and continue the loop
     */
    public findChildren<TNode extends AstNode = AstNode>(matcher: (node: AstNode, cancellationSource: CancellationTokenSource) => boolean | AstNode | undefined | void, options?: WalkOptions): Array<TNode> {
        const cancel = new CancellationTokenSource();
        let result: Array<AstNode> = [];
        this.walk((node) => {
            const matcherValue = matcher(node, cancel);
            if (matcherValue) {
                result.push(matcherValue === true ? node : matcherValue);
            }
        }, {
            walkMode: WalkMode.visitAllRecursive,
            ...options ?? {},
            cancel: cancel.token
        });
        return result as TNode[];
    }

    /**
     * FInd the deepest child that includes the given position
     */
    public findChildAtPosition<TNodeType extends AstNode = AstNode>(position: Position, options?: WalkOptions): TNodeType | undefined {
        return this.findChild<TNodeType>((node) => {
            //if the current node includes this range, keep that node
            if (util.rangeContains(node?.location.range, position)) {
                return node.findChildAtPosition(position, options) ?? node;
            }
        }, options);
    }

    /**
     * Get the BscType of this node.
     */
    public getType(options: GetTypeOptions): BscType {
        return DynamicType.instance;
    }

    /**
     * Links all child nodes to their parent AstNode, and the same with symbol tables. This performs a full AST walk, so you should use this sparingly
     */
    public link() {
        //the act of walking causes the nodes to be linked
        this.walk(() => { }, {
            // eslint-disable-next-line no-bitwise
            walkMode: WalkMode.visitAllRecursive | InternalWalkMode.visitFalseConditionalCompilationBlocks
        });
    }

    /**
     * Walk upward and return the root node
     */
    public getRoot() {
        let node = this as AstNode;

        while (node) {
            if (!node.parent) {
                return node;
            }
            node = node.parent;
        }
    }


    /**
     * Gets all the trivia (comments, whitespace) that is directly before the start of this node
     * Note: this includes all trivia that might start on the line of the previous node
     */
    public get leadingTrivia(): Token[] {
        return [];
    }

    /**
     * Gets any trivia that is directly before the end of the node
     * For example, this would return all trivia before a `end function` token of a FunctionExpression
     */
    public get endTrivia(): Token[] {
        return [];
    }

    public getBsConsts() {
        return this.bsConsts ?? this.parent?.getBsConsts?.();
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

        //reapply the location if we have one but the clone doesn't
        if (!clone.location && this.location) {
            clone.location = util.cloneLocation(this.location);
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
    public annotations?: AnnotationExpression[] | undefined;
}


/** A BrightScript expression */
export abstract class Expression extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitExpressions;
}

export enum AstNodeKind {
    Body = 'Body',
    BinaryExpression = 'BinaryExpression',
    CallExpression = 'CallExpression',
    FunctionExpression = 'FunctionExpression',
    FunctionParameterExpression = 'FunctionParameterExpression',
    NamespacedVariableNameExpression = 'NamespacedVariableNameExpression',
    DottedGetExpression = 'DottedGetExpression',
    XmlAttributeGetExpression = 'XmlAttributeGetExpression',
    IndexedGetExpression = 'IndexedGetExpression',
    GroupingExpression = 'GroupingExpression',
    LiteralExpression = 'LiteralExpression',
    EscapedCharCodeLiteralExpression = 'EscapedCharCodeLiteralExpression',
    ArrayLiteralExpression = 'ArrayLiteralExpression',
    AAMemberExpression = 'AAMemberExpression',
    AALiteralExpression = 'AALiteralExpression',
    UnaryExpression = 'UnaryExpression',
    VariableExpression = 'VariableExpression',
    SourceLiteralExpression = 'SourceLiteralExpression',
    NewExpression = 'NewExpression',
    CallfuncExpression = 'CallfuncExpression',
    TemplateStringQuasiExpression = 'TemplateStringQuasiExpression',
    TemplateStringExpression = 'TemplateStringExpression',
    TaggedTemplateStringExpression = 'TaggedTemplateStringExpression',
    AnnotationExpression = 'AnnotationExpression',
    TernaryExpression = 'TernaryExpression',
    NullCoalescingExpression = 'NullCoalescingExpression',
    RegexLiteralExpression = 'RegexLiteralExpression',
    EmptyStatement = 'EmptyStatement',
    AssignmentStatement = 'AssignmentStatement',
    ExpressionStatement = 'ExpressionStatement',
    ExitStatement = 'ExitStatement',
    FunctionStatement = 'FunctionStatement',
    IfStatement = 'IfStatement',
    IncrementStatement = 'IncrementStatement',
    PrintStatement = 'PrintStatement',
    DimStatement = 'DimStatement',
    GotoStatement = 'GotoStatement',
    LabelStatement = 'LabelStatement',
    ReturnStatement = 'ReturnStatement',
    EndStatement = 'EndStatement',
    StopStatement = 'StopStatement',
    ForStatement = 'ForStatement',
    ForEachStatement = 'ForEachStatement',
    WhileStatement = 'WhileStatement',
    DottedSetStatement = 'DottedSetStatement',
    IndexedSetStatement = 'IndexedSetStatement',
    LibraryStatement = 'LibraryStatement',
    NamespaceStatement = 'NamespaceStatement',
    ImportStatement = 'ImportStatement',
    InterfaceStatement = 'InterfaceStatement',
    InterfaceFieldStatement = 'InterfaceFieldStatement',
    InterfaceMethodStatement = 'InterfaceMethodStatement',
    ClassStatement = 'ClassStatement',
    MethodStatement = 'MethodStatement',
    ClassMethodStatement = 'ClassMethodStatement',
    FieldStatement = 'FieldStatement',
    ClassFieldStatement = 'ClassFieldStatement',
    TryCatchStatement = 'TryCatchStatement',
    CatchStatement = 'CatchStatement',
    ThrowStatement = 'ThrowStatement',
    EnumStatement = 'EnumStatement',
    EnumMemberStatement = 'EnumMemberStatement',
    ConstStatement = 'ConstStatement',
    ContinueStatement = 'ContinueStatement',
    Block = 'Block',
    TypeExpression = 'TypeExpression',
    TypecastExpression = 'TypecastExpression',
    TypedArrayExpression = 'TypedArrayExpression',
    TypecastStatement = 'TypecastStatement',
    AliasStatement = 'AliasStatement',
    ConditionalCompileStatement = 'ConditionalCompileStatement',
    ConditionalCompileConstStatement = 'ConditionalCompileConstStatement',
    ConditionalCompileErrorStatement = 'ConditionalCompileErrorStatement',
    AugmentedAssignmentStatement = 'AugmentedAssignmentStatement',
    PrintSeparatorExpression = 'PrintSeparatorExpression'
}
