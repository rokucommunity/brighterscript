/* eslint-disable no-bitwise */
import type { CancellationToken } from 'vscode-languageserver';
import type { Statement, Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassStatement, ClassMethodStatement, ClassFieldStatement, EnumStatement, EnumMemberStatement, DimStatement, TryCatchStatement, CatchStatement, ThrowStatement, InterfaceStatement, InterfaceFieldStatement, InterfaceMethodStatement, FieldStatement, MethodStatement } from '../parser/Statement';
import type { AALiteralExpression, AAMemberExpression, AnnotationExpression, ArrayLiteralExpression, BinaryExpression, CallExpression, CallfuncExpression, DottedGetExpression, EscapedCharCodeLiteralExpression, Expression, FunctionExpression, FunctionParameterExpression, GroupingExpression, IndexedGetExpression, LiteralExpression, NamespacedVariableNameExpression, NewExpression, NullCoalescingExpression, RegexLiteralExpression, SourceLiteralExpression, TaggedTemplateStringExpression, TemplateStringExpression, TemplateStringQuasiExpression, TernaryExpression, UnaryExpression, VariableExpression, XmlAttributeGetExpression } from '../parser/Expression';
import { isExpression, isStatement } from './reflection';
import type { AstEditor } from './AstEditor';


/**
 * Walks the statements of a block and descendent sub-blocks, and allow replacing statements
 */
export function walkStatements(
    statement: Statement,
    visitor: (statement: Statement, parent?: Statement, owningObject?: any, key?: any) => Statement | void,
    cancel?: CancellationToken
): void {
    statement.walk(visitor as any, {
        walkMode: WalkMode.visitStatements,
        cancel: cancel
    });
}

export type WalkVisitor = <T = Statement | Expression>(stmtExpr: Statement | Expression, parent?: Statement | Expression, owningObject?: any, key?: any) => void | T;

/**
 * A helper function for Statement and Expression `walkAll` calls.
 */
export function walk<T>(owningObject: T, key: keyof T, visitor: WalkVisitor, options: WalkOptions, parent?: Expression | Statement) {
    //stop processing if canceled
    if (options.cancel?.isCancellationRequested) {
        return;
    }

    //the object we're visiting
    let element = owningObject[key] as any as Statement | Expression;
    if (!element) {
        return;
    }

    //notify the visitor of this element
    if (element.visitMode & options.walkMode) {
        const result = visitor(element, parent ?? owningObject as any, owningObject, key);

        //replace the value on the parent if the visitor returned a Statement or Expression (this is how visitors can edit AST)
        if (result && (isExpression(result) || isStatement(result))) {
            if (options.editor) {
                options.editor.setProperty(owningObject, key, result as any);
            } else {
                (owningObject as any)[key] = result;
                //don't walk the new element
                return;
            }
        }
    }

    //stop processing if canceled
    if (options.cancel?.isCancellationRequested) {
        return;
    }

    if (!element.walk) {
        throw new Error(`${owningObject.constructor.name}["${String(key)}"]${parent ? ` for ${parent.constructor.name}` : ''} does not contain a "walk" method`);
    }
    //walk the child expressions
    element.walk(visitor, options);
}

/**
 * Helper for AST elements to walk arrays when visitors might change the array size (to delete/insert items).
 * @param filter a function used to filter items from the array. return true if that item should be walked
 */
