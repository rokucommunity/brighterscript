import type { Body, AssignmentStatement, Block, ExpressionStatement, ExitForStatement, ExitWhileStatement, FunctionStatement, IfStatement, IncrementStatement, PrintStatement, GotoStatement, LabelStatement, ReturnStatement, EndStatement, StopStatement, ForStatement, ForEachStatement, WhileStatement, DottedSetStatement, IndexedSetStatement, LibraryStatement, NamespaceStatement, ImportStatement, ClassStatement, InterfaceFieldStatement, InterfaceMethodStatement, InterfaceStatement, EnumStatement, EnumMemberStatement, TryCatchStatement, CatchStatement, ThrowStatement, MethodStatement, FieldStatement, ConstStatement, ContinueStatement, TypecastStatement, ConditionalCompileStatement, ConditionalCompileConstStatement, ConditionalCompileErrorStatement } from '../parser/Statement';
import type { LiteralExpression, BinaryExpression, CallExpression, FunctionExpression, DottedGetExpression, XmlAttributeGetExpression, IndexedGetExpression, GroupingExpression, EscapedCharCodeLiteralExpression, ArrayLiteralExpression, AALiteralExpression, UnaryExpression, VariableExpression, SourceLiteralExpression, NewExpression, CallfuncExpression, TemplateStringQuasiExpression, TemplateStringExpression, TaggedTemplateStringExpression, AnnotationExpression, FunctionParameterExpression, AAMemberExpression, TypecastExpression, TypeExpression, TypedArrayExpression } from '../parser/Expression';
import type { BrsFile } from '../files/BrsFile';
import type { XmlFile } from '../files/XmlFile';
import type { TypedefProvider } from '../interfaces';
import type { InvalidType } from '../types/InvalidType';
import type { VoidType } from '../types/VoidType';
import { InternalWalkMode } from './visitors';
import type { TypedFunctionType } from '../types/TypedFunctionType';
import type { FunctionType } from '../types/FunctionType';
import type { StringType } from '../types/StringType';
import type { BooleanType } from '../types/BooleanType';
import type { IntegerType } from '../types/IntegerType';
import type { LongIntegerType } from '../types/LongIntegerType';
import type { FloatType } from '../types/FloatType';
import type { DoubleType } from '../types/DoubleType';
import type { ClassType } from '../types/ClassType';
import type { Scope } from '../Scope';
import type { XmlScope } from '../XmlScope';
import type { DynamicType } from '../types/DynamicType';
import type { InterfaceType } from '../types/InterfaceType';
import type { ObjectType } from '../types/ObjectType';
import type { AstNode, Expression, Statement } from '../parser/AstNode';
import type { AssetFile } from '../files/AssetFile';
import { AstNodeKind } from '../parser/AstNode';
import type { TypePropertyReferenceType, ReferenceType, BinaryOperatorReferenceType, ArrayDefaultTypeReferenceType } from '../types/ReferenceType';
import type { EnumMemberType, EnumType } from '../types/EnumType';
import type { UnionType } from '../types/UnionType';
import type { UninitializedType } from '../types/UninitializedType';
import type { ArrayType } from '../types/ArrayType';
import type { InheritableType } from '../types/InheritableType';
import { BscTypeKind } from '../types/BscTypeKind';
import type { NamespaceType } from '../types/NamespaceType';
import type { BaseFunctionType } from '../types/BaseFunctionType';
import type { BscFile } from '../files/BscFile';
import type { ComponentType } from '../types/ComponentType';
import type { AssociativeArrayType } from '../types/AssociativeArrayType';
import { TokenKind } from '../lexer/TokenKind';

// File reflection
export function isBrsFile(file: BscFile | undefined): file is BrsFile {
    return file?.constructor.name === 'BrsFile';
}

export function isXmlFile(file: (BscFile | XmlFile | undefined)): file is XmlFile {
    return file?.constructor.name === 'XmlFile';
}

export function isAssetFile(file: (BscFile | AssetFile | undefined)): file is AssetFile {
    return file?.constructor.name === 'AssetFile';
}

export function isXmlScope(scope: (Scope | undefined)): scope is XmlScope {
    return scope?.constructor.name === 'XmlScope';
}


