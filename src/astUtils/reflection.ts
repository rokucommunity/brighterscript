import { Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement } from '../parser/Statement';
import { ClassFieldStatement, ClassMethodStatement, ClassStatement } from '../parser/ClassStatement';
import { LiteralExpression, Expression, BinaryExpression, CallExpression, FunctionExpression, NamespacedVariableNameExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression } from '../parser/Expression';
import { BrsString, ValueKind, BrsInvalid, BrsBoolean } from '../brsTypes';
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

export function isBody(statement: any): statement is Body {
    return statement?.constructor?.name === 'Body';
}
export function isAssignmentStatement(statement: any): statement is AssignmentStatement {
    return statement?.constructor?.name === 'AssignmentStatement';
}
export function isBlock(statement: any): statement is Block {
    return statement?.constructor?.name === 'Block';
}
export function isExpressionStatement(statement: any): statement is ExpressionStatement {
    return statement?.constructor?.name === 'ExpressionStatement';
}
export function isCommentStatement(statement: any): statement is CommentStatement {
    return statement?.constructor?.name === 'CommentStatement';
}
export function isExitForStatement(statement: any): statement is ExitForStatement {
    return statement?.constructor?.name === 'ExitForStatement';
}
export function isExitWhileStatement(statement: any): statement is ExitWhileStatement {
    return statement?.constructor?.name === 'ExitWhileStatement';
}
export function isFunctionStatement(statement: any): statement is FunctionStatement {
    return statement?.constructor?.name === 'FunctionStatement';
}
export function isIfStatement(statement: any): statement is IfStatement {
    return statement?.constructor?.name === 'IfStatement';
}
export function isIncrementStatement(statement: any): statement is IncrementStatement {
    return statement?.constructor?.name === 'IncrementStatement';
}
export function isPrintStatement(statement: any): statement is PrintStatement {
    return statement?.constructor?.name === 'PrintStatement';
}
export function isGotoStatement(statement: any): statement is GotoStatement {
    return statement?.constructor?.name === 'GotoStatement';
}
export function isLabelStatement(statement: any): statement is LabelStatement {
    return statement?.constructor?.name === 'LabelStatement';
}
export function isReturnStatement(statement: any): statement is ReturnStatement {
    return statement?.constructor?.name === 'ReturnStatement';
}
export function isEndStatement(statement: any): statement is EndStatement {
    return statement?.constructor?.name === 'EndStatement';
}
export function isStopStatement(statement: any): statement is StopStatement {
    return statement?.constructor?.name === 'StopStatement';
}
export function isForStatement(statement: any): statement is ForStatement {
    return statement?.constructor?.name === 'ForStatement';
}
export function isForEachStatement(statement: any): statement is ForEachStatement {
    return statement?.constructor?.name === 'ForEachStatement';
}
export function isWhileStatement(statement: any): statement is WhileStatement {
    return statement?.constructor?.name === 'WhileStatement';
}
export function isDottedSetStatement(statement: any): statement is DottedSetStatement {
    return statement?.constructor?.name === 'DottedSetStatement';
}
export function isIndexedSetStatement(statement: any): statement is IndexedSetStatement {
    return statement?.constructor?.name === 'IndexedSetStatement';
}
export function isLibraryStatement(statement: any): statement is LibraryStatement {
    return statement?.constructor?.name === 'LibraryStatement';
}
export function isNamespaceStatement(statement: any): statement is NamespaceStatement {
    return statement?.constructor?.name === 'NamespaceStatement';
}
export function isClassStatement(statement: any): statement is ClassStatement {
    return statement?.constructor?.name === 'ClassStatement';
}
export function isImportStatement(statement: any): statement is ImportStatement {
    return statement?.constructor?.name === 'ImportStatement';
}
export function isClassMethod(statement: any): statement is ClassMethodStatement {
    return statement?.constructor.name === 'ClassMethodStatement';
}
export function isClassField(statement: any): statement is ClassFieldStatement {
    return statement?.constructor.name === 'ClassFieldStatement';
}

// Expressions reflection

