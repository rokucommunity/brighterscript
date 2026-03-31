import { URI } from 'vscode-uri';
import { isBrsFile, isCallExpression, isDottedGetExpression, isLiteralExpression, isNamespaceStatement, isVariableExpression, isXmlScope, isNamedArgumentExpression } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, OnScopeValidateEvent, CallableContainerMap, Callable } from '../../interfaces';
import type { ClassStatement, EnumStatement, MethodStatement, NamespaceStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { Scope } from '../../Scope';
import type { DiagnosticRelatedInformation } from 'vscode-languageserver';
import type { Expression } from '../../parser/AstNode';
import type { FunctionParameterExpression, VariableExpression, DottedGetExpression, NamedArgumentExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import { createVisitor, WalkMode } from '../../astUtils/visitors';

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

    /**
     * The event currently being processed. This will change multiple times throughout the lifetime of this validator
     */
    private event: OnScopeValidateEvent;

    public processEvent(event: OnScopeValidateEvent) {
        this.event = event;
        this.walkFiles();
        this.detectDuplicateEnums();
    }

    public reset() {
        this.event = undefined;
        this.onceCache.clear();
        this.multiScopeCache.clear();
    }

    private walkFiles() {
        this.event.scope.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {
                this.iterateFileExpressions(file);
                this.validateCreateObjectCalls(file);
                this.validateComputedAAKeys(file);
                this.validateNamedArgCalls(file);
            }
        });
    }

    private validateComputedAAKeys(file: BrsFile) {
        const { scope } = this.event;
        file.ast.walk(createVisitor({
            AAIndexedMemberExpression: (member) => {
                // Direct string literal (e.g. ["my-key"]) is valid
                if (isLiteralExpression(member.key)) {
                    if (member.key.token.kind !== TokenKind.StringLiteral) {
                        this.addMultiScopeDiagnostic({
                            file: file,
                            ...DiagnosticMessages.computedAAKeyMustBeStringExpression(),
                            range: member.key.range
                        });
                    }
                    return;
                }
                const parts = util.getDottedGetPath(member.key);
                if (parts.length === 0) {
                    this.addMultiScopeDiagnostic({
                        file: file,
                        ...DiagnosticMessages.computedPropertyKeyMustBeConstantExpression(),
                        range: member.key.range
                    });
                    return;
                }
                const enclosingNamespace = member.key.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase();
                const entityName = parts.map(p => p.name.text.toLowerCase()).join('.');
                // Check enum member
                const memberLink = scope.getEnumMemberFileLink(entityName, enclosingNamespace);
                if (memberLink) {
                    const value = memberLink.item.getValue();
                    if (!value?.startsWith('"')) {
                        this.addMultiScopeDiagnostic({
                            file: file,
                            ...DiagnosticMessages.computedAAKeyMustBeStringExpression(),
                            range: member.key.range
                        });
                    }
                    return;
                }
                // Check const — follow the chain to find the root literal type
                const constLink = scope.getConstFileLink(entityName, enclosingNamespace);
                if (constLink) {
                    if (!this.constResolvesToString(constLink.item.value, enclosingNamespace, scope)) {
                        this.addMultiScopeDiagnostic({
                            file: file,
                            ...DiagnosticMessages.computedAAKeyMustBeStringExpression(),
                            range: member.key.range
                        });
                    }
                    return;
                }
                this.addMultiScopeDiagnostic({
                    file: file,
                    ...DiagnosticMessages.computedPropertyKeyMustBeConstantExpression(),
                    range: member.key.range
                });
            }
        }), { walkMode: WalkMode.visitAllRecursive });
    }

    /**
     * Recursively resolve a const/enum reference to determine if its ultimate value is a string.
     * Returns true only if the value is confirmed to be a string.
     */
    private constResolvesToString(value: Expression, enclosingNamespace: string, scope: Scope, visited = new Set<string>()): boolean {
        if (isLiteralExpression(value)) {
            return value.token.kind === TokenKind.StringLiteral;
        }
        const parts = util.getDottedGetPath(value);
        if (parts.length === 0) {
            return false;
        }
        const entityName = parts.map(p => p.name.text.toLowerCase()).join('.');
        if (visited.has(entityName)) {
            return false; // circular reference — cannot confirm string
        }
        visited.add(entityName);
        const constLink = scope.getConstFileLink(entityName, enclosingNamespace);
        if (constLink) {
            return this.constResolvesToString(constLink.item.value, enclosingNamespace, scope, visited);
        }
        const memberLink = scope.getEnumMemberFileLink(entityName, enclosingNamespace);
        if (memberLink) {
            return this.constResolvesToString(memberLink.item.value, enclosingNamespace, scope, visited);
        }
        return false;
    }

    private expressionsByFile = new Cache<BrsFile, Readonly<ExpressionInfo>[]>();
    private iterateFileExpressions(file: BrsFile) {
        const { scope } = this.event;
        //build an expression collection ONCE per file
        const expressionInfos = this.expressionsByFile.getOrAdd(file, () => {
            const result: DeepWriteable<ExpressionInfo[]> = [];
            const expressions = [
                ...file.parser.references.expressions,
                //all class "extends <whatever>" expressions
                ...file.parser.references.classStatements.map(x => x.parentClassName?.expression),
                //all interface "extends <whatever>" expressions
                ...file.parser.references.interfaceStatements.map(x => x.parentInterfaceName?.expression)
            ];
            for (let expression of expressions) {
                if (!expression) {
                    continue;
                }

                //walk left-to-right on every expression, only keep the ones that start with VariableExpression, and then keep subsequent DottedGet parts
                const parts = util.getDottedGetPath(expression);

                if (parts.length > 0) {
                    result.push({
                        parts: parts,
                        expression: expression,
                        enclosingNamespaceNameLower: expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase()
                    });
                }
            }
            return result as unknown as Readonly<ExpressionInfo>[];
        });

        outer:
        for (const info of expressionInfos) {
            const symbolTable = info.expression.getSymbolTable();
            const firstPart = info.parts[0];
            const firstNamespacePart = info.parts[0].name.text;
            const firstNamespacePartLower = firstNamespacePart?.toLowerCase();
            //get the namespace container (accounting for namespace-relative as well)
            const namespaceContainer = scope.getNamespace(firstNamespacePartLower, info.enclosingNamespaceNameLower);

            //flag all unknown left-most variables
            if (
                !symbolTable?.hasSymbol(firstPart.name?.text) &&
                !namespaceContainer
            ) {
                //flag functions differently than all other variables
                if (isCallExpression(firstPart.parent) && firstPart.parent.callee === firstPart) {
                    this.addMultiScopeDiagnostic({
                        file: file as BscFile,
                        ...DiagnosticMessages.cannotFindFunction(firstPart.name?.text),
                        range: firstPart.name.range
                    });
                } else {
                    this.addMultiScopeDiagnostic({
                        file: file as BscFile,
                        ...DiagnosticMessages.cannotFindName(firstPart.name?.text),
                        range: firstPart.name.range
                    });
                }
                //skip to the next expression
                continue;
            }

            const enumStatement = scope.getEnum(firstNamespacePartLower, info.enclosingNamespaceNameLower);

            //if this isn't a namespace, skip it
            if (!namespaceContainer && !enumStatement) {
                continue;
            }

            //catch unknown namespace items
            let entityName = firstNamespacePart;
            let entityNameLower = firstNamespacePart.toLowerCase();
            for (let i = 1; i < info.parts.length; i++) {
                const part = info.parts[i];
                entityName += '.' + part.name.text;
                entityNameLower += '.' + part.name.text.toLowerCase();

                //if this is an enum member, stop validating here to prevent errors further down the chain
                if (scope.getEnumMemberFileLink(entityName, info.enclosingNamespaceNameLower)) {
                    break;
                }

                if (
                    !scope.getEnumMap().has(entityNameLower) &&
                    !scope.getClassMap().has(entityNameLower) &&
                    !scope.getConstMap().has(entityNameLower) &&
                    !scope.getCallableByName(entityNameLower) &&
                    !scope.getNamespace(entityNameLower, info.enclosingNamespaceNameLower)
                ) {
                    //if this looks like an enum, provide a nicer error message
                    const theEnum = this.getEnum(scope, entityNameLower)?.item;
                    if (theEnum) {
                        this.addMultiScopeDiagnostic({
                            file: file,
                            ...DiagnosticMessages.unknownEnumValue(part.name.text?.split('.').pop(), theEnum.fullName),
                            range: part.name.range,
                            relatedInformation: [{
                                message: 'Enum declared here',
                                location: util.createLocation(
                                    URI.file(file.srcPath).toString(),
                                    theEnum.tokens.name.range
                                )
                            }]
                        });
                    } else {
                        //flag functions differently than all other variables
                        if (isCallExpression(firstPart.parent) && firstPart.parent.callee === firstPart) {
                            this.addMultiScopeDiagnostic({
                                ...DiagnosticMessages.cannotFindFunction(part.name.text, entityName),
                                range: part.name.range,
                                file: file
                            });
                        } else {
                            this.addMultiScopeDiagnostic({
                                ...DiagnosticMessages.cannotFindName(part.name.text, entityName),
                                range: part.name.range,
                                file: file
                            });
                        }
                    }
                    //no need to add another diagnostic for future unknown items
                    continue outer;
                }
            }
            //if the full expression is a namespace path, this is an illegal statement because namespaces don't exist at runtme
            if (scope.getNamespace(entityNameLower, info.enclosingNamespaceNameLower)) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
                    range: info.expression.range,
                    file: file
                }, 'When used in scope');
            }
        }
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
                    ...DiagnosticMessages.duplicateEnumDeclaration(this.event.scope.name, fullName),
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
        this.event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Validate every function call to `CreateObject`.
     * Ideally we would create better type checking/handling for this, but in the mean time, we know exactly
     * what these calls are supposed to look like, and this is a very common thing for brs devs to do, so just
     * do this manually for now.
     */
    protected validateCreateObjectCalls(file: BrsFile) {
        const diagnostics: BsDiagnostic[] = [];

        for (const call of file?.functionCalls ?? []) {
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
                if (unquotedComponentName && !platformNodeNames.has(unquotedComponentName.toLowerCase()) && !this.event.program.getComponent(unquotedComponentName)) {
                    this.addDiagnosticOnce({
                        file: file as BscFile,
                        ...DiagnosticMessages.unknownRoSGNode(unquotedComponentName),
                        range: componentName.range
                    });
                } else if (call?.args.length !== 2) {
                    // roSgNode should only ever have 2 args in `createObject`
                    this.addDiagnosticOnce({
                        file: file as BscFile,
                        ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, [2], call?.args.length),
                        range: call.range
                    });
                }
            } else if (!platformComponentNames.has(firstParamStringValue.toLowerCase())) {
                this.addDiagnosticOnce({
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
                    this.addDiagnosticOnce({
                        file: file as BscFile,
                        ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, validArgCounts, call?.args.length),
                        range: call.range
                    });
                }

                // Test for deprecation
                if (brightScriptComponent.isDeprecated) {
                    this.addDiagnosticOnce({
                        file: file as BscFile,
                        ...DiagnosticMessages.deprecatedBrightScriptComponent(firstParamStringValue, brightScriptComponent.deprecatedDescription),
                        range: call.range
                    });
                }
            }
        }
        this.event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Validate calls that use named arguments.
     * Supports: simple variable calls, namespace function calls, and constructor calls (new MyClass()).
     */
    private validateNamedArgCalls(file: BrsFile) {
        const { scope } = this.event;
        const callableContainerMap: CallableContainerMap = util.getCallableContainersByLowerName(scope.getAllCallables());

        // Validate regular and namespace function calls
        for (const func of file.parser.references.functionExpressions) {
            for (const callExpr of func.callExpressions) {
                if (!callExpr.args.some(isNamedArgumentExpression)) {
                    continue;
                }

                let funcName: string;
                let params: FunctionParameterExpression[];

                if (isVariableExpression(callExpr.callee)) {
                    funcName = callExpr.callee.name.text;
                    const callable = callableContainerMap.get(funcName.toLowerCase())?.[0]?.callable;
                    if (!callable) {
                        this.addDiagnostic({
                            ...DiagnosticMessages.namedArgsNotAllowedForUnknownFunction(funcName),
                            range: callExpr.callee.range,
                            file: file
                        });
                        continue;
                    }
                    params = callable.functionStatement.func.parameters;
                    this.checkNamedArgCrossScopeConflict(funcName, callable, params, callExpr, file, scope);
                } else if (isDottedGetExpression(callExpr.callee)) {
                    // Namespace function call (e.g. MyNs.myFunc(a: 1))
                    const brsName = this.getNamespaceCallableBrsName(callExpr.callee, scope);
                    if (!brsName) {
                        this.addDiagnostic({
                            ...DiagnosticMessages.namedArgsNotAllowedForUnknownFunction((callExpr.callee as DottedGetExpression).name.text),
                            range: callExpr.callee.range,
                            file: file
                        });
                        continue;
                    }
                    const callable = callableContainerMap.get(brsName.toLowerCase())?.[0]?.callable;
                    if (!callable) {
                        const displayName = brsName.replace(/_/g, '.');
                        this.addDiagnostic({
                            ...DiagnosticMessages.namedArgsNotAllowedForUnknownFunction(displayName),
                            range: callExpr.callee.range,
                            file: file
                        });
                        continue;
                    }
                    funcName = brsName;
                    params = callable.functionStatement.func.parameters;
                } else {
                    this.addDiagnostic({
                        ...DiagnosticMessages.namedArgsNotAllowedForUnknownFunction((callExpr.callee as any)?.name?.text ?? '?'),
                        range: callExpr.openingParen.range,
                        file: file
                    });
                    continue;
                }

                this.validateNamedArgCallArgs(callExpr, params, funcName, file);
            }
        }

        // Validate constructor calls with named args (new MyClass(a: 1))
        for (const newExpr of file.parser.references.newExpressions) {
            const callExpr = newExpr.call;
            if (!callExpr.args.some(isNamedArgumentExpression)) {
                continue;
            }

            const className = newExpr.className.getName(ParseMode.BrighterScript);
            const containingNamespace = callExpr.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase();
            const classLink = scope.getClassFileLink(className, containingNamespace);
            if (!classLink) {
                this.addDiagnostic({
                    ...DiagnosticMessages.namedArgsNotAllowedForUnknownFunction(className),
                    range: callExpr.callee.range,
                    file: file
                });
                continue;
            }

            const params = this.getClassConstructorParams(classLink.item, scope, containingNamespace);
            this.validateNamedArgCallArgs(callExpr, params, className, file);
        }
    }

    /**
     * Validate the named argument list for a single call expression against the resolved parameter list.
     */
    private validateNamedArgCallArgs(callExpr: { args: Expression[]; callee: Expression; openingParen?: { range: any } }, params: FunctionParameterExpression[], funcName: string, file: BrsFile) {
        const assignedParams = new Set<number>();
        let seenNamedArg = false;
        let hasError = false;

        for (const arg of callExpr.args) {
            if (!isNamedArgumentExpression(arg)) {
                if (seenNamedArg) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.positionalArgAfterNamedArg(),
                        range: arg.range,
                        file: file
                    });
                    hasError = true;
                    continue;
                }
                const idx = assignedParams.size;
                if (idx < params.length) {
                    assignedParams.add(idx);
                }
            } else {
                seenNamedArg = true;
                const namedArg = arg as NamedArgumentExpression;
                const paramName = namedArg.name.text.toLowerCase();
                const paramIdx = params.findIndex(p => p.name.text.toLowerCase() === paramName);

                if (paramIdx < 0) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.unknownNamedArgument(namedArg.name.text, funcName),
                        range: namedArg.name.range,
                        file: file
                    });
                    hasError = true;
                    continue;
                }

                if (assignedParams.has(paramIdx)) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.namedArgDuplicate(namedArg.name.text),
                        range: namedArg.name.range,
                        file: file
                    });
                    hasError = true;
                    continue;
                }

                assignedParams.add(paramIdx);
            }
        }

        if (hasError) {
            return;
        }

        // Validate all required params are provided
        for (let i = 0; i < params.length; i++) {
            if (!assignedParams.has(i) && !params[i].defaultValue) {
                const minParams = params.filter(p => !p.defaultValue).length;
                const maxParams = params.length;
                this.addDiagnostic({
                    ...DiagnosticMessages.mismatchArgumentCount(
                        minParams === maxParams ? maxParams : `${minParams}-${maxParams}`,
                        callExpr.args.length
                    ),
                    range: callExpr.callee.range,
                    file: file
                });
                break;
            }
        }
    }

    /**
     * Emit a diagnostic if the same function name resolves to different parameter signatures
     * in other component scopes that share this file. Named arg transpilation is per-file
     * (using the first scope), so an ambiguous signature would produce incorrect output.
     */
    private checkNamedArgCrossScopeConflict(funcName: string, callable: Callable, params: FunctionParameterExpression[], callExpr: { callee: Expression }, file: BrsFile, scope: Scope) {
        for (const otherScope of this.event.program.getScopesForFile(file)) {
            if (otherScope === scope) {
                continue;
            }
            const otherCallable = otherScope.getCallableByName(funcName);
            if (!otherCallable) {
                continue;
            }
            // Guard against namespace functions that share a short name with our target
            if (otherCallable.getName(ParseMode.BrightScript).toLowerCase() !== funcName.toLowerCase()) {
                continue;
            }
            const otherParams = otherCallable.functionStatement?.func?.parameters;
            if (!otherParams) {
                continue;
            }
            if (!this.haveSameParamSignature(params, otherParams)) {
                const relatedInformation: DiagnosticRelatedInformation[] = [
                    {
                        message: `'${funcName}' defined in scope '${scope.name}'`,
                        location: util.createLocation(
                            URI.file(callable.file.srcPath).toString(),
                            callable.nameRange ?? callable.range
                        )
                    },
                    {
                        message: `'${funcName}' defined in scope '${otherScope.name}'`,
                        location: util.createLocation(
                            URI.file(otherCallable.file.srcPath).toString(),
                            otherCallable.nameRange ?? otherCallable.range
                        )
                    }
                ];
                this.addDiagnosticOnce({
                    ...DiagnosticMessages.namedArgsCrossScopeConflict(funcName),
                    range: callExpr.callee.range,
                    file: file,
                    relatedInformation: relatedInformation
                });
                break;
            }
        }
    }

    /**
     * Returns true if both parameter lists have the same names in the same order.
     */
    private haveSameParamSignature(p1: FunctionParameterExpression[], p2: FunctionParameterExpression[]): boolean {
        if (p1.length !== p2.length) {
            return false;
        }
        return p1.every((p, i) => p.name.text.toLowerCase() === p2[i].name.text.toLowerCase());
    }

    /**
     * If the callee is a dotted-get expression whose leftmost identifier is a known namespace,
     * returns the BrightScript-flattened name (e.g. "MyNs_myFunc"). Otherwise returns undefined.
     */
    private getNamespaceCallableBrsName(callee: DottedGetExpression, scope: Scope): string | undefined {
        const parts = util.getAllDottedGetParts(callee);
        if (!parts || !scope.namespaceLookup.has(parts[0].text.toLowerCase())) {
            return undefined;
        }
        return parts.map(p => p.text).join('_');
    }

    /**
     * Walk the class and its ancestor chain to find the first constructor's parameter list.
     * Returns an empty array if no constructor is defined anywhere in the hierarchy.
     */
    private getClassConstructorParams(classStmt: ClassStatement, scope: Scope, containingNamespace: string | undefined): FunctionParameterExpression[] {
        let stmt: ClassStatement | undefined = classStmt;
        while (stmt) {
            const ctor = stmt.body.find(
                s => (s as MethodStatement)?.name?.text?.toLowerCase() === 'new'
            ) as MethodStatement | undefined;
            if (ctor) {
                return ctor.func.parameters;
            }
            if (!stmt.parentClassName) {
                break;
            }
            const parentName = stmt.parentClassName.getName(ParseMode.BrighterScript);
            stmt = scope.getClassFileLink(parentName, containingNamespace)?.item;
        }
        return [];
    }

    /**
     * Adds a diagnostic to the first scope for this key. Prevents duplicate diagnostics
     * for diagnostics where scope isn't important. (i.e. CreateObject validations)
     */
    private addDiagnosticOnce(diagnostic: BsDiagnostic) {
        this.onceCache.getOrAdd(`${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
            this.event.scope.addDiagnostics([diagnostic]);
            return true;
        });
    }
    private onceCache = new Cache<string, boolean>();

    private addDiagnostic(diagnostic: BsDiagnostic) {
        this.event.scope.addDiagnostics([diagnostic]);
    }

    /**
     * Add a diagnostic (to the first scope) that will have `relatedInformation` for each affected scope
     */
    private addMultiScopeDiagnostic(diagnostic: BsDiagnostic, message = 'Not defined in scope') {
        diagnostic = this.multiScopeCache.getOrAdd(`${diagnostic.file?.srcPath}-${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
            if (!diagnostic.relatedInformation) {
                diagnostic.relatedInformation = [];
            }
            this.addDiagnostic(diagnostic);
            return diagnostic;
        });
        const info = {
            message: `${message} '${this.event.scope.name}'`
        } as DiagnosticRelatedInformation;
        if (isXmlScope(this.event.scope) && this.event.scope.xmlFile?.srcPath) {
            info.location = util.createLocation(
                URI.file(this.event.scope.xmlFile.srcPath).toString(),
                this.event.scope?.xmlFile?.ast?.component?.getAttribute('name')?.value.range ?? util.createRange(0, 0, 0, 10)
            );
        } else {
            info.location = util.createLocation(
                URI.file(diagnostic.file.srcPath).toString(),
                diagnostic.range
            );
        }
        diagnostic.relatedInformation.push(info);
    }

    private multiScopeCache = new Cache<string, BsDiagnostic>();
}

interface ExpressionInfo {
    parts: Readonly<[VariableExpression, ...DottedGetExpression[]]>;
    expression: Readonly<Expression>;
    /**
     * The full namespace name that encloses this expression
     */
    enclosingNamespaceNameLower?: string;
}
type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> };
