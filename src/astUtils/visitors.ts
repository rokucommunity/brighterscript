import { CancellationToken } from 'vscode-languageserver';
import { Statement, Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement } from '../parser/Statement';
import { Expression } from '../parser/Expression';
import { isExpression, isBlock, isIfStatement } from './reflection';

/**
 * Create a filtered visitor for use with `walkStatements`
 */
export function createStatementVisitor(
    visitor: {
        Body?: (statement: Body, parent: Statement) => void;
        AssignmentStatement?: (statement: AssignmentStatement, parent: Statement) => void;
        Block?: (statement: Block, parent: Statement) => void;
        ExpressionStatement?: (statement: ExpressionStatement, parent: Statement) => void;
        CommentStatement?: (statement: CommentStatement, parent: Statement) => void;
        ExitForStatement?: (statement: ExitForStatement, parent: Statement) => void;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent: Statement) => void;
        FunctionStatement?: (statement: FunctionStatement, parent: Statement) => void;
        IfStatement?: (statement: IfStatement, parent: Statement) => void;
        IncrementStatement?: (statement: IncrementStatement, parent: Statement) => void;
        PrintStatement?: (statement: PrintStatement, parent: Statement) => void;
        GotoStatement?: (statement: GotoStatement, parent: Statement) => void;
        LabelStatement?: (statement: LabelStatement, parent: Statement) => void;
        ReturnStatement?: (statement: ReturnStatement, parent: Statement) => void;
        EndStatement?: (statement: EndStatement, parent: Statement) => void;
        StopStatement?: (statement: StopStatement, parent: Statement) => void;
        ForStatement?: (statement: ForStatement, parent: Statement) => void;
        ForEachStatement?: (statement: ForEachStatement, parent: Statement) => void;
        WhileStatement?: (statement: WhileStatement, parent: Statement) => void;
        DottedSetStatement?: (statement: DottedSetStatement, parent: Statement) => void;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent: Statement) => void;
        LibraryStatement?: (statement: LibraryStatement, parent: Statement) => void;
        NamespaceStatement?: (statement: NamespaceStatement, parent: Statement) => void;
        ImportStatement?: (statement: ImportStatement, parent: Statement) => void;
    }
) {
    return (statement: Statement, parent: Statement) => {
        visitor[statement.constructor.name]?.(statement, parent);
    };
}

/**
 * Create a filtered visitor for use with `editStatements`
 */
export function createStatementEditor(
    visitor: {
        Body?: (statement: Body, parent: Statement) => Statement | undefined;
        AssignmentStatement?: (statement: AssignmentStatement, parent: Statement) => Statement | undefined;
        Block?: (statement: Block, parent: Statement) => Statement | undefined;
        ExpressionStatement?: (statement: ExpressionStatement, parent: Statement) => Statement | undefined;
        CommentStatement?: (statement: CommentStatement, parent: Statement) => Statement | undefined;
        ExitForStatement?: (statement: ExitForStatement, parent: Statement) => Statement | undefined;
        ExitWhileStatement?: (statement: ExitWhileStatement, parent: Statement) => Statement | undefined;
        FunctionStatement?: (statement: FunctionStatement, parent: Statement) => Statement | undefined;
        IfStatement?: (statement: IfStatement, parent: Statement) => Statement | undefined;
        IncrementStatement?: (statement: IncrementStatement, parent: Statement) => Statement | undefined;
        PrintStatement?: (statement: PrintStatement, parent: Statement) => Statement | undefined;
        GotoStatement?: (statement: GotoStatement, parent: Statement) => Statement | undefined;
        LabelStatement?: (statement: LabelStatement, parent: Statement) => Statement | undefined;
        ReturnStatement?: (statement: ReturnStatement, parent: Statement) => Statement | undefined;
        EndStatement?: (statement: EndStatement, parent: Statement) => Statement | undefined;
        StopStatement?: (statement: StopStatement, parent: Statement) => Statement | undefined;
        ForStatement?: (statement: ForStatement, parent: Statement) => Statement | undefined;
        ForEachStatement?: (statement: ForEachStatement, parent: Statement) => Statement | undefined;
        WhileStatement?: (statement: WhileStatement, parent: Statement) => Statement | undefined;
        DottedSetStatement?: (statement: DottedSetStatement, parent: Statement) => Statement | undefined;
        IndexedSetStatement?: (statement: IndexedSetStatement, parent: Statement) => Statement | undefined;
        LibraryStatement?: (statement: LibraryStatement, parent: Statement) => Statement | undefined;
        NamespaceStatement?: (statement: NamespaceStatement, parent: Statement) => Statement | undefined;
        ImportStatement?: (statement: ImportStatement, parent: Statement) => Statement | undefined;
    }
) {
    return (statement: Statement, parent: Statement) => {
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
 * Superficial walk of the statements of a block and direct sub-blocks
 * Note: does not explore sub-functions
 */
export function walkStatements(
    statement: Statement,
    visitor: (statement: Statement, parent: Statement) => void,
    cancel?: CancellationToken
): void {
    editStatements(statement, (s, p) => {
        visitor(s, p);
        return undefined;
    }, cancel);
}

/**
 * Walks the statements of a block and direct sub-blocks, and allow replacing statements
 */
export function editStatements(
    statement: Statement,
    visitor: (statement: Statement, parent: Statement) => Statement | undefined,
    cancel?: CancellationToken
): void {
    recursiveWalkStatements(statement, undefined, visitor, cancel);
}

function recursiveWalkStatements(
    statement: Statement,
    parent: Statement,
    visitor: (statement: Statement, parent: Statement) => Statement | undefined,
    cancel: CancellationToken
): Statement | undefined {
    if (cancel?.isCancellationRequested) {
        return;
    }
    const result = visitor(statement, parent);
    if (result?.transpile) {
        // replace statement and don't recurse
        return result;
    }
    if (isBlock(statement)) {
        statement.statements.forEach((s, index) => {
            const result = recursiveWalkStatements(s, statement, visitor, cancel);
            if (result) {
                statement.statements[index] = result;
            }
        });
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
