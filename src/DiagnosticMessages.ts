/* eslint-disable camelcase */
/**
 * An object that keeps track of all possible error messages.
 */
export let diagnosticMessages = {
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    genericParserMessage: () => ({
        message: `There was an error parsing the file`,
        code: 1000
    }),
    callToUnknownFunction: (name: string, scopeName: string) => ({
        message: `Cannot find function with name '${name}' when this file is included in scope "${scopeName}".`,
        code: 1001
    }),
    mismatchArgumentCount: (expectedCount: number | string, actualCount: number) => ({
        message: `Expected ${expectedCount} arguments, but got ${actualCount}.`,
        code: 1002
    }),
    duplicateFunctionImplementation: (functionName: string, scopeName: string) => ({
        message: `Duplicate function implementation for "${functionName}" when this file is included in scope "${scopeName}".`,
        code: 1003
    }),
    referencedFileDoesNotExist: () => ({
        message: `Referenced file does not exist.`,
        code: 1004
    }),
    xmlComponentMissingComponentDeclaration: () => ({
        message: `Missing a component declaration.`,
        code: 1005
    }),
    xmlComponentMissingNameAttribute: () => ({
        message: `Component must have a name attribute.`,
        code: 1006
    }),
    xmlComponentMissingExtendsAttribute: () => ({
        message: `Component must have an extends attribute.`,
        code: 1007
    }),
    xmlGenericParseError: () => ({
        //generic catchall xml parse error
        message: `Invalid xml`,
        code: 1008
    }),
    unnecessaryScriptImportInChildFromParent: (parentComponentName: string) => ({
        message: `Unnecessary script import: Script is already imported in ancestor component "${parentComponentName}".`,
        code: 1009
    }),
    overridesAncestorFunction: (callableName: string, currentScopeName: string, parentFilePath: string, parentScopeName: string) => ({
        message: `Function "${callableName}" included in "${currentScopeName}" overrides function in "${parentFilePath}" included in "${parentScopeName}".`,
        code: 1010
    }),
    localVarShadowsGlobalFunction: (localName: string, globalLocation: string) => ({
        message: `Local var "${localName}" has same name as global function in "${globalLocation}" and will never be called.`,
        code: 1011
    }),
    scriptImportCaseMismatch: (correctFilePath: string) => ({
        message: `Script import path does not match casing of actual file path "${correctFilePath}".`,
        code: 1012
    }),
    fileNotReferencedByAnyOtherFile: () => ({
        message: `This file is not referenced by any other file in the project.`,
        code: 1013
    }),
    unknownDiagnosticCode: (theUnknownCode: number) => ({
        message: `Unknown diagnostic code ${theUnknownCode}`,
        code: 1014
    }),
    scriptSrcCannotBeEmpty: () => ({
        message: `Script import cannot be empty or whitespace`,
        code: 1015
    }),
    missingIdentifierAfterClassKeyword: () => ({
        message: `Expected identifier after 'class' keyword`,
        code: 1016
    }),
    missingCallableKeyword: (text: string) => ({
        message: `Expected 'function' or 'sub' to preceed '${text}'`,
        code: 1017
    }),
    expectedValidTypeToFollowAsKeyword: () => ({
        message: `Expected valid type to follow 'as' keyword`,
        code: 1018
    }),
    bsFeatureNotSupportedInBrsFiles: (featureName) => ({
        message: `BrighterScript feature ${featureName} is not supported in BrightScript files`,
        code: 1019
    }),
    brsConfigJsonIsDepricated: () => ({
        message: `brsconfig.json is depricated. Please rename to 'bsconfig.json'`,
        code: 1020
    }),
    bsConfigJsonHasSyntaxErrors: () => ({
        message: `Encountered syntax errors in bsconfig.json`,
        code: 1021
    })
};

let allCodes = [] as number[];
for (let key in diagnosticMessages) {
    allCodes.push(diagnosticMessages[key]().code);
}

export let diagnosticCodes = allCodes;

export interface DiagnosticMessage {
    message: string;
    code: number;
}
