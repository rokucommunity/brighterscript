/* eslint-disable no-bitwise */
import type { CancellationToken } from 'vscode-languageserver';
import type { Body, AssignmentStatement, Block, ExpressionStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassStatement, EnumStatement, EnumMemberStatement, DimStatement, TryCatchStatement, CatchStatement, ThrowStatement, InterfaceStatement, InterfaceFieldStatement, InterfaceMethodStatement, FieldStatement, MethodStatement, ConstStatement, ContinueStatement, TypecastStatement, AliasStatement, ConditionalCompileStatement, ConditionalCompileErrorStatement, ConditionalCompileConstStatement, AugmentedAssignmentStatement } from '../parser/Statement';
import type { AALiteralExpression, AAMemberExpression, AnnotationExpression, ArrayLiteralExpression, BinaryExpression, CallExpression, CallfuncExpression, DottedGetExpression, EscapedCharCodeLiteralExpression, FunctionExpression, FunctionParameterExpression, GroupingExpression, IndexedGetExpression, LiteralExpression, NewExpression, NullCoalescingExpression, RegexLiteralExpression, SourceLiteralExpression, TaggedTemplateStringExpression, TemplateStringExpression, TemplateStringQuasiExpression, TernaryExpression, TypecastExpression, TypeExpression, UnaryExpression, VariableExpression, XmlAttributeGetExpression } from '../parser/Expression';
import { isExpression, isStatement } from './reflection';
import type { Editor } from './Editor';
import type { Statement, Expression, AstNode } from '../parser/AstNode';

/**
 * Walks the statements of a block and descendent sub-blocks, and allow replacing statements
 */
export function walkStatements(
    statement: Statement,
    visitor: (statement: Statement, parent?: Statement, owner?: any, key?: any) => Statement | void,
    cancel?: CancellationToken
): void {
    statement.walk(visitor as any, {
        walkMode: WalkMode.visitStatements,
        cancel: cancel
    });
}

export type WalkVisitor = <T = AstNode>(node: AstNode, parent?: AstNode, owner?: any, key?: any) => void | T;

/**
 * A helper function for Statement and Expression `walkAll` calls.
 */
export function walk<T>(owner: T, key: keyof T, visitor: WalkVisitor, options: WalkOptions, parent?: AstNode) {
    //stop processing if canceled
    if (options.cancel?.isCancellationRequested) {
        return;
    }

    //the object we're visiting
    let element = owner[key] as any as AstNode;
    if (!element) {
        return;
    }

    //link this node to its parent
    element.parent = parent ?? owner as unknown as AstNode;

    //get current bsConsts
    if (!options.bsConsts) {
        options.bsConsts = element.getBsConsts();
    }

    //notify the visitor of this element
    if (element.visitMode & options.walkMode) {
        const result = visitor?.(element, element.parent as any, owner, key);

        //replace the value on the parent if the visitor returned a Statement or Expression (this is how visitors can edit AST)
        if (result && (isExpression(result) || isStatement(result))) {
            if (options.editor) {
                options.editor.setProperty(owner, key, result as any);
            } else {
                (owner as any)[key] = result;
                //don't walk the new element
                return;
            }
        }
    }

    //stop processing if canceled
    if (options.cancel?.isCancellationRequested) {
        return;
    }

    //do not walk children if skipped
    if (options.skipChildren?.shouldSkipChildren) {
        options.skipChildren.reset();
        return;
    }

    if (!element.walk) {
        throw new Error(`${owner.constructor.name}["${String(key)}"]${parent ? ` for ${parent.constructor.name}` : ''} does not contain a "walk" method`);
    }
    //walk the child expressions
    element.walk(visitor, options);
}

/**
 * Helper for AST elements to walk arrays when visitors might change the array size (to delete/insert items).
 * @param array the array to walk
 * @param visitor the visitor function to call on match
 * @param options the walk optoins
 * @param parent the parent AstNode of each item in the array
 * @param filter a function used to filter items from the array. return true if that item should be walked
 */
export function walkArray<T = AstNode>(array: Array<T>, visitor: WalkVisitor, options: WalkOptions, parent?: AstNode, filter?: <T>(element: T) => boolean) {
    for (let i = 0; i < array.length; i++) {
        if (!filter || filter(array[i])) {
            const startLength = array.length;
            walk(array, i, visitor, options, parent);
            //compensate for deleted or added items.
            i += array.length - startLength;
        }
    }
}

