import { URI } from 'vscode-uri';
import { isAssignmentStatement, isBinaryExpression, isBrsFile, isClassType, isDynamicType, isEnumMemberType, isEnumType, isFunctionExpression, isLiteralExpression, isNamespaceStatement, isObjectType, isPrimitiveType, isTypeExpression, isTypedFunctionType, isUnionType, isVariableExpression, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BscFile, BsDiagnostic, OnScopeValidateEvent, TypeCompatibilityData } from '../../interfaces';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { AssignmentStatement, DottedSetStatement, EnumStatement, NamespaceStatement, ReturnStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import type { Scope } from '../../Scope';
import { type AstNode, type Expression } from '../../parser/AstNode';
import type { VariableExpression, DottedGetExpression, CallExpression, BinaryExpression, UnaryExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import { TokenKind } from '../../lexer/TokenKind';
import { WalkMode, createVisitor } from '../../astUtils/visitors';
import type { BscType } from '../../types';

/**
 * The lower-case names of all platform-included scenegraph nodes
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const platformNodeNames = nodes ? new Set((Object.values(nodes) as { name: string }[]).map(x => x?.name.toLowerCase())) : new Set();
const platformComponentNames = components ? new Set((Object.values(components) as { name: string }[]).map(x => x?.name.toLowerCase())) : new Set();

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
                file.ast.walk(createVisitor({
                    CallExpression: (functionCall) => {
                        this.validateFunctionCall(file, functionCall);
                    },
                    ReturnStatement: (returnStatement) => {
                        this.validateReturnStatement(file, returnStatement);
                    },
                    DottedSetStatement: (dottedSetStmt) => {
                        this.validateDottedSetStatement(file, dottedSetStmt);
                    },
                    BinaryExpression: (binaryExpr) => {
                        this.validateBinaryExpression(file, binaryExpr);
                    },
                    UnaryExpression: (unaryExpr) => {
                        this.validateUnaryExpression(file, unaryExpr);
                    }

                }), {
                    walkMode: WalkMode.visitAllRecursive
                });
            }
        });
    }


    private checkIfUsedAsTypeExpression(expression: AstNode): boolean {
        //TODO: this is much faster than node.findAncestor(), but will not work for "complicated" type expressions like UnionTypes
        if (isTypeExpression(expression) ||
            isTypeExpression(expression.parent)) {
            return true;
        }
        if (isBinaryExpression(expression.parent)) {
            let currentExpr: AstNode = expression.parent;
            while (isBinaryExpression(currentExpr) && currentExpr.operator.kind === TokenKind.Or) {
                currentExpr = currentExpr.parent;
            }
            return isTypeExpression(currentExpr);
        }
        return false;
    }

    private isTypeKnown(exprType: BscType) {
        let isKnownType = exprType?.isResolvable();
        return isKnownType;
    }

    /**
     * If this is the lhs of an assignment, we don't need to flag it as unresolved
     */
    private ignoreUnresolvedAssignmentLHS(expression: Expression, exprType: BscType) {
        if (!isVariableExpression(expression)) {
            return false;
        }
        const assignmentAncestor: AssignmentStatement = expression?.findAncestor(isAssignmentStatement);
        return assignmentAncestor?.name === expression?.name && isUnionType(exprType); // the left hand side is not a union, which means it was never assigned
    }

    private expressionsByFile = new Cache<BrsFile, Readonly<ExpressionInfo>[]>();
    private iterateFileExpressions(file: BrsFile) {
        const { scope } = this.event;
        //build an expression collection ONCE per file
        const expressionInfos = this.expressionsByFile.getOrAdd(file, () => {
            const result: DeepWriteable<ExpressionInfo[]> = [];
            const expressions = [...file.parser.references.expressions];
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
                        isUsedAsType: this.checkIfUsedAsTypeExpression(expression),
                        enclosingNamespaceNameLower: expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase()
                    });
                }
            }
            return result as unknown as Readonly<ExpressionInfo>[];
        });

        outer:
        for (const info of expressionInfos) {
            const firstNamespacePart = info.parts[0].name.text;
            const firstNamespacePartLower = firstNamespacePart?.toLowerCase();
            //get the namespace container (accounting for namespace-relative as well)
            const namespaceContainer = scope.getNamespace(firstNamespacePartLower, info.enclosingNamespaceNameLower);

            let symbolType = SymbolTypeFlag.runtime;
            let oppositeSymbolType = SymbolTypeFlag.typetime;
            if (info.isUsedAsType) {
                // This is used in a TypeExpression - only look up types from SymbolTable
                symbolType = SymbolTypeFlag.typetime;
                oppositeSymbolType = SymbolTypeFlag.runtime;
            }

            // Do a complete type check on all DottedGet and Variable expressions
            // this will create a diagnostic if an invalid member is accessed
            const typeChain = [];
            let exprType = info.expression.getType({
                flags: symbolType,
                typeChain: typeChain
            });

            if (!this.isTypeKnown(exprType) && !this.ignoreUnresolvedAssignmentLHS(info.expression, exprType)) {
                if (info.expression.getType({ flags: oppositeSymbolType })?.isResolvable()) {
                    const oppoSiteTypeChain = [];
                    const invalidlyUsedResolvedType = info.expression.getType({ flags: oppositeSymbolType, typeChain: oppoSiteTypeChain });
                    const typeChainScan = util.processTypeChain(oppoSiteTypeChain);
                    if (info.isUsedAsType) {
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.itemCannotBeUsedAsType(typeChainScan.fullChainName),
                            range: info.expression.range,
                            file: file
                        });
                    } else {
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.itemCannotBeUsedAsVariable(invalidlyUsedResolvedType.toString()),
                            range: info.expression.range,
                            file: file
                        });
                    }
                    continue;
                }

                const typeChainScan = util.processTypeChain(typeChain);
                this.addMultiScopeDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem),
                    range: typeChainScan.range
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
            if (!info.isUsedAsType && enumStatement && info.parts.length === 1) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable('enum'),
                    range: info.expression.range,
                    file: file
                });
            }

            //if the full expression is a namespace path, this is an illegal statement because namespaces don't exist at runtme
            if (scope.getNamespace(entityNameLower, info.enclosingNamespaceNameLower)) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
                    range: info.expression.range,
                    file: file
                });
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
     * Detect calls to functions with the incorrect number of parameters, or wrong types of arguments
     */
    private validateFunctionCall(file: BrsFile, expression: CallExpression) {
        const diagnostics: BsDiagnostic[] = [];
        const getTypeOptions = { flags: SymbolTypeFlag.runtime };
        let funcType = expression?.callee?.getType(getTypeOptions);
        if (funcType?.isResolvable() && isClassType(funcType)) {
            // We're calling a class - get the constructor
            funcType = funcType.getMemberType('new', getTypeOptions);
        }
        if (funcType?.isResolvable() && isTypedFunctionType(funcType)) {
            //funcType.setName(expression.callee. .name);

            //get min/max parameter count for callable
            let minParams = 0;
            let maxParams = 0;
            for (let param of funcType.params) {
                maxParams++;
                //optional parameters must come last, so we can assume that minParams won't increase once we hit
                //the first isOptional
                if (param.isOptional !== true) {
                    minParams++;
                }
            }
            let expCallArgCount = expression.args.length;
            if (expCallArgCount > maxParams || expCallArgCount < minParams) {
                let minMaxParamsText = minParams === maxParams ? maxParams : `${minParams}-${maxParams}`;
                diagnostics.push({
                    ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount),
                    range: expression.callee.range,
                    //TODO detect end of expression call
                    file: file
                });
            }
            let paramIndex = 0;
            for (let arg of expression.args) {
                const argType = arg.getType({ flags: SymbolTypeFlag.runtime });

                const paramType = funcType.params[paramIndex]?.type;
                if (!paramType) {
                    // unable to find a paramType -- maybe there are more args than params
                    break;
                }
                const compatibilityData: TypeCompatibilityData = {};
                if (!paramType?.isTypeCompatible(argType, compatibilityData)) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.argumentTypeMismatch(argType.toString(), paramType.toString(), compatibilityData),
                        range: arg.range,
                        //TODO detect end of expression call
                        file: file
                    });
                }
                paramIndex++;
            }

        }
        this.event.scope.addDiagnostics(diagnostics);
    }


    /**
     * Detect return statements with incompatible types vs. declared return type
     */
    private validateReturnStatement(file: BrsFile, returnStmt: ReturnStatement) {
        const diagnostics: BsDiagnostic[] = [];
        const getTypeOptions = { flags: SymbolTypeFlag.runtime };
        let funcType = returnStmt.findAncestor(isFunctionExpression).getType({ flags: SymbolTypeFlag.typetime });
        if (isTypedFunctionType(funcType)) {
            const actualReturnType = returnStmt.value?.getType(getTypeOptions);
            const compatibilityData: TypeCompatibilityData = {};

            if (actualReturnType && !funcType.returnType.isTypeCompatible(actualReturnType, compatibilityData)) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.returnTypeMismatch(actualReturnType.toString(), funcType.returnType.toString(), compatibilityData),
                    range: returnStmt.value.range,
                    file: file
                });

            }
        }
        this.event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Detect return statements with incompatible types vs. declared return type
     */
    private validateDottedSetStatement(file: BrsFile, dottedSetStmt: DottedSetStatement) {
        const diagnostics: BsDiagnostic[] = [];
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        const expectedLHSType = dottedSetStmt?.obj?.getType(getTypeOpts)?.getMemberType(dottedSetStmt.name.text, getTypeOpts);
        const actualRHSType = dottedSetStmt?.value?.getType(getTypeOpts);
        const compatibilityData: TypeCompatibilityData = {};

        if (expectedLHSType?.isResolvable() && !expectedLHSType?.isTypeCompatible(actualRHSType, compatibilityData)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.assignmentTypeMismatch(actualRHSType.toString(), expectedLHSType.toString(), compatibilityData),
                range: dottedSetStmt.range,
                file: file
            });
        }
        this.event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Detect invalid use of a binary operator
     */
    private validateBinaryExpression(file: BrsFile, binaryExpr: BinaryExpression) {
        const diagnostics: BsDiagnostic[] = [];
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        if (this.checkIfUsedAsTypeExpression(binaryExpr)) {
            return;
        }

        let leftType = binaryExpr.left.getType(getTypeOpts);
        let rightType = binaryExpr.right.getType(getTypeOpts);

        if (!leftType.isResolvable() || !rightType.isResolvable()) {
            // Can not find the type. error handled elsewhere
            return;
        }
        let leftTypeToTest = leftType;
        let rightTypeToTest = rightType;

        if (isEnumMemberType(leftType) || isEnumType(leftType)) {
            leftTypeToTest = leftType.underlyingType;
        }
        if (isEnumMemberType(rightType) || isEnumType(rightType)) {
            rightTypeToTest = rightType.underlyingType;
        }

        if (isUnionType(leftType) || isUnionType(rightType)) {
            // TODO: it is possible to validate based on innerTypes, but more complicated
            // Because you need to verify each combination of types
            return;
        }
        const leftIsPrimitive = isPrimitiveType(leftTypeToTest);
        const rightIsPrimitive = isPrimitiveType(rightTypeToTest);
        const leftIsAny = isDynamicType(leftTypeToTest) || isObjectType(leftTypeToTest);
        const rightIsAny = isDynamicType(rightTypeToTest) || isObjectType(rightTypeToTest);


        if (leftIsAny && rightIsAny) {
            // both operands are basically "any" type... ignore;
            return;
        } else if ((leftIsAny && rightIsPrimitive) || (leftIsPrimitive && rightIsAny)) {
            // one operand is basically "any" type... ignore;
            return;
        }
        const opResult = util.binaryOperatorResultType(leftTypeToTest, binaryExpr.operator, rightTypeToTest);

        if (isDynamicType(opResult)) {
            // if the result was dynamic, that means there wasn't a valid operation
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(binaryExpr.operator.text, leftType.toString(), rightType.toString()),
                range: binaryExpr.range,
                file: file
            });
        }

        this.event.scope.addDiagnostics(diagnostics);
    }

    /**
     * Detect invalid use of a Unary operator
     */
    private validateUnaryExpression(file: BrsFile, unaryExpr: UnaryExpression) {
        const diagnostics: BsDiagnostic[] = [];
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        let rightType = unaryExpr.right.getType(getTypeOpts);

        if (!rightType.isResolvable()) {
            // Can not find the type. error handled elsewhere
            return;
        }
        let rightTypeToTest = rightType;
        if (isEnumMemberType(rightType)) {
            rightTypeToTest = rightType.underlyingType;
        }
        if (isUnionType(rightTypeToTest)) {
            // TODO: it is possible to validate based on innerTypes, but more complicated
            // Because you need to verify each combination of types
            return;
        } else if (isDynamicType(rightTypeToTest) || isObjectType(rightTypeToTest)) {
            // operand is basically "any" type... ignore;
            return;
        } else if (isPrimitiveType(rightType)) {
            const opResult = util.unaryOperatorResultType(unaryExpr.operator, rightTypeToTest);
            if (isDynamicType(opResult)) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.operatorTypeMismatch(unaryExpr.operator.text, rightType.toString()),
                    range: unaryExpr.range,
                    file: file
                });
            }
        } else {
            // rhs is not a primitive, so no binary operator is allowed
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(unaryExpr.operator.text, rightType.toString()),
                range: unaryExpr.range,
                file: file
            });
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
    private addMultiScopeDiagnostic(diagnostic: BsDiagnostic) {
        diagnostic = this.multiScopeCache.getOrAdd(`${diagnostic.file?.srcPath}-${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
            if (!diagnostic.relatedInformation) {
                diagnostic.relatedInformation = [];
            }
            this.addDiagnostic(diagnostic);
            return diagnostic;
        });
        if (isXmlScope(this.event.scope) && this.event.scope.xmlFile?.srcPath) {
            diagnostic.relatedInformation.push({
                message: `In component scope '${this.event.scope?.xmlFile?.componentName?.text}'`,
                location: util.createLocation(
                    URI.file(this.event.scope.xmlFile.srcPath).toString(),
                    this.event.scope?.xmlFile?.ast?.componentElement?.getAttribute('name')?.tokens?.value?.range ?? util.createRange(0, 0, 0, 10)
                )
            });
        } else {
            diagnostic.relatedInformation.push({
                message: `In scope '${this.event.scope.name}'`,
                location: util.createLocation(
                    URI.file(diagnostic.file.srcPath).toString(),
                    diagnostic.range
                )
            });
        }
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
    /**
     * Determine if this expression is used as a type. This can be cached as part of the expression info since it only depends on AST syntax,
     * and does not depend on types from the scope
     */
    isUsedAsType: boolean;
}
type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> };