export function isExpression(expression: any): expression is Expression {
    return !!(expression?.walk);
}
export function isBinaryExpression(expression: any): expression is BinaryExpression {
    return expression?.constructor.name === 'BinaryExpression';
}
export function isCallExpression(expression: any): expression is CallExpression {
    return expression?.constructor.name === 'CallExpression';
}
export function isFunctionExpression(expression: any): expression is FunctionExpression {
    return expression?.constructor.name === 'FunctionExpression';
}
export function isNamespacedVariableNameExpression(expression: any): expression is NamespacedVariableNameExpression {
    return expression?.constructor.name === 'NamespacedVariableNameExpression';
}
export function isDottedGetExpression(expression: any): expression is DottedGetExpression {
    return expression?.constructor.name === 'DottedGetExpression';
}
export function isXmlAttributeGetExpression(expression: any): expression is XmlAttributeGetExpression {
    return expression?.constructor.name === 'XmlAttributeGetExpression';
}
export function isIndexedGetExpression(expression: any): expression is IndexedGetExpression {
    return expression?.constructor.name === 'IndexedGetExpression';
}
export function isGroupingExpression(expression: any): expression is GroupingExpression {
    return expression?.constructor.name === 'GroupingExpression';
}
export function isLiteralExpression(expression: any): expression is LiteralExpression {
    return expression?.constructor.name === 'LiteralExpression';
}
export function isEscapedCharCodeLiteral(expression: any): expression is EscapedCharCodeLiteralExpression {
    return expression?.constructor.name === 'EscapedCharCodeLiteralExpression';
}
export function isArrayLiteralExpression(expression: any): expression is ArrayLiteralExpression {
    return expression?.constructor.name === 'ArrayLiteralExpression';
}
export function isAALiteralExpression(expression: any): expression is AALiteralExpression {
    return expression?.constructor.name === 'AALiteralExpression';
}
export function isUnaryExpression(expression: any): expression is UnaryExpression {
    return expression?.constructor.name === 'UnaryExpression';
}
export function isVariableExpression(expression: any): expression is VariableExpression {
    return expression?.constructor.name === 'VariableExpression';
}
export function isSourceLiteralExpression(expression: any): expression is SourceLiteralExpression {
    return expression?.constructor.name === 'SourceLiteralExpression';
}
export function isNewExpression(expression: any): expression is NewExpression {
    return expression?.constructor.name === 'NewExpression';
}
export function isCallfuncExpression(expression: any): expression is CallfuncExpression {
    return expression?.constructor.name === 'CallfuncExpression';
}
export function isTemplateStringQuasiExpression(expression: any): expression is TemplateStringQuasiExpression {
    return expression?.constructor.name === 'TemplateStringQuasiExpression';
}
export function isTemplateStringExpression(expression: any): expression is TemplateStringExpression {
    return expression?.constructor.name === 'TemplateStringExpression';
}
export function isTaggedTemplateStringExpression(expression: any): expression is TaggedTemplateStringExpression {
    return expression?.constructor.name === 'TaggedTemplateStringExpression';
}

// Values reflection

export function isInvalid(value: any): value is BrsInvalid {
    return value?.kind === ValueKind.Invalid;
}
export function isBoolean(value: any): value is BrsBoolean {
    return value?.kind === ValueKind.Boolean;
}
export function isString(value: any): value is BrsString {
    return value?.kind === ValueKind.String;
}
export function isNumber(value: any): value is BrsNumber {
    return value && (
        value.kind === ValueKind.Int32 ||
        value.kind === ValueKind.Int64 ||
        value.kind === ValueKind.Float ||
        value.kind === ValueKind.Double
    );
}

// Literal reflection

export function isLiteralInvalid(e: any): e is LiteralExpression & { value: BrsInvalid } {
    return isLiteralExpression(e) && isInvalid(e.value);
}
export function isLiteralBoolean(e: any): e is LiteralExpression & { value: BrsBoolean } {
    return isLiteralExpression(e) && isBoolean(e.value);
}
export function isLiteralString(e: any): e is LiteralExpression & { value: BrsString } {
    return isLiteralExpression(e) && isString(e.value);
}
export function isLiteralNumber(e: any): e is LiteralExpression & { value: BrsNumber } {
    return isLiteralExpression(e) && isNumber(e.value);
}
