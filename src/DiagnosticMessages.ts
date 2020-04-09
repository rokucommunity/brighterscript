/* eslint-disable camelcase */

import { DiagnosticSeverity } from 'vscode-languageserver';

/**
 * An object that keeps track of all possible error messages.
 */
export let diagnosticMessages = {

    expectedLeftParenAfterCallable: (callableType: string) => ({
        message: `Expected '(' after ${callableType}`,
        code: 1,
        severity: DiagnosticSeverity.Error
    }),
    expectedNameAfterCallableKeyword: (callableType: string) => ({
        message: `Expected ${callableType} name after '${callableType}' keyword`,
        code: 2,
        severity: DiagnosticSeverity.Error
    }),
    expectedLeftParenAfterCallableName: (callableType: string) => ({
        message: `Expected '(' after ${callableType} name`,
        code: 3,
        severity: DiagnosticSeverity.Error
    }),
    functionNameCannotEndWithTypeDesignator: (callableType: string, callableName: string, designator: string) => ({
        message: `${callableType} name '${callableName}' cannot end with type designator "${designator}"`
        code: 3,
        severity: DiagnosticSeverity.Error
    }),
    // expectedEndClassToErminateClassBlock: () => ({
    //     message: `Expected "end class" to terminate class block`,
    //     code: 1,
    //     severity: DiagnosticSeverity.Error
    // }),
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    genericParserMessage: (message: string) => ({
        message: message,
        code: 1000,
        severity: DiagnosticSeverity.Error
    }),
    callToUnknownFunction: (name: string, scopeName: string) => ({
        message: `Cannot find function with name "${name}" when this file is included in scope "${scopeName}".`,
        code: 1001,
        severity: DiagnosticSeverity.Error
    }),
    mismatchArgumentCount: (expectedCount: number | string, actualCount: number) => ({
        message: `Expected ${expectedCount} arguments, but got ${actualCount}.`,
        code: 1002,
        severity: DiagnosticSeverity.Error
    }),
    duplicateFunctionImplementation: (functionName: string, scopeName: string) => ({
        message: `Duplicate function implementation for "${functionName}" when this file is included in scope "${scopeName}".`,
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
        message: `Component must have an extends attribute.`,
        code: 1007,
        severity: DiagnosticSeverity.Error
    }),
    xmlGenericParseError: (message: string) => ({
        //generic catchall xml parse error
        message: message,
        code: 1008,
        severity: DiagnosticSeverity.Error
    }),
    unnecessaryScriptImportInChildFromParent: (parentComponentName: string) => ({
        message: `Unnecessary script import: Script is already imported in ancestor component "${parentComponentName}".`,
        code: 1009,
        severity: DiagnosticSeverity.Warning
    }),
    overridesAncestorFunction: (callableName: string, currentScopeName: string, parentFilePath: string, parentScopeName: string) => ({
        message: `Function "${callableName}" included in "${currentScopeName}" overrides function in "${parentFilePath}" included in "${parentScopeName}".`,
        code: 1010,
        severity: DiagnosticSeverity.Hint
    }),
    localVarShadowsGlobalFunction: (localName: string, globalLocation: string) => ({
        message: `Local var "${localName}" has same name as global function in "${globalLocation}" and will never be called.`,
        code: 1011,
        severity: DiagnosticSeverity.Warning
    }),
    scriptImportCaseMismatch: (correctFilePath: string) => ({
        message: `Script import path does not match casing of actual file path "${correctFilePath}".`,
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
    missingIdentifierAfterClassKeyword: () => ({
        message: `Expected identifier after 'class' keyword`,
        code: 1016,
        severity: DiagnosticSeverity.Error
    }),
    missingCallableKeyword: (text: string) => ({
        message: `Expected 'function' or 'sub' to preceed '${text}'`,
        code: 1017,
        severity: DiagnosticSeverity.Error
    }),
    expectedValidTypeToFollowAsKeyword: () => ({
        message: `Expected valid type to follow 'as' keyword`,
        code: 1018,
        severity: DiagnosticSeverity.Error
    }),
    bsFeatureNotSupportedInBrsFiles: (featureName) => ({
        message: `BrighterScript feature ${featureName} is not supported in BrightScript files`,
        code: 1019,
        severity: DiagnosticSeverity.Error
    }),
    brsConfigJsonIsDepricated: () => ({
        message: `brsconfig.json is depricated. Please rename to 'bsconfig.json'`,
        code: 1020,
        severity: DiagnosticSeverity.Warning
    }),
    bsConfigJsonHasSyntaxErrors: (message: string) => ({
        message: `Encountered syntax errors in bsconfig.json: ${message}`,
        code: 1021,
        severity: DiagnosticSeverity.Error
    }),
    missingIdentifierAfterExtendsKeyword: () => ({
        message: 'Missing identifier after extends keyword',
        code: 1022,
        severity: DiagnosticSeverity.Error
    }),
    cannotUseOverrideKeywordOnConstructorFunction: () => ({
        message: 'Override keyword is not allowed on class constructor method',
        code: 1023,
        severity: DiagnosticSeverity.Error
    }),
    Attempted_to_use_new_keyword_on_a_non_class: () => ({
        message: 'Attempted to use "new" keyword on a non class',
        code: 1024,
        severity: DiagnosticSeverity.Error
    }),
    Method_does_not_exist_on_type: (methodName: string, className: string) => ({
        message: `Method ${methodName} does not exist on type ${className}`,
        code: 1025,
        severity: DiagnosticSeverity.Error
    }),
    Duplicate_identifier: (memberName: string) => ({
        message: `Duplicate identifier "${memberName}"`,
        code: 1026,
        severity: DiagnosticSeverity.Error
    }),
    Missing_override_keyword: (methodName: string, ancestorClassName: string) => ({
        message: `Method "${methodName}" has no override keyword but is declared in ancestor class class "${ancestorClassName}"`,
        code: 1027,
        severity: DiagnosticSeverity.Error
    }),
    Duplicate_class_declaration: (scopeName: string, className: string) => ({
        message: `Scope "${scopeName}" already contains a class with name "${className}"`,
        code: 1028,
        severity: DiagnosticSeverity.Error
    }),
    Class_could_not_be_found: (extendsClassName: string, scopeName: string) => ({
        message: `Class "${extendsClassName}" could not be found when this file is included in scope "${scopeName}"`,
        code: 1029,
        severity: DiagnosticSeverity.Error
    })
};

let allCodes = [] as number[];
for (let key in diagnosticMessages) {
    allCodes.push(diagnosticMessages[key]().code);
}

export let diagnosticCodes = allCodes;

export interface DiagnosticInfo {
    message: string;
    code: number;
    severity: DiagnosticSeverity;
}
