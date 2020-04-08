/* eslint-disable camelcase */

import { DiagnosticSeverity } from 'vscode-languageserver';

/**
 * An object that keeps track of all possible error messages.
 */
export let diagnosticMessages = {
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    genericParserMessage: (message: string) => ({
        message: message,
        code: 1000,
        severity: DiagnosticSeverity.Error
    }),
    callToUnknownFunction: (name: string, scopeName: string) => ({
        message: `Cannot find function with name '${name}' when this file is included in scope "${scopeName}".`,
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
