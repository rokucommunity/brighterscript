import { URI } from 'vscode-uri';
import { isAssignmentStatement, isAssociativeArrayType, isBrsFile, isCallableType, isClassStatement, isClassType, isDottedGetExpression, isDynamicType, isEnumMemberType, isEnumType, isFunctionExpression, isLiteralExpression, isNamespaceStatement, isNamespaceType, isObjectType, isPrimitiveType, isTypedFunctionType, isUnionType, isVariableExpression, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import { DiagnosticOrigin } from '../../interfaces';
import type { BsDiagnostic, BsDiagnosticWithOrigin, ExtraSymbolData, OnScopeValidateEvent, TypeChainEntry, TypeCompatibilityData } from '../../interfaces';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { AssignmentStatement, ClassStatement, DottedSetStatement, EnumStatement, NamespaceStatement, ReturnStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import type { AstNode } from '../../parser/AstNode';
import type { Expression } from '../../parser/AstNode';
import type { VariableExpression, DottedGetExpression, BinaryExpression, UnaryExpression } from '../../parser/Expression';
import { CallExpression } from '../../parser/Expression';
import { createVisitor } from '../../astUtils/visitors';
import type { BscType } from '../../types';
import type { BscFile } from '../../files/BscFile';
import { InsideSegmentWalkMode } from '../../AstValidationSegmenter';
import { TokenKind } from '../../lexer/TokenKind';
import { ParseMode } from '../../parser/Parser';
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
        if (this.event.program.globalScope === this.event.scope) {
            return;
        }
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
                const hasChangeInfo = this.event.changedFiles && this.event.changedSymbols;

                let thisFileRequiresChangedSymbol = false;
                for (let requiredSymbol of file.requiredSymbols) {
                    // eslint-disable-next-line no-bitwise
                    for (const flag of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
                        // eslint-disable-next-line no-bitwise
                        if (flag & requiredSymbol.flags) {
                            const changeSymbolSetForFlag = this.event.changedSymbols.get(flag);
                            if (util.setContainsUnresolvedSymbol(changeSymbolSetForFlag, requiredSymbol)) {
                                thisFileRequiresChangedSymbol = true;
                            }
                        }
                    }
                }
                const thisFileHasChanges = this.event.changedFiles.includes(file);
                if (hasChangeInfo && !thisFileRequiresChangedSymbol && !thisFileHasChanges) {
                    // this file does not require a symbol that has changed, and this file has not changed
                    return;
                }
                if (thisFileHasChanges) {
                    this.event.scope.clearAstSegmentDiagnosticsByFile(file);
                }

                const validationVisitor = createVisitor({
                    VariableExpression: (varExpr) => {
                        this.validateVariableAndDottedGetExpressions(file, varExpr);
                    },
                    DottedGetExpression: (dottedGet) => {
                        this.validateVariableAndDottedGetExpressions(file, dottedGet);
                    },
                    CallExpression: (functionCall) => {
                        this.validateFunctionCall(file, functionCall);
                        this.validateCreateObjectCall(file, functionCall);
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
                });
                const segmentsToWalkForValidation = (thisFileHasChanges || !hasChangeInfo)
                    ? file.validationSegmenter.segmentsForValidation // validate everything in the file
                    : file.getValidationSegments(this.event.changedSymbols); // validate only what's needed in the file

                for (const segment of segmentsToWalkForValidation) {
                    this.currentSegmentBeingValidated = segment;
                    this.event.scope.clearAstSegmentDiagnostics(segment);
                    segment.walk(validationVisitor, {
                        walkMode: InsideSegmentWalkMode
                    });
                    file.markSegmentAsValidated(segment);
                }
            }
        });
    }

    private currentSegmentBeingValidated: AstNode;


    private isTypeKnown(exprType: BscType) {
        let isKnownType = exprType?.isResolvable();
        return isKnownType;
    }

    /**
     * If this is the lhs of an assignment, we don't need to flag it as unresolved
     */
    private ignoreUnresolvedAssignmentLHS(expression: Expression, exprType: BscType, definingNode?: AstNode) {
        if (!isVariableExpression(expression)) {
            return false;
        }
        let assignmentAncestor: AssignmentStatement;
        if (isAssignmentStatement(definingNode) && definingNode.equals.kind === TokenKind.Equal) {
            // this symbol was defined in a "normal" assignment (eg. not a compound assignment)
            assignmentAncestor = definingNode;
            return assignmentAncestor?.name?.text.toLowerCase() === expression?.name?.text.toLowerCase();
        } else {
            assignmentAncestor = expression?.findAncestor(isAssignmentStatement);
        }
        return assignmentAncestor?.name === expression?.name && isUnionType(exprType);
    }

    /**
     * Flag duplicate enums
     */
    private detectDuplicateEnums() {
        const diagnostics: BsDiagnosticWithOrigin[] = [];
        const enumLocationsByName = new Cache<string, Array<{ file: BrsFile; statement: EnumStatement }>>();
        this.event.scope.enumerateBrsFiles((file) => {
            // eslint-disable-next-line @typescript-eslint/dot-notation
            for (const enumStatement of file['_cachedLookups'].enumStatements) {
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
                    }],
                    origin: DiagnosticOrigin.Scope
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
    protected validateCreateObjectCall(file: BrsFile, call: CallExpression) {

        //skip non CreateObject function calls
        const callName = util.getAllDottedGetPartsAsString(call.callee)?.toLowerCase();
        if (callName !== 'createobject' || !isLiteralExpression(call?.args[0])) {
            return;
        }
        const firstParamToken = (call?.args[0] as any)?.token;
        const firstParamStringValue = firstParamToken?.text?.replace(/"/g, '');
        //if this is a `createObject('roSGNode'` call, only support known sg node types
        if (firstParamStringValue?.toLowerCase() === 'rosgnode' && isLiteralExpression(call?.args[1])) {
            const componentName: Token = (call?.args[1] as any)?.token;
            //don't validate any components with a colon in their name (probably component libraries, but regular components can have them too).
            if (componentName?.text?.includes(':')) {
                return;
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

    /**
     * Detect calls to functions with the incorrect number of parameters, or wrong types of arguments
     */
    private validateFunctionCall(file: BrsFile, expression: CallExpression) {
        const getTypeOptions = { flags: SymbolTypeFlag.runtime, data: {} };
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
            if (funcType.isVariadic) {
                // function accepts variable number of arguments
                maxParams = CallExpression.MaximumArguments;
            }
            let expCallArgCount = expression.args.length;
            if (expCallArgCount > maxParams || expCallArgCount < minParams) {
                let minMaxParamsText = minParams === maxParams ? maxParams : `${minParams}-${maxParams}`;
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount),
                    range: expression.callee.range,
                    //TODO detect end of expression call
                    file: file
                });
            }
            let paramIndex = 0;
            for (let arg of expression.args) {
                const data = {} as ExtraSymbolData;
                let argType = arg.getType({ flags: SymbolTypeFlag.runtime, data: data });

                const paramType = funcType.params[paramIndex]?.type;
                if (!paramType) {
                    // unable to find a paramType -- maybe there are more args than params
                    break;
                }

                if (isCallableType(paramType) && isClassType(argType) && isClassStatement(data.definingNode)) {
                    // the param is expecting a function, but we're passing a Class... are we actually passing the constructor? then we're ok!
                    const namespace = expression.findAncestor<NamespaceStatement>(isNamespaceStatement);
                    if (file.calleeIsKnownFunction(arg, namespace?.getName(ParseMode.BrighterScript))) {
                        argType = data.definingNode.getConstructorType();
                    }
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
    }


    /**
     * Detect return statements with incompatible types vs. declared return type
     */
    private validateReturnStatement(file: BrsFile, returnStmt: ReturnStatement) {
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
    }

    /**
     * Detect return statements with incompatible types vs. declared return type
     */
    private validateDottedSetStatement(file: BrsFile, dottedSetStmt: DottedSetStatement) {
        const typeChainExpectedLHS = [] as TypeChainEntry[];
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        const expectedLHSType = dottedSetStmt?.getType({ ...getTypeOpts, data: {}, typeChain: typeChainExpectedLHS });
        const actualRHSType = dottedSetStmt?.value?.getType(getTypeOpts);
        const compatibilityData: TypeCompatibilityData = {};
        const typeChainScan = util.processTypeChain(typeChainExpectedLHS);
        // check if anything in typeChain is an AA - if so, just allow it
        if (typeChainExpectedLHS.find(typeChainItem => isAssociativeArrayType(typeChainItem.type))) {
            // something in the chain is an AA
            // treat members as dynamic - they could have been set without the type system's knowledge
            return;
        }
        if (!expectedLHSType?.isResolvable()) {
            this.addMultiScopeDiagnostic({
                file: file as BscFile,
                ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem),
                range: typeChainScan.range
            });
            return;
        }

        const accessibilityIsOk = this.checkMemberAccessibility(file, dottedSetStmt, typeChainExpectedLHS);

        if (accessibilityIsOk && !expectedLHSType?.isTypeCompatible(actualRHSType, compatibilityData)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.assignmentTypeMismatch(actualRHSType.toString(), expectedLHSType.toString(), compatibilityData),
                range: dottedSetStmt.range,
                file: file
            });
        }
    }
    /**
     * Detect invalid use of a binary operator
     */
    private validateBinaryExpression(file: BrsFile, binaryExpr: BinaryExpression) {
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        if (util.isInTypeExpression(binaryExpr)) {
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
    }

    /**
     * Detect invalid use of a Unary operator
     */
    private validateUnaryExpression(file: BrsFile, unaryExpr: UnaryExpression) {
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

        } else if (isDynamicType(rightTypeToTest) || isObjectType(rightTypeToTest)) {
            // operand is basically "any" type... ignore;

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
    }


    validateVariableAndDottedGetExpressions(file: BrsFile, expression: VariableExpression | DottedGetExpression) {
        if (isDottedGetExpression(expression.parent)) {
            // We validate dottedGetExpressions at the top-most level
            return;
        }
        if (isVariableExpression(expression)) {
            if (isAssignmentStatement(expression.parent) && expression.parent.name === expression.name) {
                // Don't validate LHS of assignments
                return;
            } else if (isNamespaceStatement(expression.parent)) {
                return;
            }
        }

        let symbolType = SymbolTypeFlag.runtime;
        let oppositeSymbolType = SymbolTypeFlag.typetime;
        const isUsedAsType = util.isInTypeExpression(expression);
        if (isUsedAsType) {
            // This is used in a TypeExpression - only look up types from SymbolTable
            symbolType = SymbolTypeFlag.typetime;
            oppositeSymbolType = SymbolTypeFlag.runtime;
        }

        // Do a complete type check on all DottedGet and Variable expressions
        // this will create a diagnostic if an invalid member is accessed
        const typeChain: TypeChainEntry[] = [];
        const typeData = {} as ExtraSymbolData;
        let exprType = expression.getType({
            flags: symbolType,
            typeChain: typeChain,
            data: typeData
        });

        const shouldIgnoreLHS = this.ignoreUnresolvedAssignmentLHS(expression, exprType, typeData?.definingNode);

        if (!this.isTypeKnown(exprType) && !shouldIgnoreLHS) {
            if (expression.getType({ flags: oppositeSymbolType })?.isResolvable()) {
                const oppoSiteTypeChain = [];
                const invalidlyUsedResolvedType = expression.getType({ flags: oppositeSymbolType, typeChain: oppoSiteTypeChain });
                const typeChainScan = util.processTypeChain(oppoSiteTypeChain);
                if (isUsedAsType) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.itemCannotBeUsedAsType(typeChainScan.fullChainName),
                        range: expression.range,
                        file: file
                    });
                } else {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.itemCannotBeUsedAsVariable(invalidlyUsedResolvedType.toString()),
                        range: expression.range,
                        file: file
                    });
                }

            } else {
                const typeChainScan = util.processTypeChain(typeChain);
                this.addMultiScopeDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem),
                    range: typeChainScan.range
                });
            }

        }
        if (isUsedAsType) {
            return;
        }
        const lastTypeInfo = typeChain[typeChain.length - 1];
        const parentTypeInfo = typeChain[typeChain.length - 2];

        this.checkMemberAccessibility(file, expression, typeChain);

        if (isNamespaceType(exprType)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
                range: expression.range,
                file: file
            });
        } else if (isEnumType(exprType)) {
            const enumStatement = this.event.scope.getEnum(util.getAllDottedGetPartsAsString(expression));
            if (enumStatement) {
                // there's an enum with this name
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable('enum'),
                    range: expression.range,
                    file: file
                });
            }
        } else if (isDynamicType(exprType) && isEnumType(parentTypeInfo?.type) && isDottedGetExpression(expression)) {
            const enumFileLink = this.event.scope.getEnumFileLink(util.getAllDottedGetPartsAsString(expression.obj));
            const typeChainScanForParent = util.processTypeChain(typeChain.slice(0, -1));
            if (enumFileLink) {
                this.addMultiScopeDiagnostic({
                    file: file,
                    ...DiagnosticMessages.unknownEnumValue(lastTypeInfo?.name, typeChainScanForParent.fullChainName),
                    range: lastTypeInfo?.range,
                    relatedInformation: [{
                        message: 'Enum declared here',
                        location: util.createLocation(
                            URI.file(enumFileLink?.file.srcPath).toString(),
                            enumFileLink?.item?.tokens.name.range
                        )
                    }]
                });
            }
        }
    }

    /**
     * Adds diagnostics for accibility mismatches
     *
     * @param file file
     * @param expression containing expression
     * @param typeChain type chain to check
     * @returns true if member accesiibility is okay
     */
    private checkMemberAccessibility(file: BscFile, expression: Expression, typeChain: TypeChainEntry[]) {
        for (let i = 0; i < typeChain.length - 1; i++) {
            const parentChainItem = typeChain[i];
            const childChainItem = typeChain[i + 1];
            if (isClassType(parentChainItem.type)) {
                const containingClassStmt = expression.findAncestor<ClassStatement>(isClassStatement);
                const classStmtThatDefinesChildMember = childChainItem.data?.definingNode?.findAncestor<ClassStatement>(isClassStatement);
                if (classStmtThatDefinesChildMember) {
                    const definingClassName = classStmtThatDefinesChildMember.getName(ParseMode.BrighterScript);
                    const inMatchingClassStmt = containingClassStmt?.getName(ParseMode.BrighterScript).toLowerCase() === parentChainItem.type.name.toLowerCase();
                    // eslint-disable-next-line no-bitwise
                    if (childChainItem.data.flags & SymbolTypeFlag.private) {
                        if (!inMatchingClassStmt || childChainItem.data.memberOfAncestor) {
                            this.addMultiScopeDiagnostic({
                                ...DiagnosticMessages.memberAccessibilityMismatch(childChainItem.name, childChainItem.data.flags, definingClassName),
                                range: expression.range,
                                file: file
                            });
                            // there's an error... don't worry about the rest of the chain
                            return false;
                        }
                    }

                    // eslint-disable-next-line no-bitwise
                    if (childChainItem.data.flags & SymbolTypeFlag.protected) {
                        const containingClassName = containingClassStmt?.getName(ParseMode.BrighterScript);
                        const containingNamespaceName = expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
                        const ancestorClasses = this.event.scope.getClassHierarchy(containingClassName, containingNamespaceName).map(link => link.item);
                        const isSubClassOfDefiningClass = ancestorClasses.includes(classStmtThatDefinesChildMember);

                        if (!isSubClassOfDefiningClass) {
                            this.addMultiScopeDiagnostic({
                                ...DiagnosticMessages.memberAccessibilityMismatch(childChainItem.name, childChainItem.data.flags, definingClassName),
                                range: expression.range,
                                file: file
                            });
                            // there's an error... don't worry about the rest of the chain
                            return false;
                        }
                    }
                }

            }
        }
        return true;
    }

    /**
     * Adds a diagnostic to the first scope for this key. Prevents duplicate diagnostics
     * for diagnostics where scope isn't important. (i.e. CreateObject validations)
     */
    private addDiagnosticOnce(diagnostic: BsDiagnostic) {
        this.onceCache.getOrAdd(`${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {
            const diagnosticWithOrigin = { ...diagnostic } as BsDiagnosticWithOrigin;
            if (!diagnosticWithOrigin.origin) {
                // diagnostic does not have origin.
                // set the origin to the current astSegment
                diagnosticWithOrigin.origin = DiagnosticOrigin.ASTSegment;
                diagnosticWithOrigin.astSegment = this.currentSegmentBeingValidated;
            }

            this.event.scope.addDiagnostics([diagnosticWithOrigin]);
            return true;
        });
    }
    private onceCache = new Cache<string, boolean>();

    private addDiagnostic(diagnostic: BsDiagnostic) {
        const diagnosticWithOrigin = { ...diagnostic } as BsDiagnosticWithOrigin;
        if (!diagnosticWithOrigin.origin) {
            // diagnostic does not have origin.
            // set the origin to the current astSegment
            diagnosticWithOrigin.origin = DiagnosticOrigin.ASTSegment;
            diagnosticWithOrigin.astSegment = this.currentSegmentBeingValidated;
        }

        this.event.scope.addDiagnostics([diagnosticWithOrigin]);
    }

    /**
     * Add a diagnostic (to the first scope) that will have `relatedInformation` for each affected scope
     */
    private addMultiScopeDiagnostic(diagnostic: BsDiagnostic) {
        diagnostic = this.multiScopeCache.getOrAdd(`${diagnostic.file?.srcPath}-${diagnostic.code}-${diagnostic.message}-${util.rangeToString(diagnostic.range)}`, () => {

            if (!diagnostic.relatedInformation) {
                diagnostic.relatedInformation = [];
            }

            const diagnosticWithOrigin = { ...diagnostic } as BsDiagnosticWithOrigin;
            if (!diagnosticWithOrigin.origin) {
                // diagnostic does not have origin.
                // set the origin to the current astSegment
                diagnosticWithOrigin.origin = DiagnosticOrigin.ASTSegment;
                diagnosticWithOrigin.astSegment = this.currentSegmentBeingValidated;
            }

            this.addDiagnostic(diagnosticWithOrigin);
            return diagnosticWithOrigin;
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

    private multiScopeCache = new Cache<string, BsDiagnosticWithOrigin>();
}
