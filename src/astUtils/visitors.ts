import { CancellationToken } from 'vscode-languageserver';
import { Statement, Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement } from '../parser/Statement';
import { AALiteralExpression, ArrayLiteralExpression, BinaryExpression, CallExpression, CallfuncExpression, DottedGetExpression, EscapedCharCodeLiteralExpression, Expression, FunctionExpression, GroupingExpression, IndexedGetExpression, LiteralExpression, NamespacedVariableNameExpression, NewExpression, SourceLiteralExpression, TaggedTemplateStringExpression, TemplateStringExpression, TemplateStringQuasiExpression, UnaryExpression, VariableExpression, XmlAttributeGetExpression } from '../parser/Expression';
import { isExpression, isBlock, isIfStatement, isBody, isNamespaceStatement } from './reflection';
import { ClassFieldStatement, ClassMethodStatement, ClassStatement } from '../parser/ClassStatement';


/**
 * Create a filtered visitor for use with `editStatements`
 */
export function createStatementVisitor(
    visitor: {
        Body?: (statement: Body, parent: Statement) => Statement | void;
        AssignmentStatement?: (statement: AssignmentStatement, parent: Statement) => Statement | void;
        Block?: (statement: Block, parent: Statement) => Statement | void;
        ExpressionStatement?: (statement: ExpressionStatement, parent: Statement) => Statement | void;
        CommentStatement?: (statement: CommentStatement, parent: Statement) => Statement | void;
        ExitForStatement?: (statement: ExitForStatement, parent: Statement) => Statement | void;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent: Statement) => Statement | void;
        FunctionStatement?: (statement: FunctionStatement, parent: Statement) => Statement | void;
        IfStatement?: (statement: IfStatement, parent: Statement) => Statement | void;
        IncrementStatement?: (statement: IncrementStatement, parent: Statement) => Statement | void;
        PrintStatement?: (statement: PrintStatement, parent: Statement) => Statement | void;
        GotoStatement?: (statement: GotoStatement, parent: Statement) => Statement | void;
        LabelStatement?: (statement: LabelStatement, parent: Statement) => Statement | void;
        ReturnStatement?: (statement: ReturnStatement, parent: Statement) => Statement | void;
        EndStatement?: (statement: EndStatement, parent: Statement) => Statement | void;
        StopStatement?: (statement: StopStatement, parent: Statement) => Statement | void;
        ForStatement?: (statement: ForStatement, parent: Statement) => Statement | void;
        ForEachStatement?: (statement: ForEachStatement, parent: Statement) => Statement | void;
        WhileStatement?: (statement: WhileStatement, parent: Statement) => Statement | void;
        DottedSetStatement?: (statement: DottedSetStatement, parent: Statement) => Statement | void;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent: Statement) => Statement | void;
        LibraryStatement?: (statement: LibraryStatement, parent: Statement) => Statement | void;
        NamespaceStatement?: (statement: NamespaceStatement, parent: Statement) => Statement | void;
        ImportStatement?: (statement: ImportStatement, parent: Statement) => Statement | void;
    }
) {
    return (statement: Statement, parent: Statement): Statement | void => {
        return visitor[statement.constructor.name]?.(statement, parent);
    };
}

/**
 * Create a statement -> expression visitor
 */
export function createStatementExpressionsVisitor(
    visitor: (statement: Statement, parent: Statement) => void,
    expVisitor: (expression: Expression, context: Expression) => void,
    cancel?: CancellationToken
) {
    const expressionVisitor = createStatementVisitor({
        AssignmentStatement: (s) => {
            s.value.walk(expVisitor, s.value, cancel);
        },
        CommentStatement: (s) => {
            s.walk(expVisitor, s, cancel);
        },
        DottedSetStatement: (s) => {
            s.obj.walk(expVisitor, s.obj, cancel);
            s.value.walk(expVisitor, s.value, cancel);
        },
        ExpressionStatement: (s) => {
            s.expression.walk(expVisitor, s.expression, cancel);
        },
        ForStatement: (s) => {
            s.counterDeclaration.value.walk(expVisitor, s.counterDeclaration.value, cancel);
            s.finalValue.walk(expVisitor, s.finalValue, cancel);
            s.increment.walk(expVisitor, s.increment, cancel);
        },
        ForEachStatement: (s) => {
            s.target.walk(expVisitor, s.target, cancel);
        },
        IfStatement: (s) => {
            s.condition.walk(expVisitor, s.condition, cancel);
            s.elseIfs.forEach(b => {
                b.condition.walk(expVisitor, b.condition, cancel);
            });
        },
        IndexedSetStatement: (s) => {
            s.obj.walk(expVisitor, s.obj, cancel);
            s.index.walk(expVisitor, s.index, cancel);
            s.value.walk(expVisitor, s.value, cancel);
        },
        IncrementStatement: (s) => {
            s.value.walk(expVisitor, s.value, cancel);
        },
        NamespaceStatement: (s) => {
            s.nameExpression.walk(expVisitor, s.nameExpression, cancel);
        },
        PrintStatement: (s) => {
            s.expressions.forEach(e => {
                if (isExpression(e)) {
                    e.walk(expVisitor, e, cancel);
                }
            });
        },
        ReturnStatement: (s) => {
            s.value?.walk(expVisitor, s.value, cancel);
        },
        WhileStatement: (s) => {
            s.condition.walk(expVisitor, s.condition, cancel);
        }
    });
    return (statement: Statement, parent: Statement) => {
        visitor(statement, parent);
        expressionVisitor(statement, parent);
    };
}

