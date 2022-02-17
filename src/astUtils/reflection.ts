import type { Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassFieldStatement, ClassMethodStatement, ClassStatement, Statement, InterfaceFieldStatement, InterfaceMethodStatement, InterfaceStatement, EnumStatement, EnumMemberStatement } from '../parser/Statement';
import type { LiteralExpression, Expression, BinaryExpression, CallExpression, FunctionExpression, NamespacedVariableNameExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression, AnnotationExpression, FunctionParameterExpression, AAMemberExpression, RegexLiteralExpression } from '../parser/Expression';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import type { BscFile, TypedefProvider } from '../interfaces';
import type { InvalidType } from '../types/InvalidType';
import type { VoidType } from '../types/VoidType';
import { InternalWalkMode } from './visitors';
import type { FunctionType } from '../types/FunctionType';
import type { StringType } from '../types/StringType';
import type { BooleanType } from '../types/BooleanType';
import type { IntegerType } from '../types/IntegerType';
import type { LongIntegerType } from '../types/LongIntegerType';
import type { FloatType } from '../types/FloatType';
import type { DoubleType } from '../types/DoubleType';
import type { CustomType } from '../types/CustomType';
import type { Scope } from '../Scope';
import type { XmlScope } from '../XmlScope';
import type { DynamicType } from '../types/DynamicType';
import type { InterfaceType } from '../types/InterfaceType';
import type { ObjectType } from '../types/ObjectType';
import type { UninitializedType } from '../types/UninitializedType';
import type { ArrayType } from '../types/ArrayType';
import type { LazyType } from '../types/LazyType';
import type { SGInterfaceField, SGInterfaceFunction, SGNode } from '../parser/SGTypes';

// File reflection

export function isBrsFile(file: BscFile): file is BrsFile {
    return file?.constructor.name === 'BrsFile';
}

export function isXmlFile(file: (BscFile)): file is XmlFile {
    return file?.constructor.name === 'XmlFile';
}

export function isXmlScope(scope: (Scope | XmlScope)): scope is XmlScope {
    return scope?.constructor.name === 'XmlScope';
}


// Statements reflection

/**
 * Determine if the variable is a descendent of the Statement base class.
 * Due to performance restrictions, this expects all statements to
 * directly extend Statement or FunctionStatement,
 * so it only checks the immediate parent's class name.
 */
export function isStatement(element: Statement | Expression | undefined): element is Statement {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitStatements);
}

export function isBody(element: Statement | Expression | undefined): element is Body {
    return element?.constructor?.name === 'Body';
}
export function isAssignmentStatement(element: Statement | Expression | undefined): element is AssignmentStatement {
    return element?.constructor?.name === 'AssignmentStatement';
}
export function isBlock(element: Statement | Expression | undefined): element is Block {
    return element?.constructor?.name === 'Block';
}
export function isExpressionStatement(element: Statement | Expression | undefined): element is ExpressionStatement {
    return element?.constructor?.name === 'ExpressionStatement';
}
export function isCommentStatement(element: Statement | Expression | undefined): element is CommentStatement {
    return element?.constructor?.name === 'CommentStatement';
}
export function isExitForStatement(element: Statement | Expression | undefined): element is ExitForStatement {
    return element?.constructor?.name === 'ExitForStatement';
}
export function isExitWhileStatement(element: Statement | Expression | undefined): element is ExitWhileStatement {
    return element?.constructor?.name === 'ExitWhileStatement';
}
export function isFunctionStatement(element: Statement | Expression | undefined): element is FunctionStatement {
    return element?.constructor?.name === 'FunctionStatement';
}
export function isIfStatement(element: Statement | Expression | undefined): element is IfStatement {
    return element?.constructor?.name === 'IfStatement';
}
export function isIncrementStatement(element: Statement | Expression | undefined): element is IncrementStatement {
    return element?.constructor?.name === 'IncrementStatement';
}
export function isPrintStatement(element: Statement | Expression | undefined): element is PrintStatement {
    return element?.constructor?.name === 'PrintStatement';
}
export function isGotoStatement(element: Statement | Expression | undefined): element is GotoStatement {
    return element?.constructor?.name === 'GotoStatement';
}
export function isLabelStatement(element: Statement | Expression | undefined): element is LabelStatement {
    return element?.constructor?.name === 'LabelStatement';
}
export function isReturnStatement(element: Statement | Expression | undefined): element is ReturnStatement {
    return element?.constructor?.name === 'ReturnStatement';
}
export function isEndStatement(element: Statement | Expression | undefined): element is EndStatement {
    return element?.constructor?.name === 'EndStatement';
}
export function isStopStatement(element: Statement | Expression | undefined): element is StopStatement {
    return element?.constructor?.name === 'StopStatement';
}
export function isForStatement(element: Statement | Expression | undefined): element is ForStatement {
    return element?.constructor?.name === 'ForStatement';
}
export function isForEachStatement(element: Statement | Expression | undefined): element is ForEachStatement {
    return element?.constructor?.name === 'ForEachStatement';
}
export function isWhileStatement(element: Statement | Expression | undefined): element is WhileStatement {
    return element?.constructor?.name === 'WhileStatement';
}
export function isDottedSetStatement(element: Statement | Expression | undefined): element is DottedSetStatement {
    return element?.constructor?.name === 'DottedSetStatement';
}
export function isIndexedSetStatement(element: Statement | Expression | undefined): element is IndexedSetStatement {
    return element?.constructor?.name === 'IndexedSetStatement';
}
export function isLibraryStatement(element: Statement | Expression | undefined): element is LibraryStatement {
    return element?.constructor?.name === 'LibraryStatement';
}
export function isNamespaceStatement(element: Statement | Expression | undefined): element is NamespaceStatement {
    return element?.constructor?.name === 'NamespaceStatement';
}
export function isClassStatement(element: Statement | Expression | undefined): element is ClassStatement {
    return element?.constructor?.name === 'ClassStatement';
}
export function isImportStatement(element: Statement | Expression | undefined): element is ImportStatement {
    return element?.constructor?.name === 'ImportStatement';
}
export function isClassMethodStatement(element: Statement | Expression | undefined): element is ClassMethodStatement {
    return element?.constructor.name === 'ClassMethodStatement';
}
export function isClassFieldStatement(element: Statement | Expression | undefined): element is ClassFieldStatement {
    return element?.constructor.name === 'ClassFieldStatement';
}
export function isInterfaceStatement(element: Statement | Expression | undefined): element is InterfaceStatement {
    return element?.constructor.name === 'InterfaceStatement';
}
export function isInterfaceMethodStatement(element: Statement | Expression | undefined): element is InterfaceMethodStatement {
    return element?.constructor.name === 'InterfaceMethodStatement';
}
export function isInterfaceFieldStatement(element: Statement | Expression | undefined): element is InterfaceFieldStatement {
    return element?.constructor.name === 'InterfaceFieldStatement';
}
export function isEnumStatement(element: Statement | Expression | undefined): element is EnumStatement {
    return element?.constructor.name === 'EnumStatement';
}
export function isEnumMemberStatement(element: Statement | Expression | undefined): element is EnumMemberStatement {
    return element?.constructor.name === 'EnumMemberStatement';
}

