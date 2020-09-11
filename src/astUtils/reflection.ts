import { Statement, Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement } from '../parser/Statement';
import { Token } from '../lexer/Token';
import { LiteralExpression, Expression, BinaryExpression, CallExpression, FunctionExpression, NamespacedVariableNameExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteral, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression } from '../parser/Expression';
import { BrsType, BrsString, ValueKind, BrsInvalid, BrsBoolean } from '../brsTypes';
import { BrsNumber } from '../brsTypes/BrsNumber';
import { BrsFile } from '../files/BrsFile';
import { XmlFile } from '../files/XmlFile';

// File reflection

export function isBrsFile(file: (BrsFile | XmlFile)): file is BrsFile {
    return file.extension === '.brs' || file.extension === '.bs';
}

export function isXmlFile(file: (BrsFile | XmlFile)): file is XmlFile {
    return file.extension === '.xml';
}

// Statements reflection

export function isBody(statement: Statement): statement is Body {
    return statement?.constructor?.name === 'Body';
}
export function isAssignmentStatement(statement: Statement): statement is AssignmentStatement {
    return statement?.constructor?.name === 'AssignmentStatement';
}
export function isBlock(statement: Statement): statement is Block {
    return statement?.constructor?.name === 'Block';
}
export function isExpressionStatement(statement: Statement): statement is ExpressionStatement {
    return statement?.constructor?.name === 'ExpressionStatement';
}
export function isCommentStatement(statement: Statement): statement is CommentStatement {
    return statement?.constructor?.name === 'CommentStatement';
}
export function isExitForStatement(statement: Statement): statement is ExitForStatement {
    return statement?.constructor?.name === 'ExitForStatement';
}
export function isExitWhileStatement(statement: Statement): statement is ExitWhileStatement {
    return statement?.constructor?.name === 'ExitWhileStatement';
}
export function isFunctionStatement(statement: Statement): statement is FunctionStatement {
    return statement?.constructor?.name === 'FunctionStatement';
}
export function isIfStatement(statement: Statement): statement is IfStatement {
    return statement?.constructor?.name === 'IfStatement';
}
export function isIncrementStatement(statement: Statement): statement is IncrementStatement {
    return statement?.constructor?.name === 'IncrementStatement';
}
export function isPrintStatement(statement: Statement): statement is PrintStatement {
    return statement?.constructor?.name === 'PrintStatement';
}
export function isGotoStatement(statement: Statement): statement is GotoStatement {
    return statement?.constructor?.name === 'GotoStatement';
}
export function isLabelStatement(statement: Statement): statement is LabelStatement {
    return statement?.constructor?.name === 'LabelStatement';
}
export function isReturnStatement(statement: Statement): statement is ReturnStatement {
    return statement?.constructor?.name === 'ReturnStatement';
}
export function isEndStatement(statement: Statement): statement is EndStatement {
    return statement?.constructor?.name === 'EndStatement';
}
export function isStopStatement(statement: Statement): statement is StopStatement {
    return statement?.constructor?.name === 'StopStatement';
}
export function isForStatement(statement: Statement): statement is ForStatement {
    return statement?.constructor?.name === 'ForStatement';
}
export function isForEachStatement(statement: Statement): statement is ForEachStatement {
    return statement?.constructor?.name === 'ForEachStatement';
}
export function isWhileStatement(statement: Statement): statement is WhileStatement {
    return statement?.constructor?.name === 'WhileStatement';
}
export function isDottedSetStatement(statement: Statement): statement is DottedSetStatement {
    return statement?.constructor?.name === 'DottedSetStatement';
}
export function isIndexedSetStatement(statement: Statement): statement is IndexedSetStatement {
    return statement?.constructor?.name === 'IndexedSetStatement';
}
export function isLibraryStatement(statement: Statement): statement is LibraryStatement {
    return statement?.constructor?.name === 'LibraryStatement';
}
export function isNamespaceStatement(statement: Statement): statement is NamespaceStatement {
    return statement?.constructor?.name === 'NamespaceStatement';
}
export function isImportStatement(statement: Statement): statement is ImportStatement {
    return statement?.constructor?.name === 'ImportStatement';
}

// Expressions reflection

