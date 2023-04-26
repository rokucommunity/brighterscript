import { URI } from 'vscode-uri';
import { isBrsFile, isDottedGetExpression, isLiteralExpression, isNamespaceStatement, isTypeExpression, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, OnScopeValidateEvent } from '../../interfaces';
import type { EnumStatement, NamespaceStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import type { Scope } from '../../Scope';
import type { DiagnosticRelatedInformation } from 'vscode-languageserver';
import type { Expression } from '../../parser/AstNode';
import type { VariableExpression, DottedGetExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import { SymbolTypeFlags } from '../../SymbolTable';
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
            }
        });
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
            const fullName = info.parts.map(part => part.name.text).join('.');
            const firstPart = info.parts[0];
            const firstNamespacePart = info.parts[0].name.text;
            const firstNamespacePartLower = firstNamespacePart?.toLowerCase();
            //get the namespace container (accounting for namespace-relative as well)
            const namespaceContainer = scope.getNamespace(firstNamespacePartLower, info.enclosingNamespaceNameLower);
            let symbolType = SymbolTypeFlags.runtime;
            let oppositeSymbolType = SymbolTypeFlags.typetime;
            const isUsedAsType = info.expression.findAncestor(isTypeExpression);
            if (isUsedAsType) {
                // This is used in a TypeExpression - only look up types from SymbolTable
                symbolType = SymbolTypeFlags.typetime;
                oppositeSymbolType = SymbolTypeFlags.runtime;
            }
            let exprType = info.expression.getType(symbolType);
            if (!exprType || !exprType.isResolvable()) {
                if (info.expression.getType(oppositeSymbolType)?.isResolvable()) {
                    const invalidlyUsedResolvedTypeName = info.expression.getType(oppositeSymbolType).toString();
                    if (isUsedAsType) {

                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.itemCannotBeUsedAsType(fullName),
                            range: info.expression.range,
                            file: file
                        }, 'When used in scope');
                    } else {
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.itemCannotBeUsedAsVariable(invalidlyUsedResolvedTypeName),
                            range: info.expression.range,
                            file: file
                        }, 'When used in scope');
                    }
                    continue;
                }

                let fullErrorName = fullName;
                let lastName = info.parts[info.parts.length - 1].name.text;
                if (isDottedGetExpression(info.expression)) {
                    //TODO: Wrap deciphering a typeChain in a function, so that it cna handle multiple kinds of expressions
                    fullErrorName = '';
                    for (let i = 0; i < info.expression.typeChain.length; i++) {
                        const chainItem = info.expression.typeChain[i];
                        if (i > 0) {
                            fullErrorName += '.';
                        }
                        fullErrorName += chainItem.name;
                        lastName = chainItem.name;
                        if (!chainItem.resolved) {
                            break;
                        }
                    }
                }
                this.addMultiScopeDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.cannotFindName(lastName, fullErrorName),
                    range: info.expression.range
                });
                //skip to the next expression
                continue;
            }

            //flag all unknown left-most variables
            if (
                !symbolTable?.hasSymbol(firstPart.name?.text, symbolType) &&
                !namespaceContainer
            ) {
                this.addMultiScopeDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.cannotFindName(firstPart.name?.text),
                    range: firstPart.name.range
                });
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
                    !scope.getInterfaceMap().has(entityNameLower) &&
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
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.cannotFindName(part.name.text, entityName),
                            range: part.name.range,
                            file: file
                        });
                    }
                    //no need to add another diagnostic for future unknown items
                    continue outer;
                }
            }
            //if the full expression is just an enum name, this is an illegal statement because enums don't exist at runtime
            if (!isUsedAsType && enumStatement && info.parts.length === 1) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable('enum'),
                    range: info.expression.range,
                    file: file
                }, 'When used in scope');
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
