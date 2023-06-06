import type { Body, AssignmentStatement, Block, ExpressionStatement, CommentStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassFieldStatement, ClassMethodStatement, ClassStatement, InterfaceFieldStatement, InterfaceMethodStatement, InterfaceStatement, EnumStatement, EnumMemberStatement, TryCatchStatement, CatchStatement, ThrowStatement, MethodStatement, FieldStatement, ConstStatement, ContinueStatement } from '../parser/Statement';
import type { LiteralExpression, BinaryExpression, CallExpression, FunctionExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression, AnnotationExpression, FunctionParameterExpression, AAMemberExpression, TypeExpression, TypeCastExpression } from '../parser/Expression';
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
import { ClassType } from '../types/ClassType';
import type { Scope } from '../Scope';
import type { XmlScope } from '../XmlScope';
import { DynamicType } from '../types/DynamicType';
import type { InterfaceType } from '../types/InterfaceType';
import type { ObjectType } from '../types/ObjectType';
import type { AstNode, Expression, Statement } from '../parser/AstNode';
import { AstNodeKind } from '../parser/AstNode';
import type { TypePropertyReferenceType, ReferenceType } from '../types/ReferenceType';
import type { EnumMemberType, EnumType } from '../types/EnumType';
import type { NamespaceType } from '../types/NameSpaceType';
import type { UnionType } from '../types/UnionType';
import type { UninitializedType } from '../types/UninitializedType';
import type { ArrayType } from '../types/ArrayType';
import type { InheritableType } from '../types/InheritableType';

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
    return element?.kind === AstNodeKind.AssignmentStatement;
}
export function isBlock(element: AstNode | undefined): element is Block {
    return element?.constructor?.name === 'Block';
}
export function isExpressionStatement(element: AstNode | undefined): element is ExpressionStatement {
    return element?.kind === AstNodeKind.ExpressionStatement;
}
export function isCommentStatement(element: AstNode | undefined): element is CommentStatement {
    return element?.kind === AstNodeKind.CommentStatement;
}
export function isExitForStatement(element: AstNode | undefined): element is ExitForStatement {
    return element?.kind === AstNodeKind.ExitForStatement;
}
export function isExitWhileStatement(element: AstNode | undefined): element is ExitWhileStatement {
    return element?.kind === AstNodeKind.ExitWhileStatement;
}
export function isFunctionStatement(element: AstNode | undefined): element is FunctionStatement {
    return element?.kind === AstNodeKind.FunctionStatement;
}
export function isIfStatement(element: AstNode | undefined): element is IfStatement {
    return element?.kind === AstNodeKind.IfStatement;
}
export function isIncrementStatement(element: AstNode | undefined): element is IncrementStatement {
    return element?.kind === AstNodeKind.IncrementStatement;
}
export function isPrintStatement(element: AstNode | undefined): element is PrintStatement {
    return element?.kind === AstNodeKind.PrintStatement;
}
export function isGotoStatement(element: AstNode | undefined): element is GotoStatement {
    return element?.kind === AstNodeKind.GotoStatement;
}
export function isLabelStatement(element: AstNode | undefined): element is LabelStatement {
    return element?.kind === AstNodeKind.LabelStatement;
}
export function isReturnStatement(element: AstNode | undefined): element is ReturnStatement {
    return element?.kind === AstNodeKind.ReturnStatement;
}
export function isEndStatement(element: AstNode | undefined): element is EndStatement {
    return element?.kind === AstNodeKind.EndStatement;
}
export function isStopStatement(element: AstNode | undefined): element is StopStatement {
    return element?.kind === AstNodeKind.StopStatement;
}
export function isForStatement(element: AstNode | undefined): element is ForStatement {
    return element?.kind === AstNodeKind.ForStatement;
}
export function isForEachStatement(element: AstNode | undefined): element is ForEachStatement {
    return element?.kind === AstNodeKind.ForEachStatement;
}
export function isWhileStatement(element: AstNode | undefined): element is WhileStatement {
    return element?.kind === AstNodeKind.WhileStatement;
}
export function isDottedSetStatement(element: AstNode | undefined): element is DottedSetStatement {
    return element?.kind === AstNodeKind.DottedSetStatement;
}
export function isIndexedSetStatement(element: AstNode | undefined): element is IndexedSetStatement {
    return element?.kind === AstNodeKind.IndexedSetStatement;
}
export function isLibraryStatement(element: AstNode | undefined): element is LibraryStatement {
    return element?.kind === AstNodeKind.LibraryStatement;
}
export function isNamespaceStatement(element: AstNode | undefined): element is NamespaceStatement {
    return element?.kind === AstNodeKind.NamespaceStatement;
}
export function isClassStatement(element: AstNode | undefined): element is ClassStatement {
    return element?.kind === AstNodeKind.ClassStatement;
}
export function isImportStatement(element: AstNode | undefined): element is ImportStatement {
    return element?.kind === AstNodeKind.ImportStatement;
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
    return element?.kind === AstNodeKind.InterfaceStatement;
}
export function isInterfaceMethodStatement(element: AstNode | undefined): element is InterfaceMethodStatement {
    return element?.kind === AstNodeKind.InterfaceMethodStatement;
}
export function isInterfaceFieldStatement(element: AstNode | undefined): element is InterfaceFieldStatement {
    return element?.kind === AstNodeKind.InterfaceFieldStatement;
}
export function isEnumStatement(element: AstNode | undefined): element is EnumStatement {
    return element?.kind === AstNodeKind.EnumStatement;
}
export function isEnumMemberStatement(element: AstNode | undefined): element is EnumMemberStatement {
    return element?.kind === AstNodeKind.EnumMemberStatement;
}
export function isConstStatement(element: AstNode | undefined): element is ConstStatement {
    return element?.kind === AstNodeKind.ConstStatement;
}
export function isContinueStatement(element: AstNode | undefined): element is ContinueStatement {
    return element?.kind === AstNodeKind.ContinueStatement;
}
export function isTryCatchStatement(element: AstNode | undefined): element is TryCatchStatement {
    return element?.kind === AstNodeKind.TryCatchStatement;
}
export function isCatchStatement(element: AstNode | undefined): element is CatchStatement {
    return element?.kind === AstNodeKind.CatchStatement;
}
export function isThrowStatement(element: AstNode | undefined): element is ThrowStatement {
    return element?.kind === AstNodeKind.ThrowStatement;
}

