import type { WalkVisitor, WalkOptions } from '../astUtils/visitors';
import { WalkMode } from '../astUtils/visitors';
import type { Position, Range } from 'vscode-languageserver';
import { CancellationTokenSource } from 'vscode-languageserver';
import { InternalWalkMode } from '../astUtils/visitors';
import type { SymbolTable } from '../SymbolTable';
import type { BrsTranspileState } from './BrsTranspileState';
import type { GetTypeOptions, TranspileResult } from '../interfaces';
import type { AnnotationExpression } from './Expression';
import util from '../util';
import { DynamicType } from '../types/DynamicType';
import type { BscType } from '../types/BscType';

/**
 * A BrightScript AST node
 */
export abstract class AstNode {
    public abstract kind: AstNodeKind;
    /**
     *  The starting and ending location of the node.
     */
    public abstract range: Range;

    public abstract transpile(state: BrsTranspileState): TranspileResult;

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
            node = node.parent;
        }
    }

    /**
     * Walk upward and return the first node that results in `true` from the matcher.
     * @param matcher a function called for each node. If you return true, this function returns the specified node. If you return a node, that node is returned. all other return values continue the loop
     *                The function's second parameter is a cancellation token. If you'd like to short-circuit the walk, call `cancellationToken.cancel()`, then this function will return `undefined`
     */
    public findAncestor<TNode extends AstNode = AstNode>(matcher: (node: AstNode, cancellationToken: CancellationTokenSource) => boolean | AstNode | undefined | void): TNode {
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
    public findChild<TNode extends AstNode = AstNode>(matcher: (node: AstNode, cancellationSource) => boolean | AstNode | undefined | void, options?: WalkOptions) {
        const cancel = new CancellationTokenSource();
        let result: AstNode;
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
        return result as TNode;
    }

    /**
     * FInd the deepest child that includes the given position
     */
    public findChildAtPosition<TNodeType extends AstNode = AstNode>(position: Position, options?: WalkOptions): TNodeType {
        return this.findChild<TNodeType>((node) => {
            //if the current node includes this range, keep that node
            if (util.rangeContains(node.range, position)) {
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
            walkMode: WalkMode.visitAllRecursive
        });
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
    public annotations: AnnotationExpression[];
}


/** A BrightScript expression */
export abstract class Expression extends AstNode {
    /**
     * When being considered by the walk visitor, this describes what type of element the current class is.
     */
    public visitMode = InternalWalkMode.visitExpressions;
}

export enum AstNodeKind {
    Body = 0,
    BinaryExpression = 1,
    CallExpression = 2,
    FunctionExpression = 3,
    FunctionParameterExpression = 4,
    NamespacedVariableNameExpression = 5,
    DottedGetExpression = 6,
    XmlAttributeGetExpression = 7,
    IndexedGetExpression = 8,
    GroupingExpression = 9,
    LiteralExpression = 10,
    EscapedCharCodeLiteralExpression = 11,
    ArrayLiteralExpression = 12,
    AAMemberExpression = 13,
    AALiteralExpression = 14,
    UnaryExpression = 15,
    VariableExpression = 16,
    SourceLiteralExpression = 17,
    NewExpression = 18,
    CallfuncExpression = 19,
    TemplateStringQuasiExpression = 20,
    TemplateStringExpression = 21,
    TaggedTemplateStringExpression = 22,
    AnnotationExpression = 23,
    TernaryExpression = 24,
    NullCoalescingExpression = 25,
    RegexLiteralExpression = 26,
    EmptyStatement = 27,
    AssignmentStatement = 28,
    ExpressionStatement = 29,
    CommentStatement = 30,
    ExitForStatement = 31,
    ExitWhileStatement = 32,
    FunctionStatement = 33,
    IfStatement = 34,
    IncrementStatement = 35,
    PrintStatement = 36,
    DimStatement = 37,
    GotoStatement = 38,
    LabelStatement = 39,
    ReturnStatement = 40,
    EndStatement = 41,
    StopStatement = 42,
    ForStatement = 43,
    ForEachStatement = 44,
    WhileStatement = 45,
    DottedSetStatement = 46,
    IndexedSetStatement = 47,
    LibraryStatement = 48,
    NamespaceStatement = 49,
    ImportStatement = 50,
    InterfaceStatement = 51,
    InterfaceFieldStatement = 52,
    InterfaceMethodStatement = 53,
    ClassStatement = 54,
    MethodStatement = 55,
    ClassMethodStatement = 56,
    FieldStatement = 57,
    ClassFieldStatement = 58,
    TryCatchStatement = 59,
    CatchStatement = 60,
    ThrowStatement = 61,
    EnumStatement = 62,
    EnumMemberStatement = 63,
    ConstStatement = 64,
    ContinueStatement = 65,
    Block = 66
}
