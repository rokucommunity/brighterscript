import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { isBrsFile, isLiteralExpression } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, OnScopeValidateEvent } from '../../interfaces';
import type { DottedGetExpression } from '../../parser/Expression';
import type { EnumStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';

/**
 * The lower-case names of all platform-included scenegraph nodes
 */
const platformNodeNames = new Set(Object.values(nodes).map(x => x.name.toLowerCase()));
const platformComponentNames = new Set(Object.values(components).map(x => x.name.toLowerCase()));

export class ScopeValidator {
    constructor(
        private event: OnScopeValidateEvent
    ) {
    }

    public process() {
        this.validateEnumUsage();
        this.detectDuplicateEnums();
        this.validateCreateObjectCalls();
    }

    /**
     * Find all expressions and validate the ones that look like enums
     */
    public validateEnumUsage() {
        const diagnostics = [] as BsDiagnostic[];

        const membersByEnum = new Cache<string, Map<string, string>>();
        //if there are any enums defined in this scope
        const enumLookup = this.event.scope.getEnumMap();

        //skip enum validation if there are no enums defined in this scope
        if (enumLookup.size === 0) {
            return;
        }

        this.event.scope.enumerateOwnFiles((file) => {
            //skip non-brs files
            if (!isBrsFile(file)) {
                return;
            }

            for (const expression of file.parser.references.expressions as Set<DottedGetExpression>) {
                const parts = util.getAllDottedGetParts(expression);
                //skip expressions that aren't fully dotted gets
                if (!parts) {
                    continue;
                }
                //get the name of the enum member
                const memberName = parts.pop();
                //get the name of the enum (including leading namespace if applicable)
                const enumName = parts.join('.');
                const lowerEnumName = enumName.toLowerCase();
                const theEnum = enumLookup.get(lowerEnumName)?.item;
                if (theEnum) {
                    const members = membersByEnum.getOrAdd(lowerEnumName, () => theEnum.getMemberValueMap());
                    const value = members?.get(memberName.toLowerCase());
                    if (!value) {
                        diagnostics.push({
                            file: file,
                            ...DiagnosticMessages.unknownEnumValue(memberName, theEnum.fullName),
                            range: expression.name.range,
                            relatedInformation: [{
                                message: 'Enum declared here',
                                location: Location.create(
                                    URI.file(file.pathAbsolute).toString(),
                                    theEnum.tokens.name.range
                                )
                            }]
                        });
                    }
                }
            }
        });
        this.event.scope.addDiagnostics(diagnostics);
    }

    private detectDuplicateEnums() {
        const diagnostics: BsDiagnostic[] = [];
        const enumLocationsByName = new Cache<string, Array<{ file: BrsFile; statement: EnumStatement }>>();
        this.event.scope.enumerateBrsFiles((file) => {
            for (const enumStatement of file.parser.references.enumStatements) {
                const fullName = enumStatement.fullName;
                const nameLower = fullName?.toLowerCase();
                if (nameLower?.length > 0) {
                    enumLocationsByName.getOrAdd(nameLower, () => []).push({
                        file: file,
                        statement: enumStatement
                    });
                }
            }
        });

        //now that we've collected all enum declarations, flag duplicates
        for (const enumLocations of enumLocationsByName.values()) {
            //sort by srcPath to keep the primary enum location consistent
            enumLocations.sort((a, b) => a.file?.pathAbsolute?.localeCompare(b.file?.pathAbsolute));
            const primaryEnum = enumLocations.shift();
            const fullName = primaryEnum.statement.fullName;
            for (const duplicateEnumInfo of enumLocations) {
                diagnostics.push({
                    ...DiagnosticMessages.duplicateEnumDeclaration(this.event.scope.name, fullName),
                    file: duplicateEnumInfo.file,
                    range: duplicateEnumInfo.statement.tokens.name.range,
                    relatedInformation: [{
                        message: 'Enum declared here',
                        location: Location.create(
                            URI.file(primaryEnum.file.pathAbsolute).toString(),
                            primaryEnum.statement.tokens.name.range
                        )
                    }]
                });
            }
        }
        this.event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Validate every function call to `CreateObject`.
     * Ideally we would create better type checking/handling for this, but in the mean time, we know exactly
     * what these calls are supposed to look like, and this is a very common thing for brs devs to do, so just
     * do this manually for now.
     */
    protected validateCreateObjectCalls() {
        const diagnostics = [];
        this.event.scope.enumerateBrsFiles((file) => {
            for (const call of file.functionCalls) {
                //skip non CreateObject function calls
                if (call.name?.toLowerCase() !== 'createobject' || !isLiteralExpression(call?.args[0]?.expression)) {
                    continue;
                }
                const firstParamToken = (call?.args[0]?.expression as any)?.token;
                const firstParamStringValue = firstParamToken?.text?.replace(/"/g, '');
                //if this is a `createObject('roSGNode'` call, only support known sg node types
                if (firstParamStringValue?.toLowerCase() === 'rosgnode' && isLiteralExpression(call?.args[1]?.expression)) {
                    const componentName: Token = (call?.args[1]?.expression as any)?.token;
                    //add diagnostic for unknown components
                    const unquotedComponentName = componentName?.text?.replace(/"/g, '');
                    if (unquotedComponentName && !platformNodeNames.has(unquotedComponentName.toLowerCase()) && !this.event.program.getComponent(unquotedComponentName)) {
                        diagnostics.push({
                            file: file as BscFile,
                            ...DiagnosticMessages.unknownRoSGNode(unquotedComponentName),
                            range: componentName.range
                        });
                    } else if (call?.args.length !== 2) {
                        // roSgNode should only ever have 2 args in `createObject`
                        diagnostics.push({
                            file: file as BscFile,
                            ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, [2], call?.args.length),
                            range: call.range
                        });
                    }
                } else if (!platformComponentNames.has(firstParamStringValue.toLowerCase())) {
                    diagnostics.push({
                        file: file as BscFile,
                        ...DiagnosticMessages.unknownBrightScriptComponent(firstParamStringValue),
                        range: firstParamToken.range
                    });
                } else {
                    // This is valid brightscript component
                    // Test for invalid arg counts
                    const brightScriptComponent: BRSComponentData = components[firstParamStringValue.toLowerCase()];
                    // Valid arg counts for createObject are 1+ number of args for constructor
                    let validArgCounts = brightScriptComponent.constructors.map(cnstr => cnstr.params.length + 1);
                    if (validArgCounts.length === 0) {
                        // no constructors for this component, so createObject only takes 1 arg
                        validArgCounts = [1];
                    }
                    if (!validArgCounts.includes(call?.args.length)) {
                        // Incorrect number of arguments included in `createObject()`
                        diagnostics.push({
                            file: file as BscFile,
                            ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, validArgCounts, call?.args.length),
                            range: call.range
                        });
                    }

                    // Test for deprecation
                    if (brightScriptComponent.isDeprecated) {
                        diagnostics.push({
                            file: file as BscFile,
                            ...DiagnosticMessages.deprecatedBrightScriptComponent(firstParamStringValue, brightScriptComponent.deprecatedDescription),
                            range: call.range
                        });
                    }
                }
            }
        });
        this.event.scope.addDiagnostics(diagnostics);
    }
}
