import type { Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassFieldStatement, ClassMethodStatement, ClassStatement, InterfaceFieldStatement, InterfaceMethodStatement, InterfaceStatement, EnumStatement, EnumMemberStatement, TryCatchStatement, CatchStatement, ThrowStatement, MethodStatement, FieldStatement, ConstStatement, ContinueStatement } from '../parser/Statement';
import type { LiteralExpression, BinaryExpression, CallExpression, FunctionExpression, NamespacedVariableNameExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression, AnnotationExpression, FunctionParameterExpression, AAMemberExpression } from '../parser/Expression';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import type { BscFile, File, TypedefProvider } from '../interfaces';
import { InvalidType } from '../types/InvalidType';
import { VoidType } from '../types/VoidType';
import { InternalWalkMode } from './visitors';
import { FunctionType } from '../types/FunctionType';
import { StringType } from '../types/StringType';
import { BooleanType } from '../types/BooleanType';
import { IntegerType } from '../types/IntegerType';
import { LongIntegerType } from '../types/LongIntegerType';
import { FloatType } from '../types/FloatType';
import { DoubleType } from '../types/DoubleType';
import { CustomType } from '../types/CustomType';
import type { Scope } from '../Scope';
import type { XmlScope } from '../XmlScope';
import { DynamicType } from '../types/DynamicType';
import type { InterfaceType } from '../types/InterfaceType';
import type { ObjectType } from '../types/ObjectType';
import type { AstNode, Expression, Statement } from '../parser/AstNode';
import { Token } from '../lexer/Token';

// File reflection

export function isBrsFile(file: (BscFile | File)): file is BrsFile {
    return file?.constructor.name === 'BrsFile';
}

export function isXmlFile(file: (BscFile)): file is XmlFile {
    return file?.constructor.name === 'XmlFile';
}

export function isXmlScope(scope: (Scope)): scope is XmlScope {
    return scope?.constructor.name === 'XmlScope';
}


// Statements reflection

/**
 * Determine if the variable is a descendent of the Statement base class.
 * Due to performance restrictions, this expects all statements to
 * directly extend Statement or FunctionStatement,
 * so it only checks the immediate parent's class name.
 */
export function isStatement(element: AstNode | undefined): element is Statement {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitStatements);
}

export function isBody(element: AstNode | undefined): element is Body {
    return element?.constructor?.name === 'Body';
}
export function isAssignmentStatement(element: AstNode | undefined): element is AssignmentStatement {
    return element?.constructor?.name === 'AssignmentStatement';
}
export function isBlock(element: AstNode | undefined): element is Block {
    return element?.constructor?.name === 'Block';
}
export function isExpressionStatement(element: AstNode | undefined): element is ExpressionStatement {
    return element?.constructor?.name === 'ExpressionStatement';
}
export function isCommentStatement(element: AstNode | undefined): element is CommentStatement {
    return element?.constructor?.name === 'CommentStatement';
}
export function isExitForStatement(element: AstNode | undefined): element is ExitForStatement {
    return element?.constructor?.name === 'ExitForStatement';
}
export function isExitWhileStatement(element: AstNode | undefined): element is ExitWhileStatement {
    return element?.constructor?.name === 'ExitWhileStatement';
}
export function isFunctionStatement(element: AstNode | undefined): element is FunctionStatement {
    return element?.constructor?.name === 'FunctionStatement';
}
export function isIfStatement(element: AstNode | undefined): element is IfStatement {
    return element?.constructor?.name === 'IfStatement';
}
export function isIncrementStatement(element: AstNode | undefined): element is IncrementStatement {
    return element?.constructor?.name === 'IncrementStatement';
}
export function isPrintStatement(element: AstNode | undefined): element is PrintStatement {
    return element?.constructor?.name === 'PrintStatement';
}
export function isGotoStatement(element: AstNode | undefined): element is GotoStatement {
    return element?.constructor?.name === 'GotoStatement';
}
export function isLabelStatement(element: AstNode | undefined): element is LabelStatement {
    return element?.constructor?.name === 'LabelStatement';
}
export function isReturnStatement(element: AstNode | undefined): element is ReturnStatement {
    return element?.constructor?.name === 'ReturnStatement';
}
export function isEndStatement(element: AstNode | undefined): element is EndStatement {
    return element?.constructor?.name === 'EndStatement';
}
export function isStopStatement(element: AstNode | undefined): element is StopStatement {
    return element?.constructor?.name === 'StopStatement';
}
export function isForStatement(element: AstNode | undefined): element is ForStatement {
    return element?.constructor?.name === 'ForStatement';
}
export function isForEachStatement(element: AstNode | undefined): element is ForEachStatement {
    return element?.constructor?.name === 'ForEachStatement';
}
export function isWhileStatement(element: AstNode | undefined): element is WhileStatement {
    return element?.constructor?.name === 'WhileStatement';
}
export function isDottedSetStatement(element: AstNode | undefined): element is DottedSetStatement {
    return element?.constructor?.name === 'DottedSetStatement';
}
export function isIndexedSetStatement(element: AstNode | undefined): element is IndexedSetStatement {
    return element?.constructor?.name === 'IndexedSetStatement';
}
export function isLibraryStatement(element: AstNode | undefined): element is LibraryStatement {
    return element?.constructor?.name === 'LibraryStatement';
}
export function isNamespaceStatement(element: AstNode | undefined): element is NamespaceStatement {
    return element?.constructor?.name === 'NamespaceStatement';
}
export function isClassStatement(element: AstNode | undefined): element is ClassStatement {
    return element?.constructor?.name === 'ClassStatement';
}
export function isImportStatement(element: AstNode | undefined): element is ImportStatement {
    return element?.constructor?.name === 'ImportStatement';
}
export function isMethodStatement(element: AstNode | undefined): element is MethodStatement {
    const name = element?.constructor.name;
    return name === 'MethodStatement' || name === 'ClassMethodStatement';
}
/**
 * @deprecated use `isMethodStatement`
 */
