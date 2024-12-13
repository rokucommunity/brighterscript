import type { Position } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { BsDiagnostic, TypeCompatibilityData } from './interfaces';
import { TokenKind } from './lexer/TokenKind';
import util from './util';
import { SymbolTypeFlag } from './SymbolTypeFlag';


export const DiagnosticCodeRegex = /^[a-z](?:[a-z0-9]*(?:-[a-z0-9]+)*)*$/;

/**
 * An object that keeps track of all possible error messages.
 */
export let DiagnosticMessages = {
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    genericParserMessage: (message: string) => ({
        message: message,
        legacyCode: 1000,
        severity: DiagnosticSeverity.Error,
        code: 'generic-parser-message'
    }),
    /**
     *
     * @param name for local vars, it's the var name. for namespaced parts, it's the specific part that's unknown (`alpha.beta.charlie` would result in "cannot find name 'charlie')
     * @param fullName if a namespaced name, this is the full name `alpha.beta.charlie`, otherwise it's the same as `name`
     * @param typeName if 'name' refers to a member, what is the the type it is a member of?
     * @param typeDescriptor defaults to 'type' ... could also be 'namespace', etc.
     */
    cannotFindName: (name: string, fullName?: string, typeName?: string, typeDescriptor = 'type') => ({
        message: `Cannot find name '${name}'${typeName ? ` for ${typeDescriptor} '${typeName}'` : ''}`,
        legacyCode: 1001,
        data: {
            name: name,
            fullName: fullName ?? name,
            typeName: typeName ? typeName : undefined
        },
        severity: DiagnosticSeverity.Error,
        code: 'cannot-find-name'
    }),
    mismatchArgumentCount: (expectedCount: number | string, actualCount: number) => ({
        message: `Expected ${expectedCount} arguments, but got ${actualCount}.`,
        legacyCode: 1002,
        severity: DiagnosticSeverity.Error,
        code: 'incorrect-argument-count'
    }),
    duplicateFunctionImplementation: (functionName: string) => ({
        message: `Duplicate function implementation for '${functionName}'.`,
        legacyCode: 1003,
        severity: DiagnosticSeverity.Error,
        code: 'duplicate-function'
    }),
    referencedFileDoesNotExist: () => ({
        message: `Referenced file does not exist.`,
        legacyCode: 1004,
        severity: DiagnosticSeverity.Error,
        code: 'file-not-found'
    }),
    xmlComponentMissingComponentDeclaration: () => ({
        message: `Missing a component declaration.`,
        legacyCode: 1005,
        severity: DiagnosticSeverity.Error,
        code: 'missing-component-element'
    }),
    xmlComponentMissingNameAttribute: () => ({
        message: `Component must have a name attribute.`,
        legacyCode: 1006,
        severity: DiagnosticSeverity.Error,
        code: 'missing-name-attribute'
    }),
    xmlComponentMissingExtendsAttribute: () => ({
        message: `Component is mising "extends" attribute and will automatically extend "Group" by default`,
        legacyCode: 1007,
        severity: DiagnosticSeverity.Warning,
        code: 'missing-extends-attribute'
    }),
    syntaxError: (message: string) => ({
        //generic catchall xml parse error
        message: message,
        legacyCode: 1008,
        severity: DiagnosticSeverity.Error,
        code: 'syntax-error'
    }),
    unnecessaryScriptImportInChildFromParent: (parentComponentName: string) => ({
        message: `Unnecessary script import: Script is already imported in ancestor component '${parentComponentName}'.`,
        legacyCode: 1009,
        severity: DiagnosticSeverity.Warning,
        code: 'redundant-import'
    }),
    overridesAncestorFunction: (callableName: string, currentScopeName: string, parentFilePath: string, parentScopeName: string) => ({
        message: `Function '${callableName}' included in '${currentScopeName}' overrides function in '${parentFilePath}' included in '${parentScopeName}'.`,
        legacyCode: 1010,
        severity: DiagnosticSeverity.Hint,
        code: 'overrides-ancestor-function'
    }),
    localVarFunctionShadowsParentFunction: (scopeName: 'stdlib' | 'scope') => ({
        message: `Local variable function has same name as ${scopeName} function and will never be called.`,
        legacyCode: 1011,
        severity: DiagnosticSeverity.Warning,
        code: 'variable-shadows-function'
    }),
    scriptImportCaseMismatch: (correctFilePath: string) => ({
        message: `Script import path does not match casing of actual file path '${correctFilePath}'.`,
        legacyCode: 1012,
        severity: DiagnosticSeverity.Warning,
        code: 'import-case-mismatch'
    }),
    fileNotReferencedByAnyOtherFile: () => ({
        message: `This file is not referenced by any other file in the project.`,
        legacyCode: 1013,
        severity: DiagnosticSeverity.Warning,
        code: 'file-not-referenced'
    }),
    unknownDiagnosticCode: (theUnknownCode: number | string) => ({
        message: `Unknown diagnostic code ${theUnknownCode}`,
        legacyCode: 1014,
        severity: DiagnosticSeverity.Warning,
        code: 'unknown-diagnostic-code'
    }),
    scriptSrcCannotBeEmpty: () => ({
        message: `Script import cannot be empty or whitespace`,
        legacyCode: 1015,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-import-path'
    }),
    expectedIdentifierAfterKeyword: (keywordText: string) => ({
        message: `Expected identifier after '${keywordText}' keyword`,
        legacyCode: 1016,
        severity: DiagnosticSeverity.Error,
        code: 'missing-identifier'
    }),
    missingCallableKeyword: () => ({
        message: `Expected 'function' or 'sub' to precede identifier`,
        legacyCode: 1017,
        severity: DiagnosticSeverity.Error,
        code: 'missing-leading-keyword'
    }),
    __unused12: () => ({
        message: `Expected valid type to follow 'as' keyword`,
        legacyCode: 1018,
        severity: DiagnosticSeverity.Error,
        code: 'expected-valid-type'
    }),
    bsFeatureNotSupportedInBrsFiles: (featureName) => ({
        message: `BrighterScript feature '${featureName}' is not supported in standard BrightScript files`,
        legacyCode: 1019,
        severity: DiagnosticSeverity.Error,
        code: 'bs-feature-not-supported'
    }),
    __ununsed12: () => ({
        message: `'brsconfig.json' is deprecated. Please rename to 'bsconfig.json'`,
        legacyCode: 1020,
        severity: DiagnosticSeverity.Warning,
        code: 'brsconfig-deprecated'
    }),
    bsConfigJsonHasSyntaxErrors: (message: string) => ({
        message: `Encountered syntax errors in bsconfig.json: ${message}`,
        legacyCode: 1021,
        severity: DiagnosticSeverity.Error,
        code: 'bsconfig-syntax-errors'
    }),
    itemIsDeprecated: () => ({
        message: `Item is deprecated`,
        legacyCode: 1022,
        severity: DiagnosticSeverity.Hint,
        code: 'item-deprecated'
    }),
    cannotUseOverrideKeywordOnConstructorFunction: () => ({
        message: 'Override keyword is not allowed on class constructor method',
        legacyCode: 1023,
        severity: DiagnosticSeverity.Error,
        code: 'override-keyword-on-constructor'
    }),
    statementMustBeDeclaredAtTopOfFile: (statementKeyword: string) => ({
        message: `'${statementKeyword}' statement must be declared at the top of the file`,
        legacyCode: 1024,
        severity: DiagnosticSeverity.Error,
        code: 'must-be-declared-at-top'
    }),
    __unused8: (methodName: string, className: string) => ({
        message: `Method '${methodName}' does not exist on type '${className}'`,
        legacyCode: 1025,
        severity: DiagnosticSeverity.Error
    }),
    duplicateIdentifier: (memberName: string) => ({
        message: `Duplicate identifier '${memberName}'`,
        legacyCode: 1026,
        severity: DiagnosticSeverity.Error,
        code: 'duplicate-identifier'
    }),
    missingOverrideKeyword: (ancestorClassName: string) => ({
        message: `Method has no override keyword but is declared in ancestor class '${ancestorClassName}'`,
        legacyCode: 1027,
        severity: DiagnosticSeverity.Error,
        code: 'missing-override-keyword'
    }),
    nameCollision: (thisThingKind: string, thatThingKind: string, thatThingName: string) => ({
        message: `${thisThingKind} has same name as ${thatThingKind} '${thatThingName}'`,
        legacyCode: 1028,
        severity: DiagnosticSeverity.Error,
        code: 'name-collision'
    }),
    __unused9: (className: string, scopeName: string) => ({
        message: `Class '${className}' could not be found when this file is included in scope '${scopeName}'`,
        legacyCode: 1029,
        severity: DiagnosticSeverity.Error,
        data: {
            className: className
        }
    }),
    expectedClassFieldIdentifier: () => ({
        message: `Expected identifier in class body`,
        legacyCode: 1030,
        severity: DiagnosticSeverity.Error,
        code: 'expected-identifier-in-body'
    }),
    expressionIsNotConstructable: (expressionType: string) => ({
        message: `Cannot use the 'new' keyword here because '${expressionType}' is not a constructable type`,
        legacyCode: 1031,
        severity: DiagnosticSeverity.Error,
        code: 'not-constructable'
    }),
    expectedKeyword: (kind: TokenKind) => ({
        message: `Expected '${kind}' keyword`,
        legacyCode: 1032,
        severity: DiagnosticSeverity.Error,
        code: 'expected-keyword'
    }),
    expectedLeftParenAfterCallable: (callableType: string) => ({
        message: `Expected '(' after ${callableType}`,
        legacyCode: 1033,
        severity: DiagnosticSeverity.Error,
        code: 'expected-left-paren-after-callable'
    }),
    expectedNameAfterCallableKeyword: (callableType: string) => ({
        message: `Expected ${callableType} name after '${callableType}' keyword`,
        legacyCode: 1034,
        severity: DiagnosticSeverity.Error,
        code: 'expected-name-after-callable'
    }),
    expectedLeftParenAfterCallableName: (callableType: string) => ({
        message: `Expected '(' after ${callableType} name`,
        legacyCode: 1035,
        severity: DiagnosticSeverity.Error,
        code: 'expected-left-paren-after-callable-name'
    }),
    tooManyCallableParameters: (actual: number, max: number) => ({
        message: `Cannot have more than ${max} parameters but found ${actual})`,
        legacyCode: 1036,
        severity: DiagnosticSeverity.Error,
        code: 'exceeds-max-parameter-count'
    }),
    __unused: (typeText: string) => ({
        message: `Function return type '${typeText}' is invalid`,
        legacyCode: 1037,
        severity: DiagnosticSeverity.Error
    }),
    requiredParameterMayNotFollowOptionalParameter: (parameterName: string) => ({
        message: `Required parameter '${parameterName}' must be declared before any optional parameters`,
        legacyCode: 1038,
        severity: DiagnosticSeverity.Error,
        code: 'required-parameter-before-optional'
    }),
    expectedNewlineOrColon: () => ({
        message: `Expected newline or ':' at the end of a statement`,
        legacyCode: 1039,
        severity: DiagnosticSeverity.Error,
        code: 'missing-statement-separator'
    }),
    functionNameCannotEndWithTypeDesignator: (callableType: string, name: string, designator: string) => ({
        message: `${callableType} name '${name}' cannot end with type designator '${designator}'`,
        legacyCode: 1040,
        severity: DiagnosticSeverity.Error,
        code: 'function-name-ends-with-type'
    }),
    callableBlockMissingEndKeyword: (callableType: string) => ({
        message: `Expected 'end ${callableType}' to terminate ${callableType} block`,
        legacyCode: 1041,
        severity: DiagnosticSeverity.Error,
        code: 'closing-keyword-mismatch'
    }),
    mismatchedEndCallableKeyword: (expectedCallableType: string, actualCallableType: string) => ({
        message: `Expected 'end ${expectedCallableType?.replace(/^end\s*/, '')}' to terminate ${expectedCallableType} block but found 'end ${actualCallableType?.replace(/^end\s*/, '')}' instead.`,
        legacyCode: 1042,
        severity: DiagnosticSeverity.Error,
        code: 'mismatched-end-callable-keyword'
    }),
    expectedParameterNameButFound: (text: string) => ({
        message: `Expected parameter name, but found '${text ?? ''}'`,
        legacyCode: 1043,
        severity: DiagnosticSeverity.Error,
        code: 'expected-parameter-name'
    }),
    __unused2: (parameterName: string, typeText: string) => ({
        message: `Function parameter '${parameterName}' is of invalid type '${typeText}'`,
        legacyCode: 1044,
        severity: DiagnosticSeverity.Error
    }),
    cannotUseReservedWordAsIdentifier: (name: string) => ({
        message: `Cannot use reserved word '${name}' as an identifier`,
        legacyCode: 1045,
        severity: DiagnosticSeverity.Error,
        code: 'cannot-use-reserved-word'
    }),
    expectedOperatorAfterIdentifier: (operators: TokenKind[], name: string) => {
        operators = Array.isArray(operators) ? operators : [];
        return {
            message: `Expected operator ('${operators.join(`', '`)}') after idenfifier '${name}'`,
            legacyCode: 1046,
            severity: DiagnosticSeverity.Error,
            code: 'expected-operator-after-identifier'
        };
    },
    expectedInlineIfStatement: () => ({
        message: `If/else statement within an inline if should be also inline`,
        legacyCode: 1047,
        severity: DiagnosticSeverity.Error,
        code: 'malformed-inline-if'
    }),
    expectedFinalNewline: () => ({
        message: `Expected newline at the end of an inline if statement`,
        legacyCode: 1048,
        severity: DiagnosticSeverity.Error,
        code: 'expected-final-newline'
    }),
    couldNotFindMatchingEndKeyword: (keyword: string) => ({
        message: `Could not find matching 'end ${keyword}'`,
        legacyCode: 1049,
        severity: DiagnosticSeverity.Error,
        code: 'could-not-find-matching-end-keyword'
    }),
    expectedCatchBlockInTryCatch: () => ({
        message: `Expected 'catch' block in 'try' statement`,
        legacyCode: 1050,
        severity: DiagnosticSeverity.Error,
        code: 'expected-catch'
    }),
    expectedEndForOrNextToTerminateForLoop: (forLoopNameText: string = TokenKind.For) => ({
        message: `Expected 'end for' or 'next' to terminate '${forLoopNameText}' loop`,
        legacyCode: 1051,
        severity: DiagnosticSeverity.Error,
        code: 'expected-loop-terminator'
    }),
    expectedInAfterForEach: (name: string) => ({
        message: `Expected 'in' after 'for each ${name}'`,
        legacyCode: 1052,
        severity: DiagnosticSeverity.Error,
        code: 'expected-in-for-each'
    }),
    expectedExpressionAfterForEachIn: () => ({
        message: `Expected expression after 'in' keyword from 'for each' statement`,
        legacyCode: 1053,
        severity: DiagnosticSeverity.Error,
        code: 'missing-loop-expression'
    }),
    unexpectedColonBeforeIfStatement: () => ({
        message: `Colon before 'if' statement is not allowed`,
        legacyCode: 1054,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-leading-colon'
    }),
    expectedStringLiteralAfterKeyword: (keyword: string) => ({
        message: `Missing string literal after '${keyword}' keyword`,
        legacyCode: 1055,
        severity: DiagnosticSeverity.Error,
        code: 'expected-string-literal'
    }),
    keywordMustBeDeclaredAtRootLevel: (keyword: string) => ({
        message: `${keyword} must be declared at the root level`,
        legacyCode: 1056,
        severity: DiagnosticSeverity.Error,
        code: 'keyword-must-be-root-level'
    }),
    __unused5: () => ({
        message: `'library' statement must be declared at the top of the file`,
        legacyCode: 1057,
        severity: DiagnosticSeverity.Error
    }),
    expectedTerminator: (expectedTerminators: string[] | string, statementType: string, blockDescriptor: 'block' | 'statement' = 'statement') => ({
        message: `Expected ${getPossibilitiesString(expectedTerminators)} to terminate '${statementType}' ${blockDescriptor}`,
        severity: DiagnosticSeverity.Error,
        code: 'expected-terminator'
    }),
    __unused14: () => ({
        message: `Expected 'end if', 'else if', or 'else' to terminate 'then' block`,
        legacyCode: 1058,
        severity: DiagnosticSeverity.Error,
        code: 'expected-terminator-on-then'
    }),
    __unused15: () => ({
        message: `Expected 'end try' to terminate 'try-catch' statement`,
        legacyCode: 1059,
        severity: DiagnosticSeverity.Error,
        code: 'expected-terminator-on-try-catch'
    }),
    __unused16: (startingPosition: Position) => ({
        message: `Expected 'end if' to close 'if' statement started at ${startingPosition?.line + 1}:${startingPosition?.character + 1} `,
        legacyCode: 1060,
        severity: DiagnosticSeverity.Error,
        code: 'expected-terminator-on-if'
    }),
    expectedStatement: (conditionType?: string, extraDetail?: string) => {
        let message = 'Expected statement';
        if (conditionType) {
            message += ` to follow '${conditionType?.toLowerCase()}'`;
        }
        if (extraDetail) {
            message += ` ${extraDetail}`;
        }
        return {
            message: message,
            severity: DiagnosticSeverity.Error,
            code: 'expected-statement'
        };
    },
    __unused18: (conditionType: string) => ({
        message: `Expected a statement to follow '${conditionType?.toLowerCase()} ...condition... then'`,
        legacyCode: 1061,
        severity: DiagnosticSeverity.Error,
        code: 'expected-statement-after-conditional'
    }),
    __unused19: () => ({
        message: `Expected a statement to follow 'else'`,
        legacyCode: 1062,
        severity: DiagnosticSeverity.Error,
        code: 'expected-statement-after-else'
    }),
    unexpectedOperator: () => ({
        message: `Unexpected operator`,
        legacyCode: 1063,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-operator'
    }),
    __unused13: () => ({
        message: `Increment / decrement operators are not allowed on function calls`,
        legacyCode: 1064,
        severity: DiagnosticSeverity.Error,
        code: 'increment-decrement-on-function-call'
    }),
    xmlUnexpectedTag: (tagName: string) => ({
        message: `Unexpected tag '${tagName}'`,
        legacyCode: 1065,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-tag'
    }),
    __unused20: () => ({
        message: `Expected statement or function call but instead found expression`,
        legacyCode: 1066,
        severity: DiagnosticSeverity.Error,
        code: 'expected-statement-not-expression'
    }),
    xmlFunctionNotFound: (name: string) => ({
        message: `Cannot find function with name '${name}' in component scope`,
        legacyCode: 1067,
        severity: DiagnosticSeverity.Error,
        code: 'function-not-found'
    }),
    xmlInvalidFieldType: (name: string) => ({
        message: `Invalid field type ${name}`,
        legacyCode: 1068,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-field-type'
    }),
    xmlUnexpectedChildren: (tagName: string) => ({
        message: `Tag '${tagName}' should not have children`,
        legacyCode: 1069,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-children'
    }),
    xmlTagMissingAttribute: (tagName: string, attrName: string) => ({
        message: `Tag '${tagName}' must have a '${attrName}' attribute`,
        legacyCode: 1070,
        severity: DiagnosticSeverity.Error,
        code: 'expected-attribute'
    }),
    expectedLabelIdentifierAfterGotoKeyword: () => ({
        message: `Expected label identifier after 'goto' keyword`,
        legacyCode: 1071,
        severity: DiagnosticSeverity.Error,
        code: 'expected-label'
    }),
    __unused26: () => ({
        message: `Expected ']' after array or object index`,
        legacyCode: 1072,
        severity: DiagnosticSeverity.Error,
        code: 'expected-right-brace'
    }),
    __unused21: () => ({
        message: `Expected property name after '.'`,
        legacyCode: 1073,
        severity: DiagnosticSeverity.Error,
        code: 'expected-property-name'
    }),
    tooManyCallableArguments: (actual: number, max: number) => ({
        message: `Cannot have more than ${max} arguments but found ${actual} `,
        legacyCode: 1074,
        severity: DiagnosticSeverity.Error,
        code: 'exceeds-max-argument-count'
    }),
    unmatchedLeftToken: (unmatchedToken: string, afterDetail = '') => {
        let matchingToken = '';
        switch (unmatchedToken) {
            case '(':
                matchingToken = ')';
                break;
            case '[':
                matchingToken = ']';
                break;
            case '{':
                matchingToken = '}';
                break;
        }
        let message = `Unmatched '${unmatchedToken}'`;
        if (matchingToken) {
            message += `: expected '${matchingToken}'`;
        }
        if (afterDetail) {
            message += ` after ${afterDetail}`;
        }
        return {
            message: message,
            legacyCode: 1075,
            severity: DiagnosticSeverity.Error,
            code: 'unmatched-left-token'
        };
    },
    __unused23: () => ({
        message: `Unmatched '(': expected ')' after expression`,
        legacyCode: 1076,
        severity: DiagnosticSeverity.Error,
        code: 'unmatched-left-paren'
    }),
    __unused24: () => ({
        message: `Unmatched '[': expected ']' after array literal`,
        legacyCode: 1077,
        severity: DiagnosticSeverity.Error,
        code: 'unmatched-left-brace'
    }),
    unexpectedAAKey: () => ({
        message: `Expected identifier or string as associative array key`,
        legacyCode: 1078,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-aa-key'
    }),
    expectedColonBetweenAAKeyAndvalue: () => ({
        message: `Expected ':' between associative array key and value`,
        legacyCode: 1079,
        severity: DiagnosticSeverity.Error,
        code: 'expected-aa-separator'
    }),
    __unused25: () => ({
        message: `Unmatched '{': expected '}' after associative array literal`,
        legacyCode: 1080,
        severity: DiagnosticSeverity.Error,
        code: 'unmatched-left-curly'
    }),
    unexpectedToken: (text: string) => ({
        message: `Unexpected token '${text}'`,
        legacyCode: 1081,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-token'
    }),
    /**
     * Used in the lexer anytime we encounter an unsupported character
     */
    unexpectedCharacter: (text: string) => ({
        message: `Unexpected character '${text}'(char code ${text?.charCodeAt(0)})`,
        legacyCode: 1082,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-character'
    }),
    unterminatedStringAtEndOfLine: () => ({
        message: `Unterminated string at end of line`,
        legacyCode: 1083,
        severity: DiagnosticSeverity.Error,
        code: 'unterminated-string'
    }),
    unterminatedStringAtEndOfFile: () => ({
        message: `Unterminated string at end of file`,
        legacyCode: 1084,
        severity: DiagnosticSeverity.Error,
        code: 'unterminated-string-at-end-of-file'
    }),
    fractionalHexLiteralsAreNotSupported: () => ({
        message: `Fractional hex literals are not supported`,
        legacyCode: 1085,
        severity: DiagnosticSeverity.Error,
        code: 'fractional-hex-literal'
    }),
    unexpectedConditionalCompilationString: () => ({
        message: `Unknown conditional compile keyword`,
        legacyCode: 1086,
        severity: DiagnosticSeverity.Error,
        code: 'unknown-conditional-compile-keyword'
    }),
    duplicateConstDeclaration: (name: string) => ({
        message: `Attempting to redeclare #const with name '${name}'`,
        legacyCode: 1087,
        severity: DiagnosticSeverity.Error,
        code: 'duplicate-const-declaration'
    }),
    constAliasDoesNotExist: (name: string) => ({
        message: `Attempting to create #const alias of '${name}', but no such #const exists`,
        legacyCode: 1088,
        severity: DiagnosticSeverity.Error,
        code: 'const-alias-does-not-exist'
    }),
    invalidHashConstValue: () => ({
        message: '#const declarations can only have values of `true`, `false`, or other #const names',
        legacyCode: 1089,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-const-value'
    }),
    referencedConstDoesNotExist: () => ({
        message: `Referenced #const does not exist`,
        legacyCode: 1090,
        severity: DiagnosticSeverity.Error,
        code: 'const-does-not-exist'
    }),
    invalidHashIfValue: () => ({
        message: `#if conditionals can only be 'true', 'false', or other #const names`,
        legacyCode: 1091,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-hash-if-value'
    }),
    hashError: (message: string) => ({
        message: `#error ${message} `,
        legacyCode: 1092,
        severity: DiagnosticSeverity.Error,
        code: 'hash-error'
    }),
    expectedEqualAfterConstName: () => ({
        message: `Expected '=' after #const`,
        legacyCode: 1093,
        severity: DiagnosticSeverity.Error,
        code: 'expected-equal-after-const'
    }),
    __unused17: (startingLine: number) => ({
        message: `Expected '#end if' to close '#if' conditional compilation statement starting on line ${startingLine} `,
        legacyCode: 1094,
        severity: DiagnosticSeverity.Error,
        code: 'expected-terminator-on-hash-if'
    }),
    constNameCannotBeReservedWord: () => ({
        message: `#const name cannot be a reserved word`,
        legacyCode: 1095,
        severity: DiagnosticSeverity.Error,
        code: 'const-reservered-word'
    }),
    expectedIdentifier: () => ({
        message: `Expected identifier`,
        legacyCode: 1096,
        severity: DiagnosticSeverity.Error,
        code: 'expected-identifier'
    }),
    expectedAttributeNameAfterAtSymbol: () => ({
        message: `Expected xml attribute name after '@'`,
        legacyCode: 1097,
        severity: DiagnosticSeverity.Error,
        code: 'expected-attribute-name'
    }),
    childFieldTypeNotAssignableToBaseProperty: (childTypeName: string, baseTypeName: string, fieldName: string, childFieldType: string, parentFieldType: string) => ({
        message: `Field '${fieldName}' in class '${childTypeName}' is not assignable to the same field in base class '${baseTypeName}'.Type '${childFieldType}' is not assignable to type '${parentFieldType}'.`,
        legacyCode: 1098,
        severity: DiagnosticSeverity.Error,
        code: 'field-inheritance-mismatch'
    }),
    classChildMemberDifferentMemberTypeThanAncestor: (memberType: string, parentMemberType: string, parentClassName: string) => ({
        message: `Class member is a ${memberType} here but a ${parentMemberType} in ancestor class '${parentClassName}'`,
        legacyCode: 1099,
        severity: DiagnosticSeverity.Error,
        code: 'child-field-type-different'
    }),
    classConstructorMissingSuperCall: () => ({
        message: `Missing "super()" call in class constructor method.`,
        legacyCode: 1100,
        severity: DiagnosticSeverity.Error,
        code: 'expected-super-call'
    }),
    classConstructorIllegalUseOfMBeforeSuperCall: () => ({
        message: `Illegal use of "m" before calling "super()"`,
        legacyCode: 1101,
        severity: DiagnosticSeverity.Error,
        code: 'expected-super-before-statement'
    }),
    classFieldCannotBeOverridden: () => ({
        message: `Class field cannot be overridden`,
        legacyCode: 1102,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-field-override'
    }),
    unusedAnnotation: () => ({
        message: `This annotation is not attached to any statement`,
        legacyCode: 1103,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-annotation'
    }),
    localVarShadowedByScopedFunction: () => ({
        message: `Declaring a local variable with same name as scoped function can result in unexpected behavior`,
        legacyCode: 1104,
        severity: DiagnosticSeverity.Error,
        code: 'var-shadows-function'
    }),
    scopeFunctionShadowedByBuiltInFunction: () => ({
        message: `Scope function will not be accessible because it has the same name as a built -in function`,
        legacyCode: 1105,
        severity: DiagnosticSeverity.Error,
        code: 'native-function-collision'
    }),
    localVarSameNameAsClass: (className: string) => ({
        message: `Local variable has same name as class '${className}'`,
        legacyCode: 1106,
        severity: DiagnosticSeverity.Error,
        code: 'local-var-same-name-as-class'
    }),
    unnecessaryCodebehindScriptImport: () => ({
        message: `This import is unnecessary because compiler option 'autoImportComponentScript' is enabled`,
        legacyCode: 1107,
        severity: DiagnosticSeverity.Warning,
        code: 'unnecessary-import'
    }),
    expectedOpenParenToFollowCallfuncIdentifier: () => ({
        message: `Expected '(' to follow callfunc identifier`,
        legacyCode: 1108,
        severity: DiagnosticSeverity.Error,
        code: 'expected-left-paren-after-callfunc'
    }),
    expectedToken: (...tokenKinds: string[]) => ({
        message: `Expected token '${tokenKinds.join(`' or '`)}'`,
        legacyCode: 1109,
        severity: DiagnosticSeverity.Error,
        code: 'expected-token'
    }),
    __unused10: (paramName: string) => ({
        message: `Parameter '${paramName}' may not have the same name as namespace`,
        legacyCode: 1110,
        severity: DiagnosticSeverity.Error,
        code: 'parameter-same-name-as-namespace'
    }),
    __unused11: (variableName: string) => ({
        message: `Variable '${variableName}' may not have the same name as namespace`,
        legacyCode: 1111,
        severity: DiagnosticSeverity.Error,
        code: 'variable-same-name-as-namespace'
    }),
    unterminatedTemplateStringAtEndOfFile: () => ({
        message: `Unterminated template string at end of file`,
        legacyCode: 1113,
        severity: DiagnosticSeverity.Error,
        code: 'unterminated-template-string'
    }),
    unterminatedTemplateExpression: () => ({
        message: `Unterminated template string expression. '\${' must be followed by expression, then '}'`,
        legacyCode: 1114,
        severity: DiagnosticSeverity.Error,
        code: 'unterminated-template-string-expression'
    }),
    duplicateComponentName: (componentName: string) => ({
        message: `There are multiple components with the name '${componentName}'`,
        legacyCode: 1115,
        severity: DiagnosticSeverity.Error,
        code: 'duplicate-component-name'
    }),
    __unused6: (className: string) => ({
        message: `Function has same name as class '${className}'`,
        legacyCode: 1116,
        severity: DiagnosticSeverity.Error
    }),
    expectedExceptionVarToFollowCatch: () => ({
        message: `Expected exception variable after 'catch' keyword`,
        legacyCode: 1117,
        severity: DiagnosticSeverity.Error,
        code: 'expected-exception-variable'
    }),
    missingExceptionExpressionAfterThrowKeyword: () => ({
        message: `Missing exception expression after 'throw' keyword`,
        legacyCode: 1118,
        severity: DiagnosticSeverity.Error,
        code: 'expected-throw-expression'
    }),
    missingLeftSquareBracketAfterDimIdentifier: () => ({
        message: `Missing left square bracket after 'dim' identifier`,
        legacyCode: 1119,
        severity: DiagnosticSeverity.Error,
        code: 'missing-left-brace-after-dim'
    }),
    missingRightSquareBracketAfterDimIdentifier: () => ({
        message: `Missing right square bracket after 'dim' identifier`,
        legacyCode: 1120,
        severity: DiagnosticSeverity.Error,
        code: 'missing-right-brace-after-dim'
    }),
    missingExpressionsInDimStatement: () => ({
        message: `Missing expression(s) in 'dim' statement`,
        legacyCode: 1121,
        severity: DiagnosticSeverity.Error,
        code: 'expected-dim-expression'
    }),
    mismatchedOverriddenMemberVisibility: (childClassName: string, memberName: string, childAccessModifier: string, ancestorAccessModifier: string, ancestorClassName: string) => ({
        message: `Access modifier mismatch: '${memberName}' is ${childAccessModifier} in type '${childClassName}' but is ${ancestorAccessModifier} in base type '${ancestorClassName}'.`,
        legacyCode: 1122,
        severity: DiagnosticSeverity.Error,
        code: 'access-modifier-mismatch'
    }),
    __unused3: (typeName: string) => ({
        message: `Cannot find type with name '${typeName}'`,
        legacyCode: 1123,
        severity: DiagnosticSeverity.Error
    }),
    enumValueMustBeType: (expectedType: string) => ({
        message: `Enum value must be type '${expectedType}'`,
        legacyCode: 1124,
        severity: DiagnosticSeverity.Error,
        code: 'enum-type-mismatch'
    }),
    enumValueIsRequired: (expectedType: string) => ({
        message: `Value is required for ${expectedType} enum`,
        legacyCode: 1125,
        severity: DiagnosticSeverity.Error,
        code: 'expected-enum-value'
    }),
    unknownEnumValue: (name: string, enumName: string) => ({
        message: `Property '${name}' does not exist on enum '${enumName}'`,
        legacyCode: 1126,
        severity: DiagnosticSeverity.Error,
        code: 'unknown-enum-value'
    }),
    __unused7: (scopeName: string, enumName: string) => ({
        message: `Scope '${scopeName}' already contains an enum with name '${enumName}'`,
        legacyCode: 1127,
        severity: DiagnosticSeverity.Error
    }),
    unknownRoSGNode: (nodeName: string) => ({
        message: `Unknown roSGNode '${nodeName}'`,
        legacyCode: 1128,
        severity: DiagnosticSeverity.Error,
        code: 'unknown-rosgnode'
    }),
    unknownBrightScriptComponent: (componentName: string) => ({
        message: `Unknown BrightScript component '${componentName}'`,
        legacyCode: 1129,
        severity: DiagnosticSeverity.Error,
        code: 'unknown-brightscript-component'
    }),
    mismatchCreateObjectArgumentCount: (componentName: string, allowedArgCounts: number[], actualCount: number) => {
        const argCountArray = (allowedArgCounts || [1]).sort().filter((value, index, self) => self.indexOf(value) === index);
        return {
            message: `For ${componentName}, expected ${argCountArray.map(c => c.toString()).join(' or ')} total arguments, but got ${actualCount}.`,
            legacyCode: 1130,
            severity: DiagnosticSeverity.Error,
            code: 'incorrect-createobject-argument-count'
        };
    },
    deprecatedBrightScriptComponent: (componentName: string, deprecatedDescription?: string) => ({
        message: `${componentName} has been deprecated${deprecatedDescription ? ': ' + deprecatedDescription : ''} `,
        legacyCode: 1131,
        severity: DiagnosticSeverity.Error,
        code: 'deprecated-brightscript-component'
    }),
    circularReferenceDetected: (items: string[], scopeName: string) => ({
        message: `Circular reference detected between ${Array.isArray(items) ? items.join(' -> ') : ''} in scope '${scopeName}'`,
        legacyCode: 1132,
        severity: DiagnosticSeverity.Error,
        code: 'circular-inheritance'
    }),
    unexpectedStatementOutsideFunction: () => ({
        message: `Unexpected statement found outside of function body`,
        legacyCode: 1133,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-statement'
    }),
    detectedTooDeepFileSource: (numberOfParentDirectories: number) => ({
        message: `Expected directory depth no larger than 7, but found ${numberOfParentDirectories} `,
        legacyCode: 1134,
        severity: DiagnosticSeverity.Error,
        code: 'directory-depth'
    }),
    illegalContinueStatement: () => ({
        message: `Continue statement must be contained within a loop statement`,
        legacyCode: 1135,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-continue'
    }),
    keywordMustBeDeclaredAtNamespaceLevel: (keyword: string) => ({
        message: `${keyword} must be declared at the root level or within a namespace`,
        legacyCode: 1136,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-declaration-location'
    }),
    itemCannotBeUsedAsVariable: (itemType: string) => ({
        message: `${itemType} cannot be used as a variable`,
        legacyCode: 1137,
        severity: DiagnosticSeverity.Error,
        code: 'type-not-variable'
    }),
    callfuncHasToManyArgs: (numberOfArgs: number) => ({
        message: `You can not have more than 5 arguments in a callFunc.${numberOfArgs} found.`,
        legacyCode: 1138,
        severity: DiagnosticSeverity.Error,
        code: 'exceeds-max-callfunc-arg-count'
    }),
    noOptionalChainingInLeftHandSideOfAssignment: () => ({
        message: `Optional chaining may not be used in the left-hand side of an assignment`,
        legacyCode: 1139,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-optional-chain'
    }),
    /**
     *
     * @param name for function calls where we can't find the name of the function
     * @param fullName if a namespaced name, this is the full name `alpha.beta.charlie`, otherwise it's the same as `name`
     * @param typeName if 'name' refers to a member, what is the the type it is a member of?
     * @param typeDescriptor defaults to 'type' ... could also be 'namespace', etc.
     */
    cannotFindFunction: (name: string, fullName?: string, typeName?: string, typeDescriptor = 'type') => ({
        message: `Cannot find function '${name}'${typeName ? ` for ${typeDescriptor} '${typeName}'` : ''} `,
        legacyCode: 1140,
        data: {
            name: name,
            fullName: fullName ?? name,
            typeName: typeName ? typeName : undefined
        },
        severity: DiagnosticSeverity.Error,
        code: 'cannot-find-function'
    }),
    argumentTypeMismatch: (actualTypeString: string, expectedTypeString: string, data?: TypeCompatibilityData) => ({
        message: `Argument of type '${actualTypeString}' is not compatible with parameter of type '${expectedTypeString}'${typeCompatibilityMessage(actualTypeString, expectedTypeString, data)} `,
        data: data,
        legacyCode: 1141,
        severity: DiagnosticSeverity.Error,
        code: 'argument-type-mismatch'
    }),
    returnTypeMismatch: (actualTypeString: string, expectedTypeString: string, data?: TypeCompatibilityData) => ({
        message: `Type '${actualTypeString}' is not compatible with declared return type '${expectedTypeString}'${typeCompatibilityMessage(actualTypeString, expectedTypeString, data)} '`,
        data: data,
        legacyCode: 1142,
        severity: DiagnosticSeverity.Error,
        code: 'return-type-mismatch'
    }),
    assignmentTypeMismatch: (actualTypeString: string, expectedTypeString: string, data?: TypeCompatibilityData) => ({
        message: `Type '${actualTypeString}' is not compatible with type '${expectedTypeString}'${typeCompatibilityMessage(actualTypeString, expectedTypeString, data)}`,
        data: data,
        legacyCode: 1143,
        severity: DiagnosticSeverity.Error,
        code: 'assignment-type-mismatch'
    }),
    operatorTypeMismatch: (operatorString: string, firstType: string, secondType = '') => ({
        message: `Operator '${operatorString}' cannot be applied to type${secondType ? 's' : ''} '${firstType}'${secondType ? ` and '${secondType}'` : ''}`,
        legacyCode: 1144,
        severity: DiagnosticSeverity.Error,
        code: 'operator-type-mismatch'
    }),
    incompatibleSymbolDefinition: (symbol: string, scopeName: string) => ({
        message: `'${symbol}' is incompatible across these scopes: ${scopeName}`,
        legacyCode: 1145,
        severity: DiagnosticSeverity.Error,
        code: 'incompatible-definition'
    }),
    memberAccessibilityMismatch: (memberName: string, accessModifierFlag: SymbolTypeFlag, definingClassName: string) => {
        let accessModName: string = TokenKind.Public;
        // eslint-disable-next-line no-bitwise
        if (accessModifierFlag & SymbolTypeFlag.private) {
            accessModName = TokenKind.Private;
            // eslint-disable-next-line no-bitwise
        } else if (accessModifierFlag & SymbolTypeFlag.protected) {
            accessModName = TokenKind.Protected;
        }
        accessModName = accessModName.toLowerCase();
        let accessAdditionalInfo = '';

        // eslint-disable-next-line no-bitwise
        if (accessModifierFlag & SymbolTypeFlag.private) {
            accessAdditionalInfo = ` and only accessible from within class '${definingClassName}'`;
            // eslint-disable-next-line no-bitwise
        } else if (accessModifierFlag & SymbolTypeFlag.protected) {
            accessAdditionalInfo = ` and only accessible from within class '${definingClassName}' and its subclasses`;
        }

        return {
            message: `Member '${memberName}' is ${accessModName}${accessAdditionalInfo}`, // TODO: Add scopes where it was defined
            legacyCode: 1146,
            severity: DiagnosticSeverity.Error,
            code: 'member-access-violation'
        };
    },
    typecastStatementMustBeDeclaredAtStart: () => ({
        message: `'typecast' statement must be declared at the top of the file or beginning of function or namespace`,
        legacyCode: 1147,
        severity: DiagnosticSeverity.Error,
        code: 'unexpected-typecast'
    }),
    invalidTypecastStatementApplication: (foundApplication: string) => ({
        message: `'typecast' statement can only be applied to 'm', but was applied to '${foundApplication}'`,
        legacyCode: 1148,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-typecast-target'
    }),
    itemCannotBeUsedAsType: (typeText: string) => ({
        message: `'${typeText}' cannot be used as a type`,
        legacyCode: 1149,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-type-reference'
    }),
    unsafeUnmatchedTerminatorInConditionalCompileBlock: (terminator: string) => ({
        message: `Unsafe unmatched terminator '${terminator}' in conditional compilation block`,
        legacyCode: 1150,
        severity: DiagnosticSeverity.Error,
        code: 'inconsistent-conditional-compile-nesting'
    }),
    expectedReturnStatement: () => ({
        message: `Expected return statement in function`,
        legacyCode: 1151,
        severity: DiagnosticSeverity.Error,
        code: 'missing-return-statement'
    })
};
export const defaultMaximumTruncationLength = 160;