/**
 * Walks the statements of a block and descendent sub-blocks, and allow replacing statements
 */
export function walkStatements(
    statement: Statement,
    visitor: (statement: Statement, parent: Statement) => Statement | void,
    cancel?: CancellationToken
): void {
    recursiveWalkStatements(statement, undefined, visitor, cancel);
}

/**
 * Walk recursively within the branches of a Block, but doesn't enter sub functions.
 */
function recursiveWalkStatements(
    statement: Statement,
    parent: Statement,
    visitor: (statement: Statement, parent: Statement) => Statement | void,
    cancel: CancellationToken
): Statement | undefined {
    if (cancel?.isCancellationRequested) {
        return;
    }
    const result = visitor(statement, parent) || undefined;
    if (result?.transpile) {
        // replace statement and don't recurse
        return result;
    }
    if (isBlock(statement) || isBody(statement)) {
        for (let i = 0; i < statement.statements.length; i++) {
            const result = recursiveWalkStatements(statement.statements[i], statement, visitor, cancel);
            if (result) {
                statement.statements[i] = result;
            }
        }
    } else if (isIfStatement(statement)) {
        const result = recursiveWalkStatements(statement.thenBranch, statement, visitor, cancel);
        if (result instanceof Block) {
            (statement as any).thenBranch = result;
        }
        statement.elseIfs.forEach(branch => {
            const result = recursiveWalkStatements(branch.thenBranch, statement, visitor, cancel);
            if (result instanceof Block) {
                (statement as any).thenBranch = result;
            }
        });
        if (statement.elseBranch) {
            const result = recursiveWalkStatements(statement.elseBranch, statement, visitor, cancel);
            if (result instanceof Block) {
                (statement as any).elseBranch = result;
            }
        }
    } else if (isNamespaceStatement(statement)) {
        const result = recursiveWalkStatements(statement.body, statement, visitor, cancel);
        if (result instanceof Body) {
            statement.body = result;
        }
    } else if (hasBody(statement)) { // for/while...
        const result = recursiveWalkStatements(statement.body, statement, visitor, cancel);
        if (result instanceof Block) {
            statement.body = result;
        }
    }
}

function hasBody(statement: Statement): statement is Statement & { body: Block } {
    return statement && isBlock((statement as any).body);
}

export type WalkAllVisitor = <T = Statement | Expression>(stmtExpr: Statement | Expression, parent: Statement | Expression) => void | T;

/**
 * A helper function for Statement and Expression `walkAll` calls.
 */
