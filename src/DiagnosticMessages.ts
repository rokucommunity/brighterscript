// tslint:disable
/**
 * An object that keeps track of all possible error messages.
 */
export let diagnosticMessages = {
    //this one won't be used much, we just need a catchall object for the code since we pass through the message from the parser
    Generic_parser_message: () => ({
        message: `There was an error parsing the file`,
        code: 1000,
    }),
    Call_to_unknown_function_1001: (name: string, scopeName: string) => ({
        message: `Cannot find function with name '${name}' when this file is included in scope "${scopeName}".`,
        code: 1001
    }),
    Expected_a_arguments_but_got_b_1002: (expectedCount: number | string, actualCount: number) => ({
        message: `Expected ${expectedCount} arguments, but got ${actualCount}.`,
        code: 1002
    }),
    Duplicate_function_implementation_1003: (functionName: string, scopeName: string) => ({
        message: `Duplicate function implementation for "${functionName}" when this file is included in scope "${scopeName}".`,
        code: 1003
    }),
    Referenced_file_does_not_exist_1004: () => ({
        message: `Referenced file does not exist.`,
        code: 1004
    }),
    Xml_component_missing_component_declaration_1005: () => ({
        message: `Missing a component declaration.`,
        code: 1005
    }),
    Component_missing_name_attribute_1006: () => ({
        message: `Component must have a name attribute.`,
        code: 1006
    }),
    Component_missing_extends_attribute_1007: () => ({
        message: `Component must have an extends attribute.`,
        code: 1007
    }),
    Xml_parse_error_1008: () => ({
        //generic catchall xml parse error
        message: `Invalid xml`,
        code: 1008
    }),
    Unnecessary_script_import_in_child_from_parent_1009: (parentComponentName: string) => ({
        message: `Unnecessary script import: Script is already imported in ancestor component "${parentComponentName}".`,
        code: 1009
    }),
    Shadows_ancestor_function_1010: (callableName: string, currentContextName: string, parentFilePath: string, parentContextName: string) => ({
        message: `Function "${callableName}" included in "${currentContextName}" shadows function in "${parentFilePath}" included in "${parentContextName}".`,
        code: 1010
    }),
    Local_var_shadows_global_function_1011: (localName: string, globalLocation: string) => ({
        message: `Local var "${localName}" has same name as global function in "${globalLocation}" and will never be called.`,
        code: 1011
    }),
    Script_import_case_mismatch_1012: (correctFilePath: string) => ({
        message: `Script import path does not match casing of actual file path "${correctFilePath}".`,
        code: 1012
    }),
    File_not_referenced_by_any_file_1013: () => ({
        message: `This file is not referenced by any other file in the project.`,
        code: 1013
    }),
    Unknown_diagnostic_code_1014: (theUnknownCode: number) => ({
        message: `Unknown diagnostic code ${theUnknownCode}`,
        code: 1014
    }),
    Script_src_cannot_be_empty_1015: () => ({
        message: `Script import cannot be empty or whitespace`,
        code: 1015
    }),
    Missing_identifier_after_class_keyword_1016: () => ({
        message: `Expected identifier after 'class' keyword`,
        code: 1016
    }),
    Missing_function_sub_keyword_1017: (text: string) => ({
        message: `Expected 'function' or 'sub' to preceed '${text}'`,
        code: 1017
    }),
    Expected_valid_type_to_follow_as_keyword_1018: () => ({
        message: `Expected valid type to follow 'as' keyword`,
        code: 1018
    }),
    Bs_feature_not_supported_in_brs_files_1019: (featureName) => ({
        message: `BrighterScript feature ${featureName} is not supported in BrightScript files`,
        code: 1019
    }),
    BrsConfigJson_is_depricated_1020: () => ({
        message: `brsconfig.json is depricated. Please rename to 'bsconfig.json'`,
        code: 1020
    }),    
    BsConfigJson_has_syntax_errors_1021: () => ({
        message: `Encountered syntax errors in bsconfig.json`,
        code: 1021
    }),
};

let allCodes = [];
for (let key in diagnosticMessages) {
    allCodes.push(diagnosticMessages[key]().code);
}

export let diagnosticCodes = allCodes;

export interface DiagnosticMessage {
    message: string;
    code: number;
}