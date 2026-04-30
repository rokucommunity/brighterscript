import { URI } from 'vscode-uri';
import { isBrsFile, isCallExpression, isDottedGetExpression, isLiteralExpression, isNamespaceStatement, isVariableExpression, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, OnScopeValidateEvent } from '../../interfaces';
import type { ConstStatement, EnumStatement, NamespaceStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import { TokenKind } from '../../lexer/TokenKind';
import type { Scope } from '../../Scope';
import type { DiagnosticRelatedInformation } from 'vscode-languageserver';
import type { Expression } from '../../parser/AstNode';
import type { VariableExpression, DottedGetExpression } from '../../parser/Expression';
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
        this.detectCircularConstReferences();
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
     * Flag circular references between consts (e.g. const A = B; const B = A, or
     * aggregate cycles like const A = { x: B }; const B = { y: A }). Without this
     * check, the transpile pass silently emits unresolved refs at the cycle break
     * point, producing code that fails at runtime.
     *
     * Mirrors the existing class-hierarchy circular-reference detection: each const
     * starts its own walk, and an N-cycle produces N diagnostics (one rooted at
     * each member of the cycle).
     */
    private detectCircularConstReferences() {
        const scope = this.event.scope;
        const diagnostics: BsDiagnostic[] = [];

        const followConstRef = (
            expression: Expression,
            namespace: string | undefined,
            chain: ConstStatement[]
        ) => {
            const parts = util.splitExpression(expression);
            const processedNames: string[] = [];
            for (const part of parts) {
                if (!isVariableExpression(part) && !isDottedGetExpression(part)) {
                    return;
                }
                processedNames.push(part.name?.text?.toLowerCase());
                const link = scope.getConstFileLink(processedNames.join('.'), namespace);
                if (link) {
                    walkConst(link.item, link.file, chain);
                    return;
                }
            }
        };

        const walkConst = (
            constStatement: ConstStatement,
            file: BrsFile,
            chain: ConstStatement[]
        ) => {
            const cycleStart = chain.indexOf(constStatement);
            if (cycleStart >= 0) {
                const items = chain.slice(cycleStart).map(c => c.fullName).concat(constStatement.fullName);
                diagnostics.push({
                    ...DiagnosticMessages.circularReferenceDetected(items, scope.name),
                    file: file,
                    range: constStatement.tokens.name.range
                });
                return;
            }
            chain.push(constStatement);
            const innerNamespace = constStatement.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
            const value = constStatement.value;
            if (value) {
                if (isVariableExpression(value) || isDottedGetExpression(value)) {
                    followConstRef(value, innerNamespace, chain);
                } else {
                    value.walk(createVisitor({
                        VariableExpression: (varExpr) => {
                            if (isDottedGetExpression(varExpr.parent)) {
                                return;
                            }
                            followConstRef(varExpr, innerNamespace, chain);
                        },
                        DottedGetExpression: (dottedExpr) => {
                            if (isDottedGetExpression(dottedExpr.parent)) {
                                return;
                            }
                            followConstRef(dottedExpr, innerNamespace, chain);
                        }
                    }), { walkMode: WalkMode.visitExpressionsRecursive });
                }
            }
            chain.pop();
        };

        for (const [, link] of scope.getConstMap()) {
            walkConst(link.item, link.file, []);
        }
        scope.addDiagnostics(diagnostics);
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