export function walkAll<T>(keyParent: T, key: keyof T, visitor: WalkAllVisitor, cancel?: CancellationToken, parent?: Expression | Statement) {
    //notify the visitor of this expression
    (keyParent as any)[key] = visitor(keyParent[key] as any, parent ?? keyParent as any) ?? keyParent[key];
    if (cancel?.isCancellationRequested) {
        return;
    }

    const expression = keyParent[key] as any as Expression;
    if (!expression) {
        throw new Error(`Index "${key}" for ${keyParent.constructor.name} is undefined`);
    }
    if (!expression.walkAll) {
        throw new Error(`${keyParent.constructor.name}["${key}"]${parent ? ` for ${parent.constructor.name}` : ''} does not contain a "walkAll" method`);
    }
    //walk the child expressions
    expression.walkAll(visitor, cancel);
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
        Body?: (statement: Body, parent: Statement) => Statement | void;
        AssignmentStatement?: (statement: AssignmentStatement, parent: Statement) => Statement | void;
        Block?: (statement: Block, parent: Statement) => Statement | void;
        ExpressionStatement?: (statement: ExpressionStatement, parent: Statement) => Statement | void;
        CommentStatement?: (statement: CommentStatement, parent: Statement) => Statement | void;
        ExitForStatement?: (statement: ExitForStatement, parent: Statement) => Statement | void;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent: Statement) => Statement | void;
        FunctionStatement?: (statement: FunctionStatement, parent: Statement) => Statement | void;
        IfStatement?: (statement: IfStatement, parent: Statement) => Statement | void;
        IncrementStatement?: (statement: IncrementStatement, parent: Statement) => Statement | void;
        PrintStatement?: (statement: PrintStatement, parent: Statement) => Statement | void;
        GotoStatement?: (statement: GotoStatement, parent: Statement) => Statement | void;
        LabelStatement?: (statement: LabelStatement, parent: Statement) => Statement | void;
        ReturnStatement?: (statement: ReturnStatement, parent: Statement) => Statement | void;
        EndStatement?: (statement: EndStatement, parent: Statement) => Statement | void;
        StopStatement?: (statement: StopStatement, parent: Statement) => Statement | void;
        ForStatement?: (statement: ForStatement, parent: Statement) => Statement | void;
        ForEachStatement?: (statement: ForEachStatement, parent: Statement) => Statement | void;
        WhileStatement?: (statement: WhileStatement, parent: Statement) => Statement | void;
        DottedSetStatement?: (statement: DottedSetStatement, parent: Statement) => Statement | void;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent: Statement) => Statement | void;
        LibraryStatement?: (statement: LibraryStatement, parent: Statement) => Statement | void;
        NamespaceStatement?: (statement: NamespaceStatement, parent: Statement) => Statement | void;
        ImportStatement?: (statement: ImportStatement, parent: Statement) => Statement | void;
        ClassStatement?: (statement: ClassStatement, parent: Statement) => Statement | void;
        ClassMethodStatement?: (statement: ClassMethodStatement, parent: Statement) => Statement | void;
        ClassFieldStatement?: (statement: ClassFieldStatement, parent: Statement) => Statement | void;
        //expressions
        BinaryExpression?: (expression: BinaryExpression, parent: Statement | Expression) => Expression | void;
        CallExpression?: (expression: CallExpression, parent: Statement | Expression) => Expression | void;
        FunctionExpression?: (expression: FunctionExpression, parent: Statement | Expression) => Expression | void;
        NamespacedVariableNameExpression?: (expression: NamespacedVariableNameExpression, parent: Statement | Expression) => Expression | void;
        DottedGetExpression?: (expression: DottedGetExpression, parent: Statement | Expression) => Expression | void;
        XmlAttributeGetExpression?: (expression: XmlAttributeGetExpression, parent: Statement | Expression) => Expression | void;
        IndexedGetExpression?: (expression: IndexedGetExpression, parent: Statement | Expression) => Expression | void;
        GroupingExpression?: (expression: GroupingExpression, parent: Statement | Expression) => Expression | void;
        LiteralExpression?: (expression: LiteralExpression, parent: Statement | Expression) => Expression | void;
        EscapedCharCodeLiteralExpression?: (expression: EscapedCharCodeLiteralExpression, parent: Statement | Expression) => Expression | void;
        ArrayLiteralExpression?: (expression: ArrayLiteralExpression, parent: Statement | Expression) => Expression | void;
        AALiteralExpression?: (expression: AALiteralExpression, parent: Statement | Expression) => Expression | void;
        UnaryExpression?: (expression: UnaryExpression, parent: Statement | Expression) => Expression | void;
        VariableExpression?: (expression: VariableExpression, parent: Statement | Expression) => Expression | void;
        SourceLiteralExpression?: (expression: SourceLiteralExpression, parent: Statement | Expression) => Expression | void;
        NewExpression?: (expression: NewExpression, parent: Statement | Expression) => Expression | void;
        CallfuncExpression?: (expression: CallfuncExpression, parent: Statement | Expression) => Expression | void;
        TemplateStringQuasiExpression?: (expression: TemplateStringQuasiExpression, parent: Statement | Expression) => Expression | void;
        TemplateStringExpression?: (expression: TemplateStringExpression, parent: Statement | Expression) => Expression | void;
        TaggedTemplateStringExpression?: (expression: TaggedTemplateStringExpression, parent: Statement | Expression) => Expression | void;
    }
) {
    return <WalkAllVisitor>((statement: Statement, parent: Statement): Statement | void => {
        return visitor[statement.constructor.name]?.(statement, parent);
    });
}