export function isExpression(expression: Expression | Token): expression is Expression {
    return !!(expression && (expression as any).walk);
}
export function isBinaryExpression(expression: Expression | Token): expression is BinaryExpression {
    return expression?.constructor.name === 'BinaryExpression';
}
export function isCallExpression(expression: Expression | Token): expression is CallExpression {
    return expression?.constructor.name === 'CallExpression';
}
export function isFunctionExpression(expression: Expression | Token): expression is FunctionExpression {
    return expression?.constructor.name === 'FunctionExpression';
}
export function isNamespacedVariableNameExpression(expression: Expression | Token): expression is NamespacedVariableNameExpression {
    return expression?.constructor.name === 'NamespacedVariableNameExpression';
}
export function isDottedGetExpression(expression: Expression | Token): expression is DottedGetExpression {
    return expression?.constructor.name === 'DottedGetExpression';
}
export function isXmlAttributeGetExpression(expression: Expression | Token): expression is XmlAttributeGetExpression {
    return expression?.constructor.name === 'XmlAttributeGetExpression';
}
export function isIndexedGetExpression(expression: Expression | Token): expression is IndexedGetExpression {
    return expression?.constructor.name === 'IndexedGetExpression';
}
export function isGroupingExpression(expression: Expression | Token): expression is GroupingExpression {
    return expression?.constructor.name === 'GroupingExpression';
}
export function isLiteralExpression(expression: Expression | Token): expression is LiteralExpression {
    return expression?.constructor.name === 'LiteralExpression';
}
export function isEscapedCharCodeLiteral(expression: Expression | Token): expression is EscapedCharCodeLiteral {
    return expression?.constructor.name === 'EscapedCharCodeLiteral';
}
export function isArrayLiteralExpression(expression: Expression | Token): expression is ArrayLiteralExpression {
    return expression?.constructor.name === 'ArrayLiteralExpression';
}
export function isAALiteralExpression(expression: Expression | Token): expression is AALiteralExpression {
    return expression?.constructor.name === 'AALiteralExpression';
}
export function isUnaryExpression(expression: Expression | Token): expression is UnaryExpression {
    return expression?.constructor.name === 'UnaryExpression';
}
export function isVariableExpression(expression: Expression | Token): expression is VariableExpression {
    return expression?.constructor.name === 'VariableExpression';
}
export function isSourceLiteralExpression(expression: Expression | Token): expression is SourceLiteralExpression {
    return expression?.constructor.name === 'SourceLiteralExpression';
}
export function isNewExpression(expression: Expression | Token): expression is NewExpression {
    return expression?.constructor.name === 'NewExpression';
}
export function isCallfuncExpression(expression: Expression | Token): expression is CallfuncExpression {
    return expression?.constructor.name === 'CallfuncExpression';
}
export function isTemplateStringQuasiExpression(expression: Expression | Token): expression is TemplateStringQuasiExpression {
    return expression?.constructor.name === 'TemplateStringQuasiExpression';
}
export function isTemplateStringExpression(expression: Expression | Token): expression is TemplateStringExpression {
    return expression?.constructor.name === 'TemplateStringExpression';
}
export function isTaggedTemplateStringExpression(expression: Expression | Token): expression is TaggedTemplateStringExpression {
    return expression?.constructor.name === 'TaggedTemplateStringExpression';
}

// Values reflection

export function isInvalid(value: BrsType): value is BrsInvalid {
    return value?.kind === ValueKind.Invalid;
}
export function isBoolean(value: BrsType): value is BrsBoolean {
    return value?.kind === ValueKind.Boolean;
}
export function isString(value: BrsType): value is BrsString {
    return value?.kind === ValueKind.String;
}
export function isNumber(value: BrsType): value is BrsNumber {
    return value && (
        value.kind === ValueKind.Int32 ||
        value.kind === ValueKind.Int64 ||
        value.kind === ValueKind.Float ||
        value.kind === ValueKind.Double
    );
}

// Literal reflection

export function isLiteralInvalid(e: Expression | Token): e is LiteralExpression & { value: BrsInvalid } {
    return isLiteralExpression(e) && isInvalid(e.value);
}
export function isLiteralBoolean(e: Expression | Token): e is LiteralExpression & { value: BrsBoolean } {
    return isLiteralExpression(e) && isBoolean(e.value);
}
export function isLiteralString(e: Expression | Token): e is LiteralExpression & { value: BrsString } {
    return isLiteralExpression(e) && isString(e.value);
}
export function isLiteralNumber(e: Expression | Token): e is LiteralExpression & { value: BrsNumber } {
    return isLiteralExpression(e) && isNumber(e.value);
}