/**
 * Creates an optimized visitor function.
 * Conventional visitors will need to inspect each incoming Statement/Expression, leading to many if statements.
 * This function will compare the constructor of the Statement/Expression, and perform a SINGLE logical check
 * to know which function to call.
 */
export function createVisitor(
    visitor: {
        /**
         * Called for every Statement or Expression encountered by a walker (while still honoring the WalkMode options)
         * The more specific visitor functions will still be called.
         */
        AstNode?: (node: Statement | Expression, parent?: AstNode, owner?: any, key?: any) => AstNode | void;
        //statements
        Body?: (statement: Body, parent?: Statement, owner?: any, key?: any) => Statement | void;
        AssignmentStatement?: (statement: AssignmentStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        Block?: (statement: Block, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ExpressionStatement?: (statement: ExpressionStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ExitForStatement?: (statement: ExitForStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        FunctionStatement?: (statement: FunctionStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        IfStatement?: (statement: IfStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        IncrementStatement?: (statement: IncrementStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        PrintStatement?: (statement: PrintStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        DimStatement?: (statement: DimStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        GotoStatement?: (statement: GotoStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        LabelStatement?: (statement: LabelStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ReturnStatement?: (statement: ReturnStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        EndStatement?: (statement: EndStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        StopStatement?: (statement: StopStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ForStatement?: (statement: ForStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ForEachStatement?: (statement: ForEachStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        WhileStatement?: (statement: WhileStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        DottedSetStatement?: (statement: DottedSetStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        LibraryStatement?: (statement: LibraryStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        NamespaceStatement?: (statement: NamespaceStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ImportStatement?: (statement: ImportStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        TypecastStatement?: (statement: TypecastStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        InterfaceStatement?: (statement: InterfaceStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        InterfaceFieldStatement?: (statement: InterfaceFieldStatement, parent?: Statement) => Statement | void;
        InterfaceMethodStatement?: (statement: InterfaceMethodStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ClassStatement?: (statement: ClassStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ContinueStatement?: (statement: ContinueStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        MethodStatement?: (statement: MethodStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        FieldStatement?: (statement: FieldStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        TryCatchStatement?: (statement: TryCatchStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        CatchStatement?: (statement: CatchStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ThrowStatement?: (statement: ThrowStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        EnumStatement?: (statement: EnumStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        EnumMemberStatement?: (statement: EnumMemberStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ConstStatement?: (statement: ConstStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ConditionalCompileStatement?: (statement: ConditionalCompileStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ConditionalCompileConstStatement?: (statement: ConditionalCompileConstStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        ConditionalCompileErrorStatement?: (statement: ConditionalCompileErrorStatement, parent?: Statement, owner?: any, key?: any) => Statement | void;
        AliasStatement?: (statement: AliasStatement, parent?: AstNode, owner?: any, key?: any) => Statement | void;
        AugmentedAssignmentStatement?: (statement: AugmentedAssignmentStatement, parent?: AstNode, owner?: any, key?: any) => Statement | void;
        //expressions
        BinaryExpression?: (expression: BinaryExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        CallExpression?: (expression: CallExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        FunctionExpression?: (expression: FunctionExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        FunctionParameterExpression?: (expression: FunctionParameterExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        DottedGetExpression?: (expression: DottedGetExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        XmlAttributeGetExpression?: (expression: XmlAttributeGetExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        IndexedGetExpression?: (expression: IndexedGetExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        GroupingExpression?: (expression: GroupingExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        LiteralExpression?: (expression: LiteralExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        EscapedCharCodeLiteralExpression?: (expression: EscapedCharCodeLiteralExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        ArrayLiteralExpression?: (expression: ArrayLiteralExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        AAMemberExpression?: (expression: AAMemberExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        AALiteralExpression?: (expression: AALiteralExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        UnaryExpression?: (expression: UnaryExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        VariableExpression?: (expression: VariableExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        SourceLiteralExpression?: (expression: SourceLiteralExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        NewExpression?: (expression: NewExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        CallfuncExpression?: (expression: CallfuncExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        TemplateStringQuasiExpression?: (expression: TemplateStringQuasiExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        TemplateStringExpression?: (expression: TemplateStringExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        TaggedTemplateStringExpression?: (expression: TaggedTemplateStringExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        AnnotationExpression?: (expression: AnnotationExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        TernaryExpression?: (expression: TernaryExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        NullCoalescingExpression?: (expression: NullCoalescingExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        RegexLiteralExpression?: (expression: RegexLiteralExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        TypeExpression?: (expression: TypeExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
        TypecastExpression?: (expression: TypecastExpression, parent?: AstNode, owner?: any, key?: any) => Expression | void;
    }
) {
    return <WalkVisitor>((statement: Statement, parent?: Statement, owner?: any, key?: any): Statement | void => {
        //call the generic AstNode visitor first (if defined)
        visitor.AstNode?.(statement, parent, owner, key);
        //now call the specifically-named visitor
        return visitor[statement.constructor.name]?.(statement, parent, owner, key);
    });
}

export interface WalkOptions {
    /**
     * What mode should the walker walk?
     * You can use the unique enums, or apply bitwise and to combine the various modes you're interested in
     */
    walkMode: WalkMode;
    /**
     * A token that can be used to cancel the walk operation
     */
    cancel?: CancellationToken;
    /**
     * If provided, any AST replacements will be done using this Editor instead of directly against the AST itself
     */
    editor?: Editor;
    /**
     * A token that can be used to stop the walk from going any deeper in the current node,
     * but will continue walking sibling nodes
     */
    skipChildren?: ChildrenSkipper;
    /**
     * Map of Conditional compilation flags, with names in lowercase
     */
    bsConsts?: Map<string, boolean>;
}

export class ChildrenSkipper {
    private isSkipped = false;

    public reset() {
        this.isSkipped = false;
    }

    public skip() {
        this.isSkipped = true;
    }

    get shouldSkipChildren() {
        return this.isSkipped;
    }
}


/**
 * An enum used to denote the specific WalkMode options (without
 */
export enum InternalWalkMode {
    /**
     * Walk statements
     */
    walkStatements = 1,
    /**
     * Call the visitor for every statement encountered by a walker
     */
    visitStatements = 2,
    /**
     * Walk expressions.
     */
    walkExpressions = 4,
    /**
     * Call the visitor for every expression encountered by a walker
     */
    visitExpressions = 8,
    /**
     * If child function expressions are encountered, this will allow the walker to step into them.
     */
    recurseChildFunctions = 16,
    /**
     * Step into conditional compilation blocks that are guarded by a flag that evaluates to false
     */
    visitFalseConditionalCompilationBlocks = 64
}

/* eslint-disable @typescript-eslint/prefer-literal-enum-member */
export enum WalkMode {
    /**
     * Walk statements, but does NOT step into child functions
     */
    walkStatements = InternalWalkMode.walkStatements,
    /**
     * Walk and visit statements, but does NOT step into child functions
     */
    visitStatements = InternalWalkMode.walkStatements | InternalWalkMode.visitStatements,
    /**
     * Walk expressions, but does NOT step into child functions
     */
    walkExpressions = InternalWalkMode.walkExpressions,
    /**
     * Walk and visit expressions of the statement, but doesn't walk child statements
     */
    visitLocalExpressions = InternalWalkMode.walkExpressions | InternalWalkMode.visitExpressions,
    /**
     * Walk and visit expressions, but does NOT step into child functions
     */
    visitExpressions = InternalWalkMode.walkStatements | InternalWalkMode.walkExpressions | InternalWalkMode.visitExpressions,
    /**
     * Visit all descendent statements and expressions, but does NOT step into child functions
     */
    visitAll = InternalWalkMode.walkStatements | InternalWalkMode.visitStatements | InternalWalkMode.walkExpressions | InternalWalkMode.visitExpressions,
    /**
     * If child function expressions are encountered, this will allow the walker to step into them.
     * This includes `WalkMode.walkExpressions`
     */
    recurseChildFunctions = InternalWalkMode.recurseChildFunctions | InternalWalkMode.walkExpressions,
    /**
     * Visit all descendent statements, and DOES step into child functions
     */
    visitStatementsRecursive = InternalWalkMode.walkStatements | InternalWalkMode.visitStatements | InternalWalkMode.walkExpressions | InternalWalkMode.recurseChildFunctions,
    /**
     * Visit all descendent expressions, and DOES step into child functions
     */
    visitExpressionsRecursive = InternalWalkMode.walkStatements | InternalWalkMode.walkExpressions | InternalWalkMode.visitExpressions | InternalWalkMode.recurseChildFunctions,
    /**
     * Visit all descendent statements and expressions, and DOES step into child functions
     */
    visitAllRecursive = InternalWalkMode.walkStatements | InternalWalkMode.visitStatements | InternalWalkMode.walkExpressions | InternalWalkMode.visitExpressions | InternalWalkMode.recurseChildFunctions
}