// Statements reflection

/**
 * Determine if the variablvalue is a descendent of the Statement base class.
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
    return element?.kind === AstNodeKind.MethodStatement;
}
export function isFieldStatement(element: AstNode | undefined): element is FieldStatement {
    return element?.kind === AstNodeKind.FieldStatement;
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
export function isMemberField(element: AstNode | undefined): element is InterfaceFieldStatement | FieldStatement {
    return isFieldStatement(element) || isInterfaceFieldStatement(element);
}
export function isMemberMethod(element: AstNode | undefined): element is InterfaceMethodStatement | MethodStatement {
    return isMethodStatement(element) || isInterfaceMethodStatement(element);
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
export function isTypecastStatement(element: AstNode | undefined): element is TypecastStatement {
    return element?.kind === AstNodeKind.TypecastStatement;
}
export function isConditionalCompileStatement(element: AstNode | undefined): element is ConditionalCompileStatement {
    return element?.kind === AstNodeKind.ConditionalCompileStatement;
}
export function isConditionalCompileConstStatement(element: AstNode | undefined): element is ConditionalCompileConstStatement {
    return element?.kind === AstNodeKind.ConditionalCompileConstStatement;
}
export function isConditionalCompileErrorStatement(element: AstNode | undefined): element is ConditionalCompileErrorStatement {
    return element?.kind === AstNodeKind.ConditionalCompileErrorStatement;
}

// Expressions reflection
/**
 * Determine if the variablvalue is a descendent of the Expression base class.
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
export function isTypecastExpression(element: any): element is TypecastExpression {
    return element?.kind === AstNodeKind.TypecastExpression;
}
export function isTypedArrayExpression(element: any): element is TypedArrayExpression {
    return element?.kind === AstNodeKind.TypedArrayExpression;
}

// BscType reflection
export function isStringType(value: any): value is StringType {
    return value?.kind === BscTypeKind.StringType;
}
export function isTypedFunctionType(value: any): value is TypedFunctionType {
    return value?.kind === BscTypeKind.TypedFunctionType;
}
export function isFunctionType(value: any): value is FunctionType {
    return value?.kind === BscTypeKind.FunctionType;
}
export function isBooleanType(value: any): value is BooleanType {
    return value?.kind === BscTypeKind.BooleanType;
}
export function isIntegerType(value: any): value is IntegerType {
    return value?.kind === BscTypeKind.IntegerType;
}
export function isLongIntegerType(value: any): value is LongIntegerType {
    return value?.kind === BscTypeKind.LongIntegerType;
}
export function isFloatType(value: any): value is FloatType {
    return value?.kind === BscTypeKind.FloatType;
}
export function isDoubleType(value: any): value is DoubleType {
    return value?.kind === BscTypeKind.DoubleType;
}
export function isInvalidType(value: any): value is InvalidType {
    return value?.kind === BscTypeKind.InvalidType;
}
export function isVoidType(value: any): value is VoidType {
    return value?.kind === BscTypeKind.VoidType;
}
export function isClassType(value: any): value is ClassType {
    return value?.kind === BscTypeKind.ClassType;
}
export function isComponentType(value: any): value is ComponentType {
    return value?.kind === BscTypeKind.ComponentType;
}
export function isDynamicType(value: any): value is DynamicType {
    return value?.kind === BscTypeKind.DynamicType;
}
export function isInterfaceType(value: any): value is InterfaceType {
    return value?.kind === BscTypeKind.InterfaceType;
}
export function isObjectType(value: any): value is ObjectType {
    return value?.kind === BscTypeKind.ObjectType;
}
export function isReferenceType(value: any): value is ReferenceType {
    return value?.__reflection?.name === 'ReferenceType';
}
export function isEnumType(value: any): value is EnumType {
    return value?.kind === BscTypeKind.EnumType;
}
export function isEnumMemberType(value: any): value is EnumMemberType {
    return value?.kind === BscTypeKind.EnumMemberType;
}
export function isTypePropertyReferenceType(value: any): value is TypePropertyReferenceType {
    return value?.__reflection?.name === 'TypePropertyReferenceType';
}
export function isBinaryOperatorReferenceType(value: any): value is BinaryOperatorReferenceType {
    return value?.__reflection?.name === 'BinaryOperatorReferenceType';
}
export function isArrayDefaultTypeReferenceType(value: any): value is ArrayDefaultTypeReferenceType {
    return value?.__reflection?.name === 'ArrayDefaultTypeReferenceType';
}
export function isNamespaceType(value: any): value is NamespaceType {
    return value?.kind === BscTypeKind.NamespaceType;
}
export function isUnionType(value: any): value is UnionType {
    return value?.kind === BscTypeKind.UnionType;
}
export function isUninitializedType(value: any): value is UninitializedType {
    return value?.kind === BscTypeKind.UninitializedType;
}
export function isArrayType(value: any): value is ArrayType {
    return value?.kind === BscTypeKind.ArrayType;
}
export function isAssociativeArrayType(value: any): value is AssociativeArrayType {
    return value?.kind === BscTypeKind.AssociativeArrayType;
}
export function isInheritableType(target): target is InheritableType {
    return isClassType(target) || isInterfaceType(target) || isComponentType(target);
}

export function isCallableType(target): target is BaseFunctionType {
    return isFunctionType(target) || isTypedFunctionType(target);
}

export function isAnyReferenceType(target): target is ReferenceType | TypePropertyReferenceType | BinaryOperatorReferenceType | ArrayDefaultTypeReferenceType {
    const name = target?.__reflection?.name;
    return name === 'ReferenceType' || name === 'TypePropertyReferenceType' || name === 'BinaryOperatorReferenceType' || name === 'ArrayDefaultTypeReferenceType';
}

const numberTypeKinds = [
    BscTypeKind.IntegerType,
    BscTypeKind.LongIntegerType,
    BscTypeKind.FloatType,
    BscTypeKind.DoubleType
];
export function isNumberType(value: any): value is IntegerType | LongIntegerType | FloatType | DoubleType {
    return numberTypeKinds.includes(value?.kind);
}

const primitiveTypeKinds = [
    ...numberTypeKinds,
    BscTypeKind.BooleanType,
    BscTypeKind.StringType
];
export function isPrimitiveType(value: any): value is IntegerType | LongIntegerType | FloatType | DoubleType | StringType | BooleanType {
    return primitiveTypeKinds.includes(value?.kind);
}

const nativeTypeKinds = [
    ...primitiveTypeKinds,
    BscTypeKind.DynamicType,
    BscTypeKind.ObjectType,
    BscTypeKind.VoidType,
    BscTypeKind.FunctionType
];
export function isNativeType(value: any): value is IntegerType | LongIntegerType | FloatType | DoubleType | StringType | BooleanType | VoidType | DynamicType | ObjectType | FunctionType {
    return nativeTypeKinds.includes(value?.kind);
}


// Literal reflection

export function isLiteralInvalid(value: any): value is LiteralExpression & { type: InvalidType } {
    return isLiteralExpression(value) && value.tokens.value.kind === TokenKind.Invalid;
}
export function isLiteralBoolean(value: any): value is LiteralExpression & { type: BooleanType } {
    return isLiteralExpression(value) && isBooleanType(value.getType());
}
export function isLiteralString(value: any): value is LiteralExpression & { type: StringType } {
    return isLiteralExpression(value) && isStringType(value.getType());
}
export function isLiteralNumber(value: any): value is LiteralExpression & { type: IntegerType | LongIntegerType | FloatType | DoubleType } {
    return isLiteralExpression(value) && isNumberType(value.getType());
}
export function isLiteralInteger(value: any): value is LiteralExpression & { type: IntegerType } {
    return isLiteralExpression(value) && isIntegerType(value.getType());
}
export function isLiteralLongInteger(value: any): value is LiteralExpression & { type: LongIntegerType } {
    return isLiteralExpression(value) && isLongIntegerType(value.getType());
}
export function isLiteralFloat(value: any): value is LiteralExpression & { type: FloatType } {
    return isLiteralExpression(value) && isFloatType(value.getType());
}
export function isLiteralDouble(value: any): value is LiteralExpression & { type: DoubleType } {
    return isLiteralExpression(value) && isDoubleType(value.getType());
}