export function isClassMethodStatement(element: AstNode | undefined): element is ClassMethodStatement {
    return isMethodStatement(element);
}
export function isFieldStatement(element: AstNode | undefined): element is FieldStatement {
    const name = element?.constructor.name;
    return name === 'FieldStatement' || name === 'ClassFieldStatement';
}
/**
 * @deprecated use `isFieldStatement`
 */
export function isClassFieldStatement(element: AstNode | undefined): element is ClassFieldStatement {
    return isFieldStatement(element);
}
export function isInterfaceStatement(element: AstNode | undefined): element is InterfaceStatement {
    return element?.constructor.name === 'InterfaceStatement';
}
export function isInterfaceMethodStatement(element: AstNode | undefined): element is InterfaceMethodStatement {
    return element?.constructor.name === 'InterfaceMethodStatement';
}
export function isInterfaceFieldStatement(element: AstNode | undefined): element is InterfaceFieldStatement {
    return element?.constructor.name === 'InterfaceFieldStatement';
}
export function isEnumStatement(element: AstNode | undefined): element is EnumStatement {
    return element?.constructor.name === 'EnumStatement';
}
export function isEnumMemberStatement(element: AstNode | undefined): element is EnumMemberStatement {
    return element?.constructor.name === 'EnumMemberStatement';
}
export function isConstStatement(element: AstNode | undefined): element is ConstStatement {
    return element?.constructor.name === 'ConstStatement';
}
export function isContinueStatement(element: AstNode | undefined): element is ContinueStatement {
    return element?.constructor.name === 'ContinueStatement';
}
export function isTryCatchStatement(element: AstNode | undefined): element is TryCatchStatement {
    return element?.constructor.name === 'TryCatchStatement';
}
export function isCatchStatement(element: AstNode | undefined): element is CatchStatement {
    return element?.constructor.name === 'CatchStatement';
}
export function isThrowStatement(element: AstNode | undefined): element is ThrowStatement {
    return element?.constructor.name === 'ThrowStatement';
}

// Expressions reflection
/**
 * Determine if the variable is a descendent of the Expression base class.
 * Due to performance restrictions, this expects all statements to directly extend Expression,
 * so it only checks the immediate parent's class name. For example:
 * this will work for StringLiteralExpression -> Expression,
 * but will not work CustomStringLiteralExpression -> StringLiteralExpression -> Expression
 */
export function isExpression(element: AstNode | Token | undefined): element is Expression {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitExpressions);
}

