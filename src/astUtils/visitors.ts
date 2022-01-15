/* eslint-disable no-bitwise */
import type { CancellationToken } from 'vscode-languageserver';
import type { Statement, Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassStatement, ClassMethodStatement, ClassFieldStatement, EnumStatement, EnumMemberStatement } from '../parser/Statement';
import type { AALiteralExpression, ArrayLiteralExpression, BinaryExpression, CallExpression, CallfuncExpression, DottedGetExpression, EscapedCharCodeLiteralExpression, Expression, FunctionExpression, GroupingExpression, IndexedGetExpression, LiteralExpression, NamespacedVariableNameExpression, NewExpression, SourceLiteralExpression, TaggedTemplateStringExpression, TemplateStringExpression, TemplateStringQuasiExpression, UnaryExpression, VariableExpression, XmlAttributeGetExpression } from '../parser/Expression';
import { isExpression, isStatement } from './reflection';


/**
 * Walks the statements of a block and descendent sub-blocks, and allow replacing statements
 */
export function walkStatements(
    statement: Statement,
    visitor: (statement: Statement, parent?: Statement) => Statement | void,
    cancel?: CancellationToken
): void {
    statement.walk(visitor as any, {
        walkMode: WalkMode.visitStatements,
        cancel: cancel
    });
}


export type WalkVisitor = <T = Statement | Expression>(stmtExpr: Statement | Expression, parent?: Statement | Expression) => void | T;

/**
 * A helper function for Statement and Expression `walkAll` calls.
 */
export function walk<T>(keyParent: T, key: keyof T, visitor: WalkVisitor, options: WalkOptions, parent?: Expression | Statement) {
    //stop processing if canceled
    if (options.cancel?.isCancellationRequested) {
        return;
    }

    //the object we're visiting
    let element = keyParent[key] as any as Statement | Expression;
    if (!element) {
        return;
    }

    //notify the visitor of this element
    if (element.visitMode & options.walkMode) {
        const result = visitor(element, parent ?? keyParent as any);

        //replace the value on the parent if the visitor returned a Statement or Expression (this is how visitors can edit AST)
        if (result && (isExpression(result) || isStatement(result))) {
            (keyParent as any)[key] = result;
            //don't walk the new element
            return;
        }
    }

    //stop processing if canceled
    if (options.cancel?.isCancellationRequested) {
        return;
    }

    if (!element.walk) {
        throw new Error(`${keyParent.constructor.name}["${key}"]${parent ? ` for ${parent.constructor.name}` : ''} does not contain a "walk" method`);
    }
    //walk the child expressions
    element.walk(visitor, options);
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
        Body?: (statement: Body, parent?: Statement) => Statement | void;
        AssignmentStatement?: (statement: AssignmentStatement, parent?: Statement) => Statement | void;
        Block?: (statement: Block, parent?: Statement) => Statement | void;
        ExpressionStatement?: (statement: ExpressionStatement, parent?: Statement) => Statement | void;
        CommentStatement?: (statement: CommentStatement, parent?: Statement) => Statement | void;
        ExitForStatement?: (statement: ExitForStatement, parent?: Statement) => Statement | void;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent?: Statement) => Statement | void;
        FunctionStatement?: (statement: FunctionStatement, parent?: Statement) => Statement | void;
        IfStatement?: (statement: IfStatement, parent?: Statement) => Statement | void;
        IncrementStatement?: (statement: IncrementStatement, parent?: Statement) => Statement | void;
        PrintStatement?: (statement: PrintStatement, parent?: Statement) => Statement | void;
        GotoStatement?: (statement: GotoStatement, parent?: Statement) => Statement | void;
        LabelStatement?: (statement: LabelStatement, parent?: Statement) => Statement | void;
        ReturnStatement?: (statement: ReturnStatement, parent?: Statement) => Statement | void;
        EndStatement?: (statement: EndStatement, parent?: Statement) => Statement | void;
        StopStatement?: (statement: StopStatement, parent?: Statement) => Statement | void;
        ForStatement?: (statement: ForStatement, parent?: Statement) => Statement | void;
        ForEachStatement?: (statement: ForEachStatement, parent?: Statement) => Statement | void;
        WhileStatement?: (statement: WhileStatement, parent?: Statement) => Statement | void;
        DottedSetStatement?: (statement: DottedSetStatement, parent?: Statement) => Statement | void;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent?: Statement) => Statement | void;
        LibraryStatement?: (statement: LibraryStatement, parent?: Statement) => Statement | void;
        NamespaceStatement?: (statement: NamespaceStatement, parent?: Statement) => Statement | void;
        ImportStatement?: (statement: ImportStatement, parent?: Statement) => Statement | void;
        ClassStatement?: (statement: ClassStatement, parent?: Statement) => Statement | void;
        ClassMethodStatement?: (statement: ClassMethodStatement, parent?: Statement) => Statement | void;
        ClassFieldStatement?: (statement: ClassFieldStatement, parent?: Statement) => Statement | void;
        EnumStatement?: (statement: EnumStatement, parent?: Statement) => Statement | void;
        EnumMemberStatement?: (statement: EnumMemberStatement, parent?: Statement) => Statement | void;
        //expressions
        BinaryExpression?: (expression: BinaryExpression, parent?: Statement | Expression) => Expression | void;
        CallExpression?: (expression: CallExpression, parent?: Statement | Expression) => Expression | void;
        FunctionExpression?: (expression: FunctionExpression, parent?: Statement | Expression) => Expression | void;
        NamespacedVariableNameExpression?: (expression: NamespacedVariableNameExpression, parent?: Statement | Expression) => Expression | void;
        DottedGetExpression?: (expression: DottedGetExpression, parent?: Statement | Expression) => Expression | void;
        XmlAttributeGetExpression?: (expression: XmlAttributeGetExpression, parent?: Statement | Expression) => Expression | void;
        IndexedGetExpression?: (expression: IndexedGetExpression, parent?: Statement | Expression) => Expression | void;
        GroupingExpression?: (expression: GroupingExpression, parent?: Statement | Expression) => Expression | void;
        LiteralExpression?: (expression: LiteralExpression, parent?: Statement | Expression) => Expression | void;
        EscapedCharCodeLiteralExpression?: (expression: EscapedCharCodeLiteralExpression, parent?: Statement | Expression) => Expression | void;
        ArrayLiteralExpression?: (expression: ArrayLiteralExpression, parent?: Statement | Expression) => Expression | void;
        AALiteralExpression?: (expression: AALiteralExpression, parent?: Statement | Expression) => Expression | void;
        UnaryExpression?: (expression: UnaryExpression, parent?: Statement | Expression) => Expression | void;
        VariableExpression?: (expression: VariableExpression, parent?: Statement | Expression) => Expression | void;
        SourceLiteralExpression?: (expression: SourceLiteralExpression, parent?: Statement | Expression) => Expression | void;
        NewExpression?: (expression: NewExpression, parent?: Statement | Expression) => Expression | void;
        CallfuncExpression?: (expression: CallfuncExpression, parent?: Statement | Expression) => Expression | void;
        TemplateStringQuasiExpression?: (expression: TemplateStringQuasiExpression, parent?: Statement | Expression) => Expression | void;
        TemplateStringExpression?: (expression: TemplateStringExpression, parent?: Statement | Expression) => Expression | void;
        TaggedTemplateStringExpression?: (expression: TaggedTemplateStringExpression, parent?: Statement | Expression) => Expression | void;
    }
) {
    return <WalkVisitor>((statement: Statement, parent?: Statement): Statement | void => {
        return visitor[statement.constructor.name]?.(statement, parent);
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