// Expressions reflection
/**
 * Determine if the variable is a descendent of the Expression base class.
 * Due to performance restrictions, this expects all statements to directly extend Expression,
 * so it only checks the immediate parent's class name. For example:
 * this will work for StringLiteralExpression -> Expression,
 * but will not work CustomStringLiteralExpression -> StringLiteralExpression -> Expression
 */
export function isExpression(element: Statement | Expression | undefined): element is Expression {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitExpressions);
}

export function isBinaryExpression(element: Statement | Expression | undefined): element is BinaryExpression {
    return element?.constructor.name === 'BinaryExpression';
}
export function isCallExpression(element: Statement | Expression | undefined): element is CallExpression {
    return element?.constructor.name === 'CallExpression';
}
export function isFunctionExpression(element: Statement | Expression | undefined): element is FunctionExpression {
    return element?.constructor.name === 'FunctionExpression';
}
export function isNamespacedVariableNameExpression(element: Statement | Expression | undefined): element is NamespacedVariableNameExpression {
    return element?.constructor.name === 'NamespacedVariableNameExpression';
}
export function isDottedGetExpression(element: Statement | Expression | undefined): element is DottedGetExpression {
    return element?.constructor.name === 'DottedGetExpression';
}
export function isXmlAttributeGetExpression(element: Statement | Expression | undefined): element is XmlAttributeGetExpression {
    return element?.constructor.name === 'XmlAttributeGetExpression';
}
export function isIndexedGetExpression(element: Statement | Expression | undefined): element is IndexedGetExpression {
    return element?.constructor.name === 'IndexedGetExpression';
}
export function isGroupingExpression(element: Statement | Expression | undefined): element is GroupingExpression {
    return element?.constructor.name === 'GroupingExpression';
}
export function isLiteralExpression(element: Statement | Expression | undefined): element is LiteralExpression {
    return element?.constructor.name === 'LiteralExpression';
}
export function isEscapedCharCodeLiteralExpression(element: Statement | Expression | undefined): element is EscapedCharCodeLiteralExpression {
    return element?.constructor.name === 'EscapedCharCodeLiteralExpression';
}
export function isArrayLiteralExpression(element: Statement | Expression | undefined): element is ArrayLiteralExpression {
    return element?.constructor.name === 'ArrayLiteralExpression';
}
export function isAALiteralExpression(element: Statement | Expression | undefined): element is AALiteralExpression {
    return element?.constructor.name === 'AALiteralExpression';
}
export function isAAMemberExpression(element: Statement | Expression | undefined): element is AAMemberExpression {
    return element?.constructor.name === 'AAMemberExpression';
}
export function isUnaryExpression(element: Statement | Expression | undefined): element is UnaryExpression {
    return element?.constructor.name === 'UnaryExpression';
}
export function isVariableExpression(element: Statement | Expression | undefined): element is VariableExpression {
    return element?.constructor.name === 'VariableExpression';
}
export function isSourceLiteralExpression(element: Statement | Expression | undefined): element is SourceLiteralExpression {
    return element?.constructor.name === 'SourceLiteralExpression';
}
export function isNewExpression(element: Statement | Expression | undefined): element is NewExpression {
    return element?.constructor.name === 'NewExpression';
}
export function isCallfuncExpression(element: Statement | Expression | undefined): element is CallfuncExpression {
    return element?.constructor.name === 'CallfuncExpression';
}
export function isTemplateStringQuasiExpression(element: Statement | Expression | undefined): element is TemplateStringQuasiExpression {
    return element?.constructor.name === 'TemplateStringQuasiExpression';
}
export function isTemplateStringExpression(element: Statement | Expression | undefined): element is TemplateStringExpression {
    return element?.constructor.name === 'TemplateStringExpression';
}
export function isTaggedTemplateStringExpression(element: Statement | Expression | undefined): element is TaggedTemplateStringExpression {
    return element?.constructor.name === 'TaggedTemplateStringExpression';
}
export function isFunctionParameterExpression(element: Statement | Expression | undefined): element is FunctionParameterExpression {
    return element?.constructor.name === 'FunctionParameterExpression';
}
export function isAnnotationExpression(element: Statement | Expression | undefined): element is AnnotationExpression {
    return element?.constructor.name === 'AnnotationExpression';
}
export function isRegexLiteralExpression(element: Statement | Expression | undefined): element is RegexLiteralExpression {
    return element?.constructor.name === 'RegexLiteralExpression';
}
export function isTypedefProvider(element: any): element is TypedefProvider {
    return 'getTypedef' in element;
}

