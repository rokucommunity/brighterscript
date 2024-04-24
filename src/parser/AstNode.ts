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
import type { Token } from '../lexer/Token';

/**
 * A BrightScript AST node
 */
export abstract class AstNode {
    public abstract kind: AstNodeKind;
    /**
     *  The starting and ending location of the node.
     */
    public abstract range?: Range | undefined;

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
    public findChild<TNode extends AstNode = AstNode>(matcher: (node: AstNode, cancellationSource) => boolean | AstNode | undefined | void, options?: WalkOptions): TNode | undefined {
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
        return result as TNode;
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

    public getLeadingTrivia(): Token[] {
        return [];
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
    ExitForStatement = 'ExitForStatement',
    ExitWhileStatement = 'ExitWhileStatement',
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
    TypecastStatement = 'TypecastStatement'
}