export function isBinaryExpression(element: AstNode | undefined): element is BinaryExpression {
    return element?.constructor.name === 'BinaryExpression';
}
export function isCallExpression(element: AstNode | undefined): element is CallExpression {
    return element?.constructor.name === 'CallExpression';
}
export function isFunctionExpression(element: AstNode | undefined): element is FunctionExpression {
    return element?.constructor.name === 'FunctionExpression';
}
export function isNamespacedVariableNameExpression(element: AstNode | undefined): element is NamespacedVariableNameExpression {
    return element?.constructor.name === 'NamespacedVariableNameExpression';
}
export function isDottedGetExpression(element: AstNode | undefined): element is DottedGetExpression {
    return element?.constructor.name === 'DottedGetExpression';
}
export function isXmlAttributeGetExpression(element: AstNode | undefined): element is XmlAttributeGetExpression {
    return element?.constructor.name === 'XmlAttributeGetExpression';
}
export function isIndexedGetExpression(element: AstNode | undefined): element is IndexedGetExpression {
    return element?.constructor.name === 'IndexedGetExpression';
}
export function isGroupingExpression(element: AstNode | undefined): element is GroupingExpression {
    return element?.constructor.name === 'GroupingExpression';
}
export function isLiteralExpression(element: AstNode | undefined): element is LiteralExpression {
    return element?.constructor.name === 'LiteralExpression';
}
export function isEscapedCharCodeLiteralExpression(element: AstNode | undefined): element is EscapedCharCodeLiteralExpression {
    return element?.constructor.name === 'EscapedCharCodeLiteralExpression';
}
export function isArrayLiteralExpression(element: AstNode | undefined): element is ArrayLiteralExpression {
    return element?.constructor.name === 'ArrayLiteralExpression';
}
export function isAALiteralExpression(element: AstNode | undefined): element is AALiteralExpression {
    return element?.constructor.name === 'AALiteralExpression';
}
export function isAAMemberExpression(element: AstNode | undefined): element is AAMemberExpression {
    return element?.constructor.name === 'AAMemberExpression';
}
export function isUnaryExpression(element: AstNode | undefined): element is UnaryExpression {
    return element?.constructor.name === 'UnaryExpression';
}
export function isVariableExpression(element: AstNode | undefined): element is VariableExpression {
    return element?.constructor.name === 'VariableExpression';
}
export function isSourceLiteralExpression(element: AstNode | undefined): element is SourceLiteralExpression {
    return element?.constructor.name === 'SourceLiteralExpression';
}
export function isNewExpression(element: AstNode | undefined): element is NewExpression {
    return element?.constructor.name === 'NewExpression';
}
export function isCallfuncExpression(element: AstNode | undefined): element is CallfuncExpression {
    return element?.constructor.name === 'CallfuncExpression';
}
export function isTemplateStringQuasiExpression(element: AstNode | undefined): element is TemplateStringQuasiExpression {
    return element?.constructor.name === 'TemplateStringQuasiExpression';
}
export function isTemplateStringExpression(element: AstNode | undefined): element is TemplateStringExpression {
    return element?.constructor.name === 'TemplateStringExpression';
}
export function isTaggedTemplateStringExpression(element: AstNode | undefined): element is TaggedTemplateStringExpression {
    return element?.constructor.name === 'TaggedTemplateStringExpression';
}
export function isFunctionParameterExpression(element: AstNode | undefined): element is FunctionParameterExpression {
    return element?.constructor.name === 'FunctionParameterExpression';
}
export function isAnnotationExpression(element: AstNode | undefined): element is AnnotationExpression {
    return element?.constructor.name === 'AnnotationExpression';
}
export function isTypedefProvider(element: any): element is TypedefProvider {
    return 'getTypedef' in element;
}

// BscType reflection
export function isStringType(value: any): value is StringType {
    return value?.constructor.name === StringType.name;
}
export function isFunctionType(e: any): e is FunctionType {
    return e?.constructor.name === FunctionType.name;
}
export function isBooleanType(e: any): e is BooleanType {
    return e?.constructor.name === BooleanType.name;
}
export function isIntegerType(e: any): e is IntegerType {
    return e?.constructor.name === IntegerType.name;
}
export function isLongIntegerType(e: any): e is LongIntegerType {
    return e?.constructor.name === LongIntegerType.name;
}
export function isFloatType(e: any): e is FloatType {
    return e?.constructor.name === FloatType.name;
}
export function isDoubleType(e: any): e is DoubleType {
    return e?.constructor.name === DoubleType.name;
}
export function isInvalidType(e: any): e is InvalidType {
    return e?.constructor.name === InvalidType.name;
}
export function isVoidType(e: any): e is VoidType {
    return e?.constructor.name === VoidType.name;
}
export function isCustomType(e: any): e is CustomType {
    return e?.constructor.name === CustomType.name;
}
export function isDynamicType(e: any): e is DynamicType {
    return e?.constructor.name === DynamicType.name;
}
export function isInterfaceType(e: any): e is InterfaceType {
    return e?.constructor.name === 'InterfaceType';
}
export function isObjectType(e: any): e is ObjectType {
    return e?.constructor.name === 'ObjectType';
}

const numberConstructorNames = [
    IntegerType.name,
    LongIntegerType.name,
    FloatType.name,
    DoubleType.name
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