// BscType reflection
// Note: these are Hardcoded to avoid circular dependencies
export function isStringType(value: any): value is StringType {
    return value?.constructor.name === 'StringType';
}
export function isFunctionType(e: any): e is FunctionType {
    return e?.constructor.name === 'FunctionType';
}
export function isBooleanType(e: any): e is BooleanType {
    return e?.constructor.name === 'BooleanType';
}
export function isIntegerType(e: any): e is IntegerType {
    return e?.constructor.name === 'IntegerType';
}
export function isLongIntegerType(e: any): e is LongIntegerType {
    return e?.constructor.name === 'LongIntegerType';
}
export function isFloatType(e: any): e is FloatType {
    return e?.constructor.name === 'FloatType';
}
export function isDoubleType(e: any): e is DoubleType {
    return e?.constructor.name === 'DoubleType';
}
export function isPrimitiveType(e: any) {
    return isBooleanType(e) || isIntegerType(e) || isFloatType(e) || isDoubleType(e) || isStringType(e) || isLongIntegerType(e);
}
export function isInvalidType(e: any): e is InvalidType {
    return e?.constructor.name === 'InvalidType';
}
export function isVoidType(e: any): e is VoidType {
    return e?.constructor.name === 'VoidType';
}
export function isCustomType(e: any): e is CustomType {
    return e?.constructor.name === 'CustomType';
}
export function isUninitializedType(e: any): e is UninitializedType {
    return e?.constructor.name === 'UninitializedType';
}
export function isInterfaceType(e: any): e is InterfaceType {
    return e?.constructor.name === 'InterfaceType';
}
export function isArrayType(e: any): e is ArrayType {
    return e?.constructor.name === 'ArrayType';
}
export function isObjectType(e: any): e is ObjectType {
    return e?.constructor.name === 'ObjectType';
}
export function isDynamicType(e: any): e is DynamicType {
    return e?.constructor.name === 'DynamicType';
}
export function isLazyType(e: any): e is LazyType {
    return e?.constructor.name === 'LazyType';
}

const numberConstructorNames = [
    'IntegerType',
    'LongIntegerType',
    'FloatType',
    'DoubleType'
];
export function isNumberType(e: any): e is IntegerType | LongIntegerType | FloatType | DoubleType {
    return numberConstructorNames.includes(e?.constructor.name);
}

// Literal reflection

export function isLiteralInvalid(e: any): e is LiteralExpression & { type: InvalidType } {
    return isLiteralExpression(e) && isInvalidType(e.type);
}
export function isLiteralBoolean(e: any): e is LiteralExpression & { type: BooleanType } {
    return isLiteralExpression(e) && isBooleanType(e.type);
}
export function isLiteralString(e: any): e is LiteralExpression & { type: StringType } {
    return isLiteralExpression(e) && isStringType(e.type);
}
export function isLiteralNumber(e: any): e is LiteralExpression & { type: IntegerType | LongIntegerType | FloatType | DoubleType } {
    return isLiteralExpression(e) && isNumberType(e.type);
}

export function isSGInterfaceField(e: SGNode): e is SGInterfaceField {
    return e?.constructor.name === 'SGInterfaceField';
}
export function isSGInterfaceFunction(e: SGNode): e is SGInterfaceFunction {
    return e?.constructor.name === 'SGInterfaceFunction';
}
