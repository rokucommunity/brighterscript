import type { Position } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { BsDiagnostic } from './interfaces';
import type { TokenKind } from './lexer/TokenKind';

/**
 * An object that keeps track of all possible error messages.
 */
export let DiagnosticMessages = {
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    genericParserMessage: (message: string) => ({
        message: message,
        code: 1000,
        severity: DiagnosticSeverity.Error
    }),
    /**
     *
     * @param name for local vars, it's the var name. for namespaced parts, it's the specific part that's unknown (`alpha.beta.charlie` would result in "cannot find name 'charlie')
     * @param fullName if a namespaced name, this is the full name `alpha.beta.charlie`, otherwise it's the same as `name`
     */
    cannotFindName: (name: string, fullName?: string) => ({
        message: `Cannot find name '${name}'`,
        code: 1001,
        data: {
            name: name,
            fullName: fullName ?? name
        },
        severity: DiagnosticSeverity.Error
    }),
    mismatchArgumentCount: (expectedCount: number | string, actualCount: number) => ({
        message: `Expected ${expectedCount} arguments, but got ${actualCount}.`,
        code: 1002,
        severity: DiagnosticSeverity.Error
    }),
    duplicateFunctionImplementation: (functionName: string, scopeName: string) => ({
        message: `Duplicate function implementation for '${functionName}' when this file is included in scope '${scopeName}'.`,
        code: 1003,
        severity: DiagnosticSeverity.Error
    }),
    referencedFileDoesNotExist: () => ({
        message: `Referenced file does not exist.`,
        code: 1004,
        severity: DiagnosticSeverity.Error
    }),
    xmlComponentMissingComponentDeclaration: () => ({
        message: `Missing a component declaration.`,
        code: 1005,
        severity: DiagnosticSeverity.Error
    }),
    xmlComponentMissingNameAttribute: () => ({
        message: `Component must have a name attribute.`,
        code: 1006,
        severity: DiagnosticSeverity.Error
    }),
    xmlComponentMissingExtendsAttribute: () => ({
        message: `Component is mising "extends" attribute and will automatically extend "Group" by default`,
        code: 1007,
        severity: DiagnosticSeverity.Warning
    }),
    xmlGenericParseError: (message: string) => ({
        //generic catchall xml parse error
        message: message,
        code: 1008,
        severity: DiagnosticSeverity.Error
    }),
    unnecessaryScriptImportInChildFromParent: (parentComponentName: string) => ({
        message: `Unnecessary script import: Script is already imported in ancestor component '${parentComponentName}'.`,
        code: 1009,
        severity: DiagnosticSeverity.Warning
    }),
    overridesAncestorFunction: (callableName: string, currentScopeName: string, parentFilePath: string, parentScopeName: string) => ({
        message: `Function '${callableName}' included in '${currentScopeName}' overrides function in '${parentFilePath}' included in '${parentScopeName}'.`,
        code: 1010,
        severity: DiagnosticSeverity.Hint
    }),
    localVarFunctionShadowsParentFunction: (scopeName: 'stdlib' | 'scope') => ({
        message: `Local variable function has same name as ${scopeName} function and will never be called.`,
        code: 1011,
        severity: DiagnosticSeverity.Warning
    }),
    scriptImportCaseMismatch: (correctFilePath: string) => ({
        message: `Script import path does not match casing of actual file path '${correctFilePath}'.`,
        code: 1012,
        severity: DiagnosticSeverity.Warning
    }),
    fileNotReferencedByAnyOtherFile: () => ({
        message: `This file is not referenced by any other file in the project.`,
        code: 1013,
        severity: DiagnosticSeverity.Warning
    }),
    unknownDiagnosticCode: (theUnknownCode: number) => ({
        message: `Unknown diagnostic code ${theUnknownCode}`,
        code: 1014,
        severity: DiagnosticSeverity.Warning
    }),
    scriptSrcCannotBeEmpty: () => ({
        message: `Script import cannot be empty or whitespace`,
        code: 1015,
        severity: DiagnosticSeverity.Error
    }),
    expectedIdentifierAfterKeyword: (keywordText: string) => ({
        message: `Expected identifier after '${keywordText}' keyword`,
        code: 1016,
        severity: DiagnosticSeverity.Error
    }),
    missingCallableKeyword: () => ({
        message: `Expected 'function' or 'sub' to preceed identifier`,
        code: 1017,
        severity: DiagnosticSeverity.Error
    }),
    expectedValidTypeToFollowAsKeyword: () => ({
        message: `Expected valid type to follow 'as' keyword`,
        code: 1018,
        severity: DiagnosticSeverity.Error
    }),
    bsFeatureNotSupportedInBrsFiles: (featureName) => ({
        message: `BrighterScript feature '${featureName}' is not supported in standard BrightScript files`,
        code: 1019,
        severity: DiagnosticSeverity.Error
    }),
    brsConfigJsonIsDeprecated: () => ({
        message: `'brsconfig.json' is deprecated. Please rename to 'bsconfig.json'`,
        code: 1020,
        severity: DiagnosticSeverity.Warning
    }),
    bsConfigJsonHasSyntaxErrors: (message: string) => ({
        message: `Encountered syntax errors in bsconfig.json: ${message}`,
        code: 1021,
        severity: DiagnosticSeverity.Error
    }),
    namespacedClassCannotShareNamewithNonNamespacedClass: (nonNamespacedClassName: string) => ({
        message: `Namespaced class cannot have the same name as a non-namespaced class '${nonNamespacedClassName}'`,
        code: 1022,
        severity: DiagnosticSeverity.Error
    }),
    cannotUseOverrideKeywordOnConstructorFunction: () => ({
        message: 'Override keyword is not allowed on class constructor method',
        code: 1023,
        severity: DiagnosticSeverity.Error
    }),
    importStatementMustBeDeclaredAtTopOfFile: () => ({
        message: `'import' statement must be declared at the top of the file`,
        code: 1024,
        severity: DiagnosticSeverity.Error
    }),
    methodDoesNotExistOnType: (methodName: string, className: string) => ({
        message: `Method '${methodName}' does not exist on type '${className}'`,
        code: 1025,
        severity: DiagnosticSeverity.Error
    }),
    duplicateIdentifier: (memberName: string) => ({
        message: `Duplicate identifier '${memberName}'`,
        code: 1026,
        severity: DiagnosticSeverity.Error
    }),
    missingOverrideKeyword: (ancestorClassName: string) => ({
        message: `Method has no override keyword but is declared in ancestor class '${ancestorClassName}'`,
        code: 1027,
        severity: DiagnosticSeverity.Error
    }),
    duplicateClassDeclaration: (scopeName: string, className: string) => ({
        message: `Scope '${scopeName}' already contains a class with name '${className}'`,
        code: 1028,
        severity: DiagnosticSeverity.Error
    }),
    classCouldNotBeFound: (className: string, scopeName: string) => ({
        message: `Class '${className}' could not be found when this file is included in scope '${scopeName}'`,
        code: 1029,
        severity: DiagnosticSeverity.Error,
        data: {
            className: className
        }
    }),
    expectedClassFieldIdentifier: () => ({
        message: `Expected identifier in class body`,
        code: 1030,
        severity: DiagnosticSeverity.Error
    }),
    expressionIsNotConstructable: (expressionType: string) => ({
        message: `Cannot use the 'new' keyword here because '${expressionType}' is not a constructable type`,
        code: 1031,
        severity: DiagnosticSeverity.Error
    }),
    expectedKeyword: (kind: TokenKind) => ({
        message: `Expected '${kind}' keyword`,
        code: 1032,
        severity: DiagnosticSeverity.Error
    }),
    expectedLeftParenAfterCallable: (callableType: string) => ({
        message: `Expected '(' after ${callableType}`,
        code: 1033,
        severity: DiagnosticSeverity.Error
    }),
    expectedNameAfterCallableKeyword: (callableType: string) => ({
        message: `Expected ${callableType} name after '${callableType}' keyword`,
        code: 1034,
        severity: DiagnosticSeverity.Error
    }),
    expectedLeftParenAfterCallableName: (callableType: string) => ({
        message: `Expected '(' after ${callableType} name`,
        code: 1035,
        severity: DiagnosticSeverity.Error
    }),
    tooManyCallableParameters: (actual: number, max: number) => ({
        message: `Cannot have more than ${max} parameters but found ${actual})`,
        code: 1036,
        severity: DiagnosticSeverity.Error
    }),
    invalidFunctionReturnType: (typeText: string) => ({
        message: `Function return type '${typeText}' is invalid`,
        code: 1037,
        severity: DiagnosticSeverity.Error
    }),
    requiredParameterMayNotFollowOptionalParameter: (parameterName: string) => ({
        message: `Required parameter '${parameterName}' must be declared before any optional parameters`,
        code: 1038,
        severity: DiagnosticSeverity.Error
    }),
    expectedNewlineOrColon: () => ({
        message: `Expected newline or ':' at the end of a statement`,
        code: 1039,
        severity: DiagnosticSeverity.Error
    }),
    functionNameCannotEndWithTypeDesignator: (callableType: string, name: string, designator: string) => ({
        message: `${callableType} name '${name}' cannot end with type designator '${designator}'`,
        code: 1040,
        severity: DiagnosticSeverity.Error
    }),
    callableBlockMissingEndKeyword: (callableType: string) => ({
        message: `Expected 'end ${callableType}' to terminate ${callableType} block`,
        code: 1041,
        severity: DiagnosticSeverity.Error
    }),
    mismatchedEndCallableKeyword: (expectedCallableType: string, actualCallableType: string) => ({
        message: `Expected 'end ${expectedCallableType}' to terminate ${expectedCallableType} block but found 'end ${actualCallableType}' instead.`,
        code: 1042,
        severity: DiagnosticSeverity.Error
    }),
    expectedParameterNameButFound: (text: string) => ({
        message: `Expected parameter name, but found '${text ?? ''}'`,
        code: 1043,
        severity: DiagnosticSeverity.Error
    }),
    functionParameterTypeIsInvalid: (parameterName: string, typeText: string) => ({
        message: `Function parameter '${parameterName}' is of invalid type '${typeText}'`,
        code: 1044,
        severity: DiagnosticSeverity.Error
    }),
    cannotUseReservedWordAsIdentifier: (name: string) => ({
        message: `Cannot use reserved word '${name}' as an identifier`,
        code: 1045,
        severity: DiagnosticSeverity.Error
    }),
    expectedOperatorAfterIdentifier: (operators: TokenKind[], name: string) => {
        operators = Array.isArray(operators) ? operators : [];
        return {
            message: `Expected operator ('${operators.join(`', '`)}') after idenfifier '${name}'`,
            code: 1046,
            severity: DiagnosticSeverity.Error
        };
    },
    expectedInlineIfStatement: () => ({
        message: `If/else statement within an inline if should be also inline`,
        code: 1047,
        severity: DiagnosticSeverity.Error
    }),
    expectedFinalNewline: () => ({
        message: `Expected newline at the end of an inline if statement`,
        code: 1048,
        severity: DiagnosticSeverity.Error
    }),
    couldNotFindMatchingEndKeyword: (keyword: string) => ({
        message: `Could not find matching 'end ${keyword}'`,
        code: 1049,
        severity: DiagnosticSeverity.Error
    }),
    expectedCatchBlockInTryCatch: () => ({
        message: `Expected 'catch' block in 'try' statement`,
        code: 1050,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndForOrNextToTerminateForLoop: () => ({
        message: `Expected 'end for' or 'next' to terminate 'for' loop`,
        code: 1051,
        severity: DiagnosticSeverity.Error
    }),
    expectedInAfterForEach: (name: string) => ({
        message: `Expected 'in' after 'for each ${name}'`,
        code: 1052,
        severity: DiagnosticSeverity.Error
    }),
    expectedExpressionAfterForEachIn: () => ({
        message: `Expected expression after 'in' keyword from 'for each' statement`,
        code: 1053,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedColonBeforeIfStatement: () => ({
        message: `Colon before 'if' statement is not allowed`,
        code: 1054,
        severity: DiagnosticSeverity.Error
    }),
    expectedStringLiteralAfterKeyword: (keyword: string) => ({
        message: `Missing string literal after '${keyword}' keyword`,
        code: 1055,
        severity: DiagnosticSeverity.Error
    }),
    keywordMustBeDeclaredAtRootLevel: (keyword: string) => ({
        message: `${keyword} must be declared at the root level`,
        code: 1056,
        severity: DiagnosticSeverity.Error
    }),
    libraryStatementMustBeDeclaredAtTopOfFile: () => ({
        message: `'library' statement must be declared at the top of the file`,
        code: 1057,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndIfElseIfOrElseToTerminateThenBlock: () => ({
        message: `Expected 'end if', 'else if', or 'else' to terminate 'then' block`,
        code: 1058,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndTryToTerminateTryCatch: () => ({
        message: `Expected 'end try' to terminate 'try-catch' statement`,
        code: 1059,
        severity: DiagnosticSeverity.Error
    }),
    expectedEndIfToCloseIfStatement: (startingPosition: Position) => ({
        message: `Expected 'end if' to close 'if' statement started at ${startingPosition?.line + 1}:${startingPosition?.character + 1}`,
        code: 1060,
        severity: DiagnosticSeverity.Error
    }),
    expectedStatementToFollowConditionalCondition: (conditionType: string) => ({
        message: `Expected a statement to follow '${conditionType?.toLowerCase()} ...condition... then'`,
        code: 1061,
        severity: DiagnosticSeverity.Error
    }),
    expectedStatementToFollowElse: () => ({
        message: `Expected a statement to follow 'else'`,
        code: 1062,
        severity: DiagnosticSeverity.Error
    }),
    consecutiveIncrementDecrementOperatorsAreNotAllowed: () => ({
        message: `Consecutive increment/decrement operators are not allowed`,
        code: 1063,
        severity: DiagnosticSeverity.Error
    }),
    incrementDecrementOperatorsAreNotAllowedAsResultOfFunctionCall: () => ({
        message: ``,
        code: 1064,
        severity: DiagnosticSeverity.Error
    }),
    xmlUnexpectedTag: (tagName: string) => ({
        message: `Unexpected tag '${tagName}'`,
        code: 1065,
        severity: DiagnosticSeverity.Error
    }),
    expectedStatementOrFunctionCallButReceivedExpression: () => ({
        message: `Expected statement or function call but instead found expression`,
        code: 1066,
        severity: DiagnosticSeverity.Error
    }),
    xmlFunctionNotFound: (name: string) => ({
        message: `Cannot find function with name '${name}' in component scope`,
        code: 1067,
        severity: DiagnosticSeverity.Error
    }),
    xmlInvalidFieldType: (name: string) => ({
        message: `Invalid field type ${name}`,
        code: 1068,
        severity: DiagnosticSeverity.Error
    }),
    xmlUnexpectedChildren: (tagName: string) => ({
        message: `Tag '${tagName}' should not have children`,
        code: 1069,
        severity: DiagnosticSeverity.Error
    }),
    xmlTagMissingAttribute: (tagName: string, attrName: string) => ({
        message: `Tag '${tagName}' must have a '${attrName}' attribute`,
        code: 1070,
        severity: DiagnosticSeverity.Error
    }),
    expectedLabelIdentifierAfterGotoKeyword: () => ({
        message: `Expected label identifier after 'goto' keyword`,
        code: 1071,
        severity: DiagnosticSeverity.Error
    }),
    expectedRightSquareBraceAfterArrayOrObjectIndex: () => ({
        message: `Expected ']' after array or object index`,
        code: 1072,
        severity: DiagnosticSeverity.Error
    }),
    expectedPropertyNameAfterPeriod: () => ({
        message: `Expected property name after '.'`,
        code: 1073,
        severity: DiagnosticSeverity.Error
    }),
    tooManyCallableArguments: (actual: number, max: number) => ({
        message: `Cannot have more than ${max} arguments but found ${actual}`,
        code: 1074,
        severity: DiagnosticSeverity.Error
    }),
    expectedRightParenAfterFunctionCallArguments: () => ({
        message: `Expected ')' after function call arguments`,
        code: 1075,
        severity: DiagnosticSeverity.Error
    }),
    unmatchedLeftParenAfterExpression: () => ({
        message: `Unmatched '(': expected ')' after expression`,
        code: 1076,
        severity: DiagnosticSeverity.Error
    }),
    unmatchedLeftSquareBraceAfterArrayLiteral: () => ({
        message: `Unmatched '[': expected ']' after array literal`,
        code: 1077,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedAAKey: () => ({
        message: `Expected identifier or string as associative array key`,
        code: 1078,
        severity: DiagnosticSeverity.Error
    }),
    expectedColonBetweenAAKeyAndvalue: () => ({
        message: `Expected ':' between associative array key and value`,
        code: 1079,
        severity: DiagnosticSeverity.Error
    }),
    unmatchedLeftCurlyAfterAALiteral: () => ({
        message: `Unmatched '{': expected '}' after associative array literal`,
        code: 1080,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedToken: (text: string) => ({
        message: `Unexpected token '${text}'`,
        code: 1081,
        severity: DiagnosticSeverity.Error
    }),
    /**
     * Used in the lexer anytime we encounter an unsupported character
     */
    unexpectedCharacter: (text: string) => ({
        message: `Unexpected character '${text}' (char code ${text?.charCodeAt(0)})`,
        code: 1082,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedStringAtEndOfLine: () => ({
        message: `Unterminated string at end of line`,
        code: 1083,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedStringAtEndOfFile: () => ({
        message: `Unterminated string at end of file`,
        code: 1084,
        severity: DiagnosticSeverity.Error
    }),
    fractionalHexLiteralsAreNotSupported: () => ({
        message: `Fractional hex literals are not supported`,
        code: 1085,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedConditionalCompilationString: () => ({
        message: `Unexpected conditional-compilation string`,
        code: 1086,
        severity: DiagnosticSeverity.Error
    }),
    duplicateConstDeclaration: (name: string) => ({
        message: `Attempting to redeclare #const with name '${name}'`,
        code: 1087,
        severity: DiagnosticSeverity.Error
    }),
    constAliasDoesNotExist: (name: string) => ({
        message: `Attempting to create #const alias of '${name}', but no such #const exists`,
        code: 1088,
        severity: DiagnosticSeverity.Error
    }),
    invalidHashConstValue: () => ({
        message: '#const declarations can only have values of `true`, `false`, or other #const names',
        code: 1089,
        severity: DiagnosticSeverity.Error
    }),
    referencedConstDoesNotExist: () => ({
        message: `Referenced #const does not exist`,
        code: 1090,
        severity: DiagnosticSeverity.Error
    }),
    invalidHashIfValue: () => ({
        message: `#if conditionals can only be 'true', 'false', or other #const names`,
        code: 1091,
        severity: DiagnosticSeverity.Error
    }),
    hashError: (message: string) => ({
        message: `#error ${message}`,
        code: 1092,
        severity: DiagnosticSeverity.Error
    }),
    expectedEqualAfterConstName: () => ({
        message: `Expected '=' after #const`,
        code: 1093,
        severity: DiagnosticSeverity.Error
    }),
    expectedHashElseIfToCloseHashIf: (startingLine: number) => ({
        message: `Expected '#else if' to close '#if' conditional compilation statement starting on line ${startingLine}`,
        code: 1094,
        severity: DiagnosticSeverity.Error
    }),
    constNameCannotBeReservedWord: () => ({
        message: `#const name cannot be a reserved word`,
        code: 1095,
        severity: DiagnosticSeverity.Error
    }),
    expectedIdentifier: () => ({
        message: `Expected identifier`,
        code: 1096,
        severity: DiagnosticSeverity.Error
    }),
    expectedAttributeNameAfterAtSymbol: () => ({
        message: `Expected xml attribute name after '@'`,
        code: 1097,
        severity: DiagnosticSeverity.Error
    }),
    childFieldTypeNotAssignableToBaseProperty: (childTypeName: string, baseTypeName: string, fieldName: string, childFieldType: string, parentFieldType: string) => ({
        message: `Field '${fieldName}' in class '${childTypeName}' is not assignable to the same field in base class '${baseTypeName}'. Type '${childFieldType}' is not assignable to type '${parentFieldType}'.`,
        code: 1098,
        severity: DiagnosticSeverity.Error
    }),
    classChildMemberDifferentMemberTypeThanAncestor: (memberType: string, parentMemberType: string, parentClassName: string) => ({
        message: `Class member is a ${memberType} here but a ${parentMemberType} in ancestor class '${parentClassName}'`,
        code: 1099,
        severity: DiagnosticSeverity.Error
    }),
    classConstructorMissingSuperCall: () => ({
        message: `Missing "super()" call in class constructor method.`,
        code: 1100,
        severity: DiagnosticSeverity.Error
    }),
    classConstructorIllegalUseOfMBeforeSuperCall: () => ({
        message: `Illegal use of "m" before calling "super()"`,
        code: 1101,
        severity: DiagnosticSeverity.Error
    }),
    classFieldCannotBeOverridden: () => ({
        message: `Class field cannot be overridden`,
        code: 1102,
        severity: DiagnosticSeverity.Error
    }),
    unusedAnnotation: () => ({
        message: `This annotation is not attached to any statement`,
        code: 1103,
        severity: DiagnosticSeverity.Error
    }),
    localVarShadowedByScopedFunction: () => ({
        message: `Declaring a local variable with same name as scoped function can result in unexpected behavior`,
        code: 1104,
        severity: DiagnosticSeverity.Error
    }),
    scopeFunctionShadowedByBuiltInFunction: () => ({
        message: `Scope function will not be accessible because it has the same name as a built-in function`,
        code: 1105,
        severity: DiagnosticSeverity.Error
    }),
    localVarSameNameAsClass: (className: string) => ({
        message: `Local variable has same name as class '${className}'`,
        code: 1106,
        severity: DiagnosticSeverity.Error
    }),
    unnecessaryCodebehindScriptImport: () => ({
        message: `This import is unnecessary because compiler option 'autoImportComponentScript' is enabled`,
        code: 1107,
        severity: DiagnosticSeverity.Warning
    }),
    expectedOpenParenToFollowCallfuncIdentifier: () => ({
        message: `Expected '(' to follow callfunc identifier`,
        code: 1108,
        severity: DiagnosticSeverity.Error
    }),
    expectedToken: (tokenKind: string) => ({
        message: `Expected '${tokenKind}'`,
        code: 1109,
        severity: DiagnosticSeverity.Error
    }),
    parameterMayNotHaveSameNameAsNamespace: (paramName: string) => ({
        message: `Parameter '${paramName}' may not have the same name as namespace`,
        code: 1110,
        severity: DiagnosticSeverity.Error
    }),
    variableMayNotHaveSameNameAsNamespace: (variableName: string) => ({
        message: `Variable '${variableName}' may not have the same name as namespace`,
        code: 1111,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedTemplateStringAtEndOfFile: () => ({
        message: `Unterminated template string at end of file`,
        code: 1113,
        severity: DiagnosticSeverity.Error
    }),
    unterminatedTemplateExpression: () => ({
        message: `Unterminated template string expression. '\${' must be followed by expression, then '}'`,
        code: 1114,
        severity: DiagnosticSeverity.Error
    }),
    duplicateComponentName: (componentName: string) => ({
        message: `There are multiple components with the name '${componentName}'`,
        code: 1115,
        severity: DiagnosticSeverity.Error
    }),
    functionCannotHaveSameNameAsClass: (className: string) => ({
        message: `Function has same name as class '${className}'`,
        code: 1116,
        severity: DiagnosticSeverity.Error
    }),
    missingExceptionVarToFollowCatch: () => ({
        message: `Missing exception variable after 'catch' keyword`,
        code: 1117,
        severity: DiagnosticSeverity.Error
    }),
    missingExceptionExpressionAfterThrowKeyword: () => ({
        message: `Missing exception expression after 'throw' keyword`,
        code: 1118,
        severity: DiagnosticSeverity.Error
    }),
    missingLeftSquareBracketAfterDimIdentifier: () => ({
        message: `Missing left square bracket after 'dim' identifier`,
        code: 1119,
        severity: DiagnosticSeverity.Error
    }),
    missingRightSquareBracketAfterDimIdentifier: () => ({
        message: `Missing right square bracket after 'dim' identifier`,
        code: 1120,
        severity: DiagnosticSeverity.Error
    }),
    missingExpressionsInDimStatement: () => ({
        message: `Missing expression(s) in 'dim' statement`,
        code: 1121,
        severity: DiagnosticSeverity.Error
    }),
    mismatchedOverriddenMemberVisibility: (childClassName: string, memberName: string, childAccessModifier: string, ancestorAccessModifier: string, ancestorClassName: string) => ({
        message: `Access modifier mismatch: '${memberName}' is ${childAccessModifier} in type '${childClassName}' but is ${ancestorAccessModifier} in base type '${ancestorClassName}'.`,
        code: 1122,
        severity: DiagnosticSeverity.Error
    }),
    cannotFindType: (typeName: string) => ({
        message: `Cannot find type with name '${typeName}'`,
        code: 1123,
        severity: DiagnosticSeverity.Error
    }),
    enumValueMustBeType: (expectedType: string) => ({
        message: `Enum value must be type '${expectedType}'`,
        code: 1124,
        severity: DiagnosticSeverity.Error
    }),
    enumValueIsRequired: (expectedType: string) => ({
        message: `Value is required for ${expectedType} enum`,
        code: 1125,
        severity: DiagnosticSeverity.Error
    }),
    unknownEnumValue: (name: string, enumName: string) => ({
        message: `Property '${name}' does not exist on enum '${enumName}'`,
        code: 1126,
        severity: DiagnosticSeverity.Error
    }),
    duplicateEnumDeclaration: (scopeName: string, enumName: string) => ({
        message: `Scope '${scopeName}' already contains an enum with name '${enumName}'`,
        code: 1127,
        severity: DiagnosticSeverity.Error
    }),
    unknownRoSGNode: (nodeName: string) => ({
        message: `Unknown roSGNode '${nodeName}'`,
        code: 1128,
        severity: DiagnosticSeverity.Error
    }),
    unknownBrightScriptComponent: (componentName: string) => ({
        message: `Unknown BrightScript component '${componentName}'`,
        code: 1129,
        severity: DiagnosticSeverity.Error
    }),
    mismatchCreateObjectArgumentCount: (componentName: string, allowedArgCounts: number[], actualCount: number) => {
        const argCountArray = (allowedArgCounts || [1]).sort().filter((value, index, self) => self.indexOf(value) === index);
        return {
            message: `For ${componentName}, expected ${argCountArray.map(c => c.toString()).join(' or ')} total arguments, but got ${actualCount}.`,
            code: 1130,
            severity: DiagnosticSeverity.Error
        };
    },
    deprecatedBrightScriptComponent: (componentName: string, deprecatedDescription?: string) => ({
        message: `${componentName} has been deprecated${deprecatedDescription ? ': ' + deprecatedDescription : ''}`,
        code: 1131,
        severity: DiagnosticSeverity.Error
    }),
    circularReferenceDetected: (items: string[], scopeName: string) => ({
        message: `Circular reference detected between ${Array.isArray(items) ? items.join(' -> ') : ''} in scope '${scopeName}'`,
        code: 1132,
        severity: DiagnosticSeverity.Error
    }),
    unexpectedStatementOutsideFunction: () => ({
        message: `Unexpected statement found outside of function body`,
        code: 1133,
        severity: DiagnosticSeverity.Error
    }),
    detectedTooDeepFileSource: (numberOfParentDirectories: number) => ({
        message: `Expected directory depth no larger than 7, but found ${numberOfParentDirectories}.`,
        code: 1134,
        severity: DiagnosticSeverity.Error
    })
};

export const DiagnosticCodeMap = {} as Record<keyof (typeof DiagnosticMessages), number>;
export let diagnosticCodes = [] as number[];
for (let key in DiagnosticMessages) {
    diagnosticCodes.push(DiagnosticMessages[key]().code);
    DiagnosticCodeMap[key] = DiagnosticMessages[key]().code;
}

export interface DiagnosticInfo {
    message: string;
    code: number;
    severity: DiagnosticSeverity;
}

/**
 * Provides easy type support for the return value of any DiagnosticMessage function.
 * The second type parameter is optional, but allows plugins to pass in their own
 * DiagnosticMessages-like object in order to get the same type support
 */
export type DiagnosticMessageType<K extends keyof D, D extends Record<string, (...args: any) => any> = typeof DiagnosticMessages> =
    ReturnType<D[K]> &
    //include the missing properties from BsDiagnostic
    Pick<BsDiagnostic, 'range' | 'file' | 'relatedInformation' | 'tags'>;
