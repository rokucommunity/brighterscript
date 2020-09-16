import { CancellationToken } from 'vscode-languageserver';
import { Statement, Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement } from '../parser/Statement';
import { Expression } from '../parser/Expression';
import { isExpression, isBlock, isIfStatement } from './reflection';


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
 * Walks the statements of a block and direct sub-blocks, and allow replacing statements
 */
export function walkStatements(
    statement: Statement,
    visitor: (statement: Statement, parent: Statement) => Statement | void,
    cancel?: CancellationToken
): void {
    recursiveWalkStatements(statement, undefined, visitor, cancel);
}

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