// Expressions reflection
/**
 * Determine if the variable is a descendent of the Expression base class.
 * Due to performance restrictions, this expects all statements to directly extend Expression,
 * so it only checks the immediate parent's class name. For example:
 * this will work for StringLiteralExpression -> Expression,
 * but will not work CustomStringLiteralExpression -> StringLiteralExpression -> Expression
 */
export function isExpression(element: AstNode | undefined): element is Expression {
    // eslint-disable-next-line no-bitwise
    return !!(element && element.visitMode & InternalWalkMode.visitExpressions);
}

export function isBinaryExpression(element: AstNode | undefined): element is BinaryExpression {
    return element?.kind === AstNodeKind.BinaryExpression;
}
export function isCallExpression(element: AstNode | undefined): element is CallExpression {
    return element?.kind === AstNodeKind.CallExpression;
}
export function isFunctionExpression(element: AstNode | undefined): element is FunctionExpression {
    return element?.kind === AstNodeKind.FunctionExpression;
}
export function isDottedGetExpression(element: AstNode | undefined): element is DottedGetExpression {
    return element?.kind === AstNodeKind.DottedGetExpression;
}
export function isXmlAttributeGetExpression(element: AstNode | undefined): element is XmlAttributeGetExpression {
    return element?.kind === AstNodeKind.XmlAttributeGetExpression;
}
export function isIndexedGetExpression(element: AstNode | undefined): element is IndexedGetExpression {
    return element?.kind === AstNodeKind.IndexedGetExpression;
}
export function isGroupingExpression(element: AstNode | undefined): element is GroupingExpression {
    return element?.kind === AstNodeKind.GroupingExpression;
}
export function isLiteralExpression(element: AstNode | undefined): element is LiteralExpression {
    return element?.kind === AstNodeKind.LiteralExpression;
}
export function isEscapedCharCodeLiteralExpression(element: AstNode | undefined): element is EscapedCharCodeLiteralExpression {
    return element?.kind === AstNodeKind.EscapedCharCodeLiteralExpression;
}
export function isArrayLiteralExpression(element: AstNode | undefined): element is ArrayLiteralExpression {
    return element?.kind === AstNodeKind.ArrayLiteralExpression;
}
export function isAALiteralExpression(element: AstNode | undefined): element is AALiteralExpression {
    return element?.kind === AstNodeKind.AALiteralExpression;
}
export function isAAMemberExpression(element: AstNode | undefined): element is AAMemberExpression {
    return element?.kind === AstNodeKind.AAMemberExpression;
}
export function isUnaryExpression(element: AstNode | undefined): element is UnaryExpression {
    return element?.kind === AstNodeKind.UnaryExpression;
}
export function isVariableExpression(element: AstNode | undefined): element is VariableExpression {
    return element?.kind === AstNodeKind.VariableExpression;
}
export function isSourceLiteralExpression(element: AstNode | undefined): element is SourceLiteralExpression {
    return element?.kind === AstNodeKind.SourceLiteralExpression;
}
export function isNewExpression(element: AstNode | undefined): element is NewExpression {
    return element?.kind === AstNodeKind.NewExpression;
}
export function isCallfuncExpression(element: AstNode | undefined): element is CallfuncExpression {
    return element?.kind === AstNodeKind.CallfuncExpression;
}
export function isTemplateStringQuasiExpression(element: AstNode | undefined): element is TemplateStringQuasiExpression {
    return element?.kind === AstNodeKind.TemplateStringQuasiExpression;
}
export function isTemplateStringExpression(element: AstNode | undefined): element is TemplateStringExpression {
    return element?.kind === AstNodeKind.TemplateStringExpression;
}
export function isTaggedTemplateStringExpression(element: AstNode | undefined): element is TaggedTemplateStringExpression {
    return element?.kind === AstNodeKind.TaggedTemplateStringExpression;
}
export function isFunctionParameterExpression(element: AstNode | undefined): element is FunctionParameterExpression {
    return element?.kind === AstNodeKind.FunctionParameterExpression;
}
export function isAnnotationExpression(element: AstNode | undefined): element is AnnotationExpression {
    return element?.kind === AstNodeKind.AnnotationExpression;
}
export function isTypedefProvider(element: any): element is TypedefProvider {
    return 'getTypedef' in element;
}
export function isTypeExpression(element: any): element is TypeExpression {
    return element?.kind === AstNodeKind.TypeExpression;
}
export function isTypeCastExpression(element: any): element is TypeCastExpression {
    return element?.kind === AstNodeKind.TypeCastExpression;
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
export function isClassType(e: any): e is ClassType {
    return e?.constructor.name === ClassType.name;
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
export function isReferenceType(e: any): e is ReferenceType {
    return e?.__reflection?.name === 'ReferenceType';
}
export function isEnumType(e: any): e is EnumType {
    return e?.constructor.name === 'EnumType';
}
export function isEnumMemberType(e: any): e is EnumMemberType {
    return e?.constructor.name === 'EnumMemberType';
}
export function isTypePropertyReferenceType(e: any): e is TypePropertyReferenceType {
    return e?.__reflection?.name === 'TypePropertyReferenceType';
}
export function isNamespaceType(e: any): e is NamespaceType {
    return e?.constructor.name === 'NamespaceType';
}
export function isUnionType(e: any): e is UnionType {
    return e?.constructor.name === 'UnionType';
}
export function isUninitializedType(e: any): e is UninitializedType {
    return e?.constructor.name === 'UninitializedType';
}
export function isArrayType(e: any): e is ArrayType {
    return e?.constructor.name === 'ArrayType';
}

export function isInheritableType(target): target is InheritableType {
    return isClassType(target) || isInterfaceType(target);
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
    return isLiteralExpression(e) && isInvalidType(e.getType());
}
export function isLiteralBoolean(e: any): e is LiteralExpression & { type: BooleanType } {
    return isLiteralExpression(e) && isBooleanType(e.getType());
}
export function isLiteralString(e: any): e is LiteralExpression & { type: StringType } {
    return isLiteralExpression(e) && isStringType(e.getType());
}
export function isLiteralNumber(e: any): e is LiteralExpression & { type: IntegerType | LongIntegerType | FloatType | DoubleType } {
    return isLiteralExpression(e) && isNumberType(e.getType());
}