export function typeCompatibilityMessage(actualTypeString: string, expectedTypeString: string, data: TypeCompatibilityData) {
    let message = '';
    actualTypeString = data?.actualType?.toString() ?? actualTypeString;
    expectedTypeString = data?.expectedType?.toString() ?? expectedTypeString;

    if (data?.missingFields?.length > 0) {
        message = `\n    Type '${actualTypeString}' is missing the following members of type '${expectedTypeString}': ` + util.truncate({
            leadingText: ``,
            trailingText: '',
            itemSeparator: ', ',
            items: data.missingFields,
            partBuilder: (x) => x.name,
            maxLength: defaultMaximumTruncationLength
        });
    } else if (data?.fieldMismatches?.length > 0) {
        message = '. ' + util.truncate({
            leadingText: `Type '${actualTypeString}' has incompatible members:`,
            items: data.fieldMismatches,
            itemSeparator: '',
            partBuilder: (x) => `\n    member "${x.name}" should be '${x.expectedType}' but is '${x.actualType}'`,
            maxLength: defaultMaximumTruncationLength
        });
    }
    return message;
}

function getPossibilitiesString(possibilities: string[] | string) {
    if (!Array.isArray(possibilities)) {
        return `'${possibilities}'`;
    }
    if (possibilities.length === 1) {
        return `'${possibilities}'`;

    }
    let result = '';
    for (let i = 0; i < possibilities.length; i++) {
        result += `'${possibilities[i]}'`;
        if (i < possibilities.length - 2) {
            result += ', ';
        } else if (i < possibilities.length - 1) {
            result += ' or ';
        }
    }
    return result;
}

export const DiagnosticCodeMap = {} as Record<keyof (typeof DiagnosticMessages), string>;
export const DiagnosticLegacyCodeMap = {} as Record<keyof (typeof DiagnosticMessages), number>;
export let diagnosticCodes = [] as string[];
for (let key in DiagnosticMessages) {
    diagnosticCodes.push(DiagnosticMessages[key]().code);
    diagnosticCodes.push(DiagnosticMessages[key]().legacyCode);
    DiagnosticCodeMap[key] = DiagnosticMessages[key]().code;
    DiagnosticLegacyCodeMap[key] = DiagnosticMessages[key]().legacyCode;
}

export interface DiagnosticInfo {
    message: string;
    legacyCode: number;
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
    Pick<BsDiagnostic, 'code' | 'location' | 'relatedInformation' | 'tags'>;
