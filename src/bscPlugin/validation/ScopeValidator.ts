import { URI } from 'vscode-uri';
import { isBrsFile, isCallExpression, isDynamicType, isFunctionType, isInvalidType, isLiteralExpression, isNewExpression, isTypedFunctionType, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, CallableContainerMap, FunctionCall, MinMax, OnScopeValidateEvent } from '../../interfaces';
import type { Expression } from '../../parser/Expression';
import type { EnumStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import type { Scope } from '../../Scope';
import type { SymbolTable } from '../../SymbolTable';
import type { DiagnosticRelatedInformation, Position } from 'vscode-languageserver';
import { UninitializedType } from '../../types/UninitializedType';
import { getTypeFromContext } from '../../types/BscType';

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
        this.detectInvalidFunctionCalls(event);
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
        diagnostic = this.multiScopeCache.getOrAdd(`${diagnostic.file?.srcPath}-${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
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
        symbolTable = file.getFunctionExpressionAtPosition(position)?.symbolTable;
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

                    if (isCallExpression(expression.parent) && !isNewExpression(referenceExpression)) {
                        // function calls are validated in detectInvalidFunctionCalls
                        continue;
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
                            const firstNamespacePart = tokens.shift().text;
                            const firstNamespacePartLower = firstNamespacePart?.toLowerCase();
                            const namespaceContainer = scope.namespaceLookup.get(firstNamespacePartLower);
                            const enumStatement = scope.getEnum(firstNamespacePartLower);
                            //if this isn't a namespace, skip it
                            if (!namespaceContainer && !enumStatement) {
                                continue;
                            }
                            //catch unknown namespace items
                            const processedNames: string[] = [firstNamespacePart];
                            for (const token of tokens ?? []) {
                                processedNames.push(token.text);
                                const entityName = processedNames.join('.');
                                const entityNameLower = entityName.toLowerCase();

                                //if this is an enum member, stop validating here to prevent errors further down the chain
                                if (scope.getEnumMemberMap().has(entityNameLower)) {
                                    break;
                                }

                                if (
                                    !scope.getEnumMap().has(entityNameLower) &&
                                    !scope.getClassMap().has(entityNameLower) &&
                                    !scope.getConstMap().has(entityNameLower) &&
                                    !scope.getCallableByName(entityNameLower) &&
                                    !scope.namespaceLookup.has(entityNameLower)
                                ) {
                                    //if this looks like an enum, provide a nicer error message
                                    const theEnum = this.getEnum(scope, entityNameLower)?.item;
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
                                            ...DiagnosticMessages.cannotFindName(token.text, entityName),
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
            enumLocations.sort((a, b) => {
                const pathA = a.file?.srcPath;
                const pathB = b.file?.srcPath;
                if (pathA < pathB) {
                    return -1;
                } else if (pathA > pathB) {
                    return 1;
                }
                return 0;
            });
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
                if (call.name?.text.toLowerCase() !== 'createobject' || !isLiteralExpression(call?.args[0]?.expression)) {
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

    protected detectInvalidFunctionCalls(event: OnScopeValidateEvent) {
        const diagnostics: BsDiagnostic[] = [];
        //get a list of all callables, indexed by their lower case names
        let callableContainerMap = event.scope.getCallableContainerMap();

        event.scope.enumerateBrsFiles((file) => {
            diagnostics.push(...this.detectInvalidFunctionCallsForFile(event.scope, file, callableContainerMap));
        });
        event.scope.addDiagnostics(diagnostics);
    }


    /**
    * Find functions with either the wrong type of parameters, or the wrong number of parameters
    */
    private detectInvalidFunctionCallsForFile(scope: Scope, file: BscFile, callableContainersByLowerName: CallableContainerMap) {
        const diagnostics: BsDiagnostic[] = [];
        const specialCaseGlobalFunctions = ['val']; //  Global callables with multiple definitions
        if (isBrsFile(file)) {
            for (let expCall of file.functionCalls) {
                const symbolTypeInfo = file.getSymbolTypeFromToken(expCall.name, expCall.functionExpression, scope);
                let funcType = symbolTypeInfo.type;
                if ((!isTypedFunctionType(funcType) && !isDynamicType(funcType)) || specialCaseGlobalFunctions.includes(expCall.name.text)) {
                    // We don't know if this is a function. Try seeing if it is a global
                    const callableContainer = util.getCallableContainerByFunctionCall(callableContainersByLowerName, expCall);
                    if (callableContainer) {
                        // We found a global callable with correct number of params - use that
                        funcType = callableContainer.callable?.type;
                    } else {
                        const allowedParamCount = util.getMinMaxParamCountByFunctionCall(callableContainersByLowerName, expCall);
                        if (allowedParamCount) {
                            // We found a global callable, but it needs a different number of args
                            diagnostics.push(this.getMismatchParamCountDiagnostic(allowedParamCount, expCall, file));
                            continue;
                        }
                    }
                }

                if (isFunctionType(funcType)) {
                    // This is a generic function, and it is callable
                } else if (isTypedFunctionType(funcType)) {
                    // Check for Argument count mismatch.
                    //get min/max parameter count for callable
                    let paramCount = util.getMinMaxParamCount(funcType.params);
                    if (expCall.args.length > paramCount.max || expCall.args.length < paramCount.min) {
                        diagnostics.push(this.getMismatchParamCountDiagnostic(paramCount, expCall, file));
                    }

                    // Check for Argument type mismatch.
                    const paramTypeContext = { file: file, scope: scope, position: expCall.functionExpression.range?.start };
                    const argTypeContext = { file: file, scope: scope, position: expCall.range?.start };
                    for (let index = 0; index < funcType.params.length; index++) {
                        const param = funcType.params[index];
                        const arg = expCall.args[index];
                        if (!arg) {
                            // not enough args
                            break;
                        }
                        let argType = arg.type ?? new UninitializedType();
                        const paramType = getTypeFromContext(param.type, paramTypeContext);
                        if (!paramType) {
                            // other error - can not determine what type this parameter should be
                            continue;
                        }
                        argType = getTypeFromContext(argType, argTypeContext);
                        let assignable = argType?.isAssignableTo(paramType, argTypeContext);
                        if (!assignable) {
                            // TODO TYPES: perhaps this should be a strict mode setting?
                            assignable = argType?.isConvertibleTo(paramType, argTypeContext);
                        }
                        if (!assignable) {
                            diagnostics.push({
                                ...DiagnosticMessages.argumentTypeMismatch(argType?.toString(argTypeContext), paramType.toString(paramTypeContext)),
                                range: arg?.range,
                                file: file
                            });
                        }
                    }
                } else if (isInvalidType(symbolTypeInfo.type)) {
                    // TODO TYPES: standard member functions like integer.ToStr() are not detectable yet.
                } else if (isDynamicType(symbolTypeInfo.type)) {
                    // maybe this is a function? who knows
                } else {
                    diagnostics.push({
                        ...DiagnosticMessages.cannotFindName(symbolTypeInfo.expandedTokenText, symbolTypeInfo.fullName),
                        range: expCall.range,
                        file: file
                    });
                }
            }
        }
        return diagnostics;
    }

    private getMismatchParamCountDiagnostic(paramCount: MinMax, expCall: FunctionCall, file: BscFile) {
        const minMaxParamsText = paramCount.min === paramCount.max ? paramCount.max : `${paramCount.min}-${paramCount.max}`;
        const expCallArgCount = expCall.args.length;
        return ({
            ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount),
            range: expCall.nameRange,
            file: file
        });
    }
}