export function walkArray<T>(array: Array<T>, visitor: WalkVisitor, options: WalkOptions, parent?: Expression | Statement, filter?: <T>(element: T) => boolean) {
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
        //statements
        Body?: (statement: Body, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        AssignmentStatement?: (statement: AssignmentStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        Block?: (statement: Block, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ExpressionStatement?: (statement: ExpressionStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        CommentStatement?: (statement: CommentStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ExitForStatement?: (statement: ExitForStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        FunctionStatement?: (statement: FunctionStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        IfStatement?: (statement: IfStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        IncrementStatement?: (statement: IncrementStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        PrintStatement?: (statement: PrintStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        DimStatement?: (statement: DimStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        GotoStatement?: (statement: GotoStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        LabelStatement?: (statement: LabelStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ReturnStatement?: (statement: ReturnStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        EndStatement?: (statement: EndStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        StopStatement?: (statement: StopStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ForStatement?: (statement: ForStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ForEachStatement?: (statement: ForEachStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        WhileStatement?: (statement: WhileStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        DottedSetStatement?: (statement: DottedSetStatement, parent?: Statement) => Statement | void;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        LibraryStatement?: (statement: LibraryStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        NamespaceStatement?: (statement: NamespaceStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ImportStatement?: (statement: ImportStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        InterfaceStatement?: (statement: InterfaceStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        InterfaceFieldStatement?: (statement: InterfaceFieldStatement, parent?: Statement) => Statement | void;
        InterfaceMethodStatement?: (statement: InterfaceMethodStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ClassStatement?: (statement: ClassStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        /**
         * @deprecated use `MethodStatement`
         */
        ClassMethodStatement?: (statement: ClassMethodStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        /**
         * @deprecated use `FieldStatement`
         */
        ClassFieldStatement?: (statement: ClassFieldStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        MethodStatement?: (statement: MethodStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        FieldStatement?: (statement: FieldStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        TryCatchStatement?: (statement: TryCatchStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        CatchStatement?: (statement: CatchStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        ThrowStatement?: (statement: ThrowStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        EnumStatement?: (statement: EnumStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        EnumMemberStatement?: (statement: EnumMemberStatement, parent?: Statement, owningObject?: any, key?: any) => Statement | void;
        //expressions
        BinaryExpression?: (expression: BinaryExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        CallExpression?: (expression: CallExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        FunctionExpression?: (expression: FunctionExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        FunctionParameterExpression?: (expression: FunctionParameterExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        NamespacedVariableNameExpression?: (expression: NamespacedVariableNameExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        DottedGetExpression?: (expression: DottedGetExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        XmlAttributeGetExpression?: (expression: XmlAttributeGetExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        IndexedGetExpression?: (expression: IndexedGetExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        GroupingExpression?: (expression: GroupingExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        LiteralExpression?: (expression: LiteralExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        EscapedCharCodeLiteralExpression?: (expression: EscapedCharCodeLiteralExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        ArrayLiteralExpression?: (expression: ArrayLiteralExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        AAMemberExpression?: (expression: AAMemberExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        AALiteralExpression?: (expression: AALiteralExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        UnaryExpression?: (expression: UnaryExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        VariableExpression?: (expression: VariableExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        SourceLiteralExpression?: (expression: SourceLiteralExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        NewExpression?: (expression: NewExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        CallfuncExpression?: (expression: CallfuncExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        TemplateStringQuasiExpression?: (expression: TemplateStringQuasiExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        TemplateStringExpression?: (expression: TemplateStringExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        TaggedTemplateStringExpression?: (expression: TaggedTemplateStringExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        AnnotationExpression?: (expression: AnnotationExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        TernaryExpression?: (expression: TernaryExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        NullCoalescingExpression?: (expression: NullCoalescingExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
        RegexLiteralExpression?: (expression: RegexLiteralExpression, parent?: Statement | Expression, owningObject?: any, key?: any) => Expression | void;
    }
) {
    //remap some deprecated visitor names TODO remove this in v1
    if (visitor.ClassFieldStatement) {
        visitor.FieldStatement = visitor.ClassFieldStatement;
    }
    if (visitor.ClassMethodStatement) {
        visitor.MethodStatement = visitor.ClassMethodStatement;
    }
    return <WalkVisitor>((statement: Statement, parent?: Statement, owningObject?: any, key?: any): Statement | void => {
        return visitor[statement.constructor.name]?.(statement, parent, owningObject, key);
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
     * If provided, any AST replacements will be done using this AstEditor instead of directly against the AST itself
     */
    editor?: AstEditor;
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
    recurseChildFunctions = 16
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
