import { URI } from 'vscode-uri';
import { isBrsFile, isCallExpression, isLiteralExpression, isNewExpression, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, OnScopeValidateEvent } from '../../interfaces';
import type { Expression } from '../../parser/Expression';
import type { EnumStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import type { Scope } from '../../Scope';
import type { SymbolTable } from '../../SymbolTable';
import type { DiagnosticRelatedInformation, Position } from 'vscode-languageserver';

/**
 * The lower-case names of all platform-included scenegraph nodes
 */
const platformNodeNames = new Set(Object.values(nodes).map(x => x.name.toLowerCase()));
const platformComponentNames = new Set(Object.values(components).map(x => x.name.toLowerCase()));

/**
 * A validator that handles all scope validations for a program validation cycle.
 * You should create ONE of these to handle all scope events between beforeProgramValidate and afterProgramValidate,
 * and call reset() before using it again in the next cycle
 */
export class ScopeValidator {

    private events: OnScopeValidateEvent[] = [];

    public processEvent(event: OnScopeValidateEvent) {
        this.events.push(event);
        event.scope.linkSymbolTable();
        this.detectDuplicateEnums(event);
        this.validateCreateObjectCalls(event);
        this.iterateExpressions(event);
        event.scope.unlinkSymbolTable();
    }

    public reset() {
        this.onceCache.clear();
        this.multiScopeCache.clear();
        this.events = [];
    }

    /**
     * Adds a diagnostic to the first scope for this key. Prevents duplicate diagnostics
     * for diagnostics where scope isn't important. (i.e. CreateObject validations)
     */
    private addDiagnosticOnce(event: OnScopeValidateEvent, diagnostic: BsDiagnostic) {
        this.onceCache.getOrAdd(`${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
            event.scope.addDiagnostics([diagnostic]);
            return true;
        });
    }
    private onceCache = new Cache<string, boolean>();

    private addDiagnostic(event: OnScopeValidateEvent, diagnostic: BsDiagnostic) {
        event.scope.addDiagnostics([diagnostic]);
    }

    /**
     * Add a diagnostic (to the first scope) that will have `relatedInformation` for each affected scope
     */
    private addMultiScopeDiagnostic(event: OnScopeValidateEvent, diagnostic: BsDiagnostic, message = 'Not defined in scope') {
        diagnostic = this.multiScopeCache.getOrAdd(`${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
            if (!diagnostic.relatedInformation) {
                diagnostic.relatedInformation = [];
            }
            this.addDiagnostic(event, diagnostic);
            return diagnostic;
        });
        const info = {
            message: `${message} '${event.scope.name}'`
        } as DiagnosticRelatedInformation;
        if (isXmlScope(event.scope) && event.scope.xmlFile?.srcPath) {
            info.location = util.createLocation(
                URI.file(event.scope.xmlFile.srcPath).toString(),
                util.createRange(0, 0, 0, 10)
            );
        } else {
            info.location = util.createLocation(
                URI.file(diagnostic.file.srcPath).toString(),
                diagnostic.range
            );
        }
        diagnostic.relatedInformation.push(info);
    }

    /**
     * Find the closest symbol table for the given position
     */
    private getSymbolTable(scope: Scope, file: BrsFile, position: Position) {
        let symbolTable: SymbolTable;
        symbolTable = file.getFunctionScopeAtPosition(position)?.func.symbolTable;
        if (!symbolTable) {
            symbolTable = file.getNamespaceStatementForPosition(position)?.symbolTable;
        }
        if (!symbolTable) {
            symbolTable = scope.symbolTable;
        }
        return symbolTable;
    }

    private multiScopeCache = new Cache<string, BsDiagnostic>();

    private iterateExpressions(event: OnScopeValidateEvent) {
        const { scope } = event;
        event.scope.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {
                const expressions = [
                    ...file.parser.references.expressions,
                    //all class "extends <whatever>" expressions
                    ...file.parser.references.classStatements.map(x => x.parentClassName?.expression),
                    //all interface "extends <whatever>" expressions
                    ...file.parser.references.interfaceStatements.map(x => x.parentInterfaceName?.expression)
                ];
                outer:
                for (let referenceExpression of expressions) {
                    if (!referenceExpression) {
                        continue;
                    }
                    let expression: Expression;
                    //lift the callee from call expressions to handle namespaced function calls
                    if (isCallExpression(referenceExpression)) {
                        expression = referenceExpression.callee;
                    } else if (isNewExpression(referenceExpression)) {
                        expression = referenceExpression.call.callee;
                    } else {
                        expression = referenceExpression;
                    }
                    const tokens = util.getAllDottedGetParts(expression);
                    if (tokens?.length > 0) {
                        const symbolTable = this.getSymbolTable(scope, file, tokens[0].range.start); //flag all unknown left-most variables
                        if (!symbolTable.hasSymbol(tokens[0]?.text)) {
                            this.addMultiScopeDiagnostic(event, {
                                file: file as BscFile,
                                ...DiagnosticMessages.cannotFindName(tokens[0].text),
                                range: tokens[0].range
                            });
                            //skip to the next expression
                            continue;
                        }
                        //at this point, we know the first item is a known symbol. find unknown namespace parts after the first part
                        if (tokens.length > 1) {
                            const firstNamespacePart = tokens.shift().text?.toLowerCase();
                            const namespaceContainer = scope.namespaceLookup.get(firstNamespacePart);
                            const enumStatement = scope.getEnum(firstNamespacePart);
                            //if this isn't a namespace, skip it
                            if (!namespaceContainer && !enumStatement) {
                                continue;
                            }
                            //catch unknown namespace items
                            const processedNames: string[] = [firstNamespacePart];
                            for (const token of tokens ?? []) {
                                processedNames.push(token.text?.toLowerCase());

                                const entityName = processedNames.join('.');

                                if (
                                    !scope.getEnumMemberMap().has(entityName) &&
                                    !scope.getEnumMap().has(entityName) &&
                                    !scope.getClassMap().has(entityName) &&
                                    !scope.getConstMap().has(entityName) &&
                                    !scope.getCallableByName(entityName) &&
                                    !scope.namespaceLookup.has(entityName)
                                ) {
                                    //if this looks like an enum member, provide a nicer error message
                                    const theEnum = this.getEnum(scope, entityName)?.item;
                                    if (theEnum) {
                                        this.addMultiScopeDiagnostic(event, {
                                            file: file,
                                            ...DiagnosticMessages.unknownEnumValue(token.text?.split('.').pop(), theEnum.fullName),
                                            range: tokens[tokens.length - 1].range,
                                            relatedInformation: [{
                                                message: 'Enum declared here',
                                                location: util.createLocation(
                                                    URI.file(file.srcPath).toString(),
                                                    theEnum.tokens.name.range
                                                )
                                            }]
                                        });
                                    } else {
                                        this.addMultiScopeDiagnostic(event, {
                                            ...DiagnosticMessages.cannotFindName(token.text),
                                            range: token.range,
                                            file: file
                                        });
                                    }
                                    //no need to add another diagnostic for future unknown items
                                    continue outer;
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Given a string optionally separated by dots, find an enum related to it.
     * For example, all of these would return the enum: `SomeNamespace.SomeEnum.SomeMember`, SomeEnum.SomeMember, `SomeEnum`
     */
    private getEnum(scope: Scope, name: string) {
        //look for the enum directly
        let result = scope.getEnumMap().get(name);

        //assume we've been given the enum.member syntax, so pop the member and try again
        if (!result) {
            const parts = name.split('.');
            parts.pop();
            result = scope.getEnumMap().get(parts.join('.'));
        }
        return result;
    }

    /**
     * Flag duplicate enums
     */
    private detectDuplicateEnums(event: OnScopeValidateEvent) {
        const diagnostics: BsDiagnostic[] = [];
        const enumLocationsByName = new Cache<string, Array<{ file: BrsFile; statement: EnumStatement }>>();
        event.scope.enumerateBrsFiles((file) => {
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
            enumLocations.sort((a, b) => a.file?.srcPath?.localeCompare(b.file?.srcPath));
            const primaryEnum = enumLocations.shift();
            const fullName = primaryEnum.statement.fullName;
            for (const duplicateEnumInfo of enumLocations) {
                diagnostics.push({
                    ...DiagnosticMessages.duplicateEnumDeclaration(event.scope.name, fullName),
                    file: duplicateEnumInfo.file,
                    range: duplicateEnumInfo.statement.tokens.name.range,
                    relatedInformation: [{
                        message: 'Enum declared here',
                        location: util.createLocation(
                            URI.file(primaryEnum.file.srcPath).toString(),
                            primaryEnum.statement.tokens.name.range
                        )
                    }]
                });
            }
        }
        event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Validate every function call to `CreateObject`.
     * Ideally we would create better type checking/handling for this, but in the mean time, we know exactly
     * what these calls are supposed to look like, and this is a very common thing for brs devs to do, so just
     * do this manually for now.
     */
    protected validateCreateObjectCalls(event: OnScopeValidateEvent) {
        const diagnostics: BsDiagnostic[] = [];

        event.scope.enumerateBrsFiles((file) => {
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
                    //don't validate any components with a colon in their name (probably component libraries, but regular components can have them too).
                    if (componentName?.text?.includes(':')) {
                        continue;
                    }
                    //add diagnostic for unknown components
                    const unquotedComponentName = componentName?.text?.replace(/"/g, '');
                    if (unquotedComponentName && !platformNodeNames.has(unquotedComponentName.toLowerCase()) && !event.program.getComponent(unquotedComponentName)) {
                        this.addDiagnosticOnce(event, {
                            file: file as BscFile,
                            ...DiagnosticMessages.unknownRoSGNode(unquotedComponentName),
                            range: componentName.range
                        });
                    } else if (call?.args.length !== 2) {
                        // roSgNode should only ever have 2 args in `createObject`
                        this.addDiagnosticOnce(event, {
                            file: file as BscFile,
                            ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, [2], call?.args.length),
                            range: call.range
                        });
                    }
                } else if (!platformComponentNames.has(firstParamStringValue.toLowerCase())) {
                    this.addDiagnosticOnce(event, {
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
                        this.addDiagnosticOnce(event, {
                            file: file as BscFile,
                            ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, validArgCounts, call?.args.length),
                            range: call.range
                        });
                    }

                    // Test for deprecation
                    if (brightScriptComponent.isDeprecated) {
                        this.addDiagnosticOnce(event, {
                            file: file as BscFile,
                            ...DiagnosticMessages.deprecatedBrightScriptComponent(firstParamStringValue, brightScriptComponent.deprecatedDescription),
                            range: call.range
                        });
                    }
                }
            }
        });
        event.scope.addDiagnostics(diagnostics);
    }
}
