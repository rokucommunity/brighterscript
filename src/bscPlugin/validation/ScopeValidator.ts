import { URI } from 'vscode-uri';
import { DiagnosticTag, type Range } from 'vscode-languageserver';
import { isAliasStatement, isAssignmentStatement, isAssociativeArrayType, isBinaryExpression, isBooleanType, isBrsFile, isCallExpression, isCallableType, isClassStatement, isClassType, isComponentType, isDottedGetExpression, isDynamicType, isEnumMemberType, isEnumType, isFunctionExpression, isFunctionParameterExpression, isLiteralExpression, isNamespaceStatement, isNamespaceType, isNewExpression, isNumberType, isObjectType, isPrimitiveType, isReferenceType, isStringType, isTypedFunctionType, isUnionType, isVariableExpression, isXmlScope } from '../../astUtils/reflection';
import type { DiagnosticInfo } from '../../DiagnosticMessages';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic, CallableContainer, ExtraSymbolData, FileReference, GetTypeOptions, OnScopeValidateEvent, TypeChainEntry, TypeChainProcessResult, TypeCompatibilityData } from '../../interfaces';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import type { AssignmentStatement, AugmentedAssignmentStatement, ClassStatement, DottedSetStatement, IncrementStatement, NamespaceStatement, ReturnStatement } from '../../parser/Statement';
import util from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import { AstNodeKind } from '../../parser/AstNode';
import type { AstNode } from '../../parser/AstNode';
import type { Expression } from '../../parser/AstNode';
import type { VariableExpression, DottedGetExpression, BinaryExpression, UnaryExpression, NewExpression } from '../../parser/Expression';
import { CallExpression } from '../../parser/Expression';
import { createVisitor } from '../../astUtils/visitors';
import type { BscType } from '../../types/BscType';
import type { BscFile } from '../../files/BscFile';
import { InsideSegmentWalkMode } from '../../AstValidationSegmenter';
import { TokenKind } from '../../lexer/TokenKind';
import { ParseMode } from '../../parser/Parser';
import { BsClassValidator } from '../../validators/ClassValidator';
import { globalCallableMap } from '../../globalCallables';
import type { XmlScope } from '../../XmlScope';
import type { XmlFile } from '../../files/XmlFile';
import { SGFieldTypes } from '../../parser/SGTypes';
import { DynamicType } from '../../types';
import { BscTypeKind } from '../../types/BscTypeKind';

/**
 * The lower-case names of all platform-included scenegraph nodes
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const platformNodeNames = nodes ? new Set((Object.values(nodes) as { name: string }[]).map(x => x?.name.toLowerCase())) : new Set();
const platformComponentNames = components ? new Set((Object.values(components) as { name: string }[]).map(x => x?.name.toLowerCase())) : new Set();

const ScopeValidatorDiagnosticTag = 'ScopeValidator';

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

    private metrics = new Map<string, number>();


    public processEvent(event: OnScopeValidateEvent) {
        this.event = event;
        if (this.event.program.globalScope === this.event.scope) {
            return;
        }
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, tag: ScopeValidatorDiagnosticTag });
        this.metrics.clear();
        this.walkFiles();
        this.flagDuplicateFunctionDeclarations();
        this.validateScriptImportPaths();
        this.validateClasses();
        if (isXmlScope(event.scope)) {
            //detect when the child imports a script that its ancestor also imports
            this.diagnosticDetectDuplicateAncestorScriptImports(event.scope);
            //validate component interface
            this.validateXmlInterface(event.scope);
        }

        this.event.program.logger.debug(this.event.scope.name, 'metrics:');
        let total = 0;
        for (const [filePath, num] of this.metrics) {
            this.event.program.logger.debug(' - ', filePath, num);
            total += num;
        }
        this.event.program.logger.debug(this.event.scope.name, 'total segments validated', total);
    }

    public reset() {
        this.event = undefined;
    }

    private walkFiles() {
        const hasChangeInfo = this.event.changedFiles && this.event.changedSymbols;

        //do many per-file checks for every file in this (and parent) scopes
        this.event.scope.enumerateBrsFiles((file) => {
            if (!isBrsFile(file)) {
                return;
            }

            const thisFileHasChanges = this.event.changedFiles.includes(file);

            if (thisFileHasChanges) {
                this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, file: file, tag: ScopeValidatorDiagnosticTag });
            }
            this.detectVariableNamespaceCollisions(file);

            if (thisFileHasChanges || this.doesFileProvideChangedSymbol(file, this.event.changedSymbols)) {
                this.diagnosticDetectFunctionCollisions(file);
            }
        });

        this.event.scope.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {
                const thisFileHasChanges = this.event.changedFiles.includes(file);

                const hasUnvalidatedSegments = file.validationSegmenter.hasUnvalidatedSegments();

                if (hasChangeInfo && !hasUnvalidatedSegments) {
                    return;
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
                    },
                    AssignmentStatement: (assignStmt) => {
                        this.validateAssignmentStatement(file, assignStmt);
                        // Note: this also includes For statements
                        this.detectShadowedLocalVar(file, {
                            name: assignStmt.tokens.name.text,
                            type: this.getNodeTypeWrapper(file, assignStmt, { flags: SymbolTypeFlag.runtime }),
                            nameRange: assignStmt.tokens.name.range
                        });
                    },
                    AugmentedAssignmentStatement: (binaryExpr) => {
                        this.validateBinaryExpression(file, binaryExpr);
                    },
                    IncrementStatement: (stmt) => {
                        this.validateIncrementStatement(file, stmt);
                    },
                    NewExpression: (newExpr) => {
                        this.validateNewExpression(file, newExpr);
                    },
                    ForEachStatement: (forEachStmt) => {
                        this.detectShadowedLocalVar(file, {
                            name: forEachStmt.tokens.item.text,
                            type: this.getNodeTypeWrapper(file, forEachStmt, { flags: SymbolTypeFlag.runtime }),
                            nameRange: forEachStmt.tokens.item.range
                        });
                    },
                    FunctionParameterExpression: (funcParam) => {
                        this.detectShadowedLocalVar(file, {
                            name: funcParam.tokens.name.text,
                            type: this.getNodeTypeWrapper(file, funcParam, { flags: SymbolTypeFlag.runtime }),
                            nameRange: funcParam.tokens.name.range
                        });
                    }
                });
                // validate only what's needed in the file

                const segmentsToWalkForValidation = thisFileHasChanges
                    ? file.validationSegmenter.getAllUnvalidatedSegments()
                    : file.validationSegmenter.getSegmentsWithChangedSymbols(this.event.changedSymbols);

                let segmentsValidated = 0;
                for (const segment of segmentsToWalkForValidation) {
                    if (!file.validationSegmenter.checkIfSegmentNeedsRevalidation(segment, this.event.changedSymbols)) {
                        continue;
                    }
                    this.currentSegmentBeingValidated = segment;
                    this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, file: file, segment: segment });
                    segmentsValidated++;
                    segment.walk(validationVisitor, {
                        walkMode: InsideSegmentWalkMode
                    });
                    file.markSegmentAsValidated(segment);
                }
                this.metrics.set(file.pkgPath, segmentsValidated);
            }
        });
    }

    private doesFileProvideChangedSymbol(file: BrsFile, changedSymbols: Map<SymbolTypeFlag, Set<string>>) {
        if (!changedSymbols) {
            return true;
        }
        for (const flag of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
            const providedSymbolKeysFlag = file.providedSymbols.symbolMap.get(flag).keys();
            const changedSymbolSetForFlag = changedSymbols.get(flag);

            for (let providedKey of providedSymbolKeysFlag) {
                if (changedSymbolSetForFlag.has(providedKey)) {
                    return true;
                }
            }
        }
        return false;
    }

    private currentSegmentBeingValidated: AstNode;


    private isTypeKnown(exprType: BscType) {
        let isKnownType = exprType?.isResolvable();
        return isKnownType;
    }

    /**
     * If this is the lhs of an assignment, we don't need to flag it as unresolved
     */
    private hasValidDeclaration(expression: Expression, exprType: BscType, definingNode?: AstNode) {
        if (!isVariableExpression(expression)) {
            return false;
        }
        let assignmentAncestor: AssignmentStatement;
        if (isAssignmentStatement(definingNode) && definingNode.tokens.equals.kind === TokenKind.Equal) {
            // this symbol was defined in a "normal" assignment (eg. not a compound assignment)
            assignmentAncestor = definingNode;
            return assignmentAncestor?.tokens.name?.text.toLowerCase() === expression?.tokens.name?.text.toLowerCase();
        } else if (isFunctionParameterExpression(definingNode)) {
            // this symbol was defined in a function param
            return true;
        } else {
            assignmentAncestor = expression?.findAncestor(isAssignmentStatement);
        }
        return assignmentAncestor?.tokens.name === expression?.tokens.name && isUnionType(exprType);
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
        const firstParamToken = (call?.args[0] as any)?.tokens?.value;
        const firstParamStringValue = firstParamToken?.text?.replace(/"/g, '');
        if (!firstParamStringValue) {
            return;
        }
        const firstParamStringValueLower = firstParamStringValue.toLowerCase();

        //if this is a `createObject('roSGNode'` call, only support known sg node types
        if (firstParamStringValueLower === 'rosgnode' && isLiteralExpression(call?.args[1])) {
            const componentName: Token = (call?.args[1] as any)?.tokens.value;
            //don't validate any components with a colon in their name (probably component libraries, but regular components can have them too).
            if (!componentName || componentName?.text?.includes(':')) {
                return;
            }
            //add diagnostic for unknown components
            const unquotedComponentName = componentName?.text?.replace(/"/g, '');
            if (unquotedComponentName && !platformNodeNames.has(unquotedComponentName.toLowerCase()) && !this.event.program.getComponent(unquotedComponentName)) {
                this.addDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.unknownRoSGNode(unquotedComponentName),
                    range: componentName.range
                });
            } else if (call?.args.length !== 2) {
                // roSgNode should only ever have 2 args in `createObject`
                this.addDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, [2], call?.args.length),
                    range: call.range
                });
            }
        } else if (!platformComponentNames.has(firstParamStringValueLower)) {
            this.addDiagnostic({
                file: file as BscFile,
                ...DiagnosticMessages.unknownBrightScriptComponent(firstParamStringValue),
                range: firstParamToken.range
            });
        } else {
            // This is valid brightscript component
            // Test for invalid arg counts
            const brightScriptComponent: BRSComponentData = components[firstParamStringValueLower];
            // Valid arg counts for createObject are 1+ number of args for constructor
            let validArgCounts = brightScriptComponent?.constructors.map(cnstr => cnstr.params.length + 1);
            if (validArgCounts.length === 0) {
                // no constructors for this component, so createObject only takes 1 arg
                validArgCounts = [1];
            }
            if (!validArgCounts.includes(call?.args.length)) {
                // Incorrect number of arguments included in `createObject()`
                this.addDiagnostic({
                    file: file as BscFile,
                    ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, validArgCounts, call?.args.length),
                    range: call.range
                });
            }

            // Test for deprecation
            if (brightScriptComponent?.isDeprecated) {
                this.addDiagnostic({
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
        let funcType = this.getNodeTypeWrapper(file, expression?.callee, getTypeOptions);
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
                let argType = this.getNodeTypeWrapper(file, arg, { flags: SymbolTypeFlag.runtime, data: data });

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
                const isAllowedArgConversion = this.checkAllowedArgConversions(paramType, argType);
                if (!isAllowedArgConversion && !paramType?.isTypeCompatible(argType, compatibilityData)) {
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

    private checkAllowedArgConversions(paramType: BscType, argType: BscType): boolean {
        if (isNumberType(argType) && isBooleanType(paramType)) {
            return true;
        }
        return false;
    }


    /**
     * Detect return statements with incompatible types vs. declared return type
     */
    private validateReturnStatement(file: BrsFile, returnStmt: ReturnStatement) {
        const getTypeOptions = { flags: SymbolTypeFlag.runtime };
        let funcType = returnStmt.findAncestor(isFunctionExpression).getType({ flags: SymbolTypeFlag.typetime });
        if (isTypedFunctionType(funcType)) {
            const actualReturnType = this.getNodeTypeWrapper(file, returnStmt?.value, getTypeOptions);
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
     * Detect assigned type different from expected member type
     */
    private validateDottedSetStatement(file: BrsFile, dottedSetStmt: DottedSetStatement) {
        const typeChainExpectedLHS = [] as TypeChainEntry[];
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        const expectedLHSType = this.getNodeTypeWrapper(file, dottedSetStmt, { ...getTypeOpts, data: {}, typeChain: typeChainExpectedLHS });
        const actualRHSType = this.getNodeTypeWrapper(file, dottedSetStmt?.value, getTypeOpts);
        const compatibilityData: TypeCompatibilityData = {};
        const typeChainScan = util.processTypeChain(typeChainExpectedLHS);
        // check if anything in typeChain is an AA - if so, just allow it
        if (typeChainExpectedLHS.find(typeChainItem => isAssociativeArrayType(typeChainItem.type))) {
            // something in the chain is an AA
            // treat members as dynamic - they could have been set without the type system's knowledge
            return;
        }
        if (!expectedLHSType || !expectedLHSType?.isResolvable()) {
            this.addMultiScopeDiagnostic({
                file: file as BscFile,
                ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                range: typeChainScan.range
            });
            return;
        }

        let accessibilityIsOk = this.checkMemberAccessibility(file, dottedSetStmt, typeChainExpectedLHS);

        //Most Component fields can be set with strings
        //TODO: be more precise about which fields can actually accept strings
        //TODO: if RHS is a string literal, we can do more validation to make sure it's the correct type
        if (isComponentType(dottedSetStmt.obj?.getType({ flags: SymbolTypeFlag.runtime }))) {
            if (isStringType(actualRHSType)) {
                return;
            }
        }

        if (accessibilityIsOk && !expectedLHSType?.isTypeCompatible(actualRHSType, compatibilityData)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.assignmentTypeMismatch(actualRHSType.toString(), expectedLHSType.toString(), compatibilityData),
                range: dottedSetStmt.range,
                file: file
            });
        }
    }

    /**
     * Detect when declared type does not match rhs type
     */
    private validateAssignmentStatement(file: BrsFile, assignStmt: AssignmentStatement) {
        if (!assignStmt?.typeExpression) {
            // nothing to check
            return;
        }

        const typeChainExpectedLHS = [];
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };
        const expectedLHSType = this.getNodeTypeWrapper(file, assignStmt.typeExpression, { ...getTypeOpts, data: {}, typeChain: typeChainExpectedLHS });
        const actualRHSType = this.getNodeTypeWrapper(file, assignStmt.value, getTypeOpts);
        const compatibilityData: TypeCompatibilityData = {};
        if (!expectedLHSType || !expectedLHSType.isResolvable()) {
            // LHS is not resolvable... handled elsewhere
        } else if (!expectedLHSType?.isTypeCompatible(actualRHSType, compatibilityData)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.assignmentTypeMismatch(actualRHSType.toString(), expectedLHSType.toString(), compatibilityData),
                range: assignStmt.range,
                file: file
            });
        }
    }

    /**
     * Detect invalid use of a binary operator
     */
    private validateBinaryExpression(file: BrsFile, binaryExpr: BinaryExpression | AugmentedAssignmentStatement) {
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        if (util.isInTypeExpression(binaryExpr)) {
            return;
        }

        let leftType = isBinaryExpression(binaryExpr)
            ? this.getNodeTypeWrapper(file, binaryExpr.left, getTypeOpts)
            : this.getNodeTypeWrapper(file, binaryExpr.item, getTypeOpts);
        let rightType = isBinaryExpression(binaryExpr)
            ? this.getNodeTypeWrapper(file, binaryExpr.right, getTypeOpts)
            : this.getNodeTypeWrapper(file, binaryExpr.value, getTypeOpts);

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
        const opResult = util.binaryOperatorResultType(leftTypeToTest, binaryExpr.tokens.operator, rightTypeToTest);

        if (isDynamicType(opResult)) {
            // if the result was dynamic, that means there wasn't a valid operation
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(binaryExpr.tokens.operator.text, leftType.toString(), rightType.toString()),
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

        let rightType = this.getNodeTypeWrapper(file, unaryExpr.right, getTypeOpts);

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
            const opResult = util.unaryOperatorResultType(unaryExpr.tokens.operator, rightTypeToTest);
            if (isDynamicType(opResult)) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.operatorTypeMismatch(unaryExpr.tokens.operator.text, rightType.toString()),
                    range: unaryExpr.range,
                    file: file
                });
            }
        } else {
            // rhs is not a primitive, so no binary operator is allowed
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(unaryExpr.tokens.operator.text, rightType.toString()),
                range: unaryExpr.range,
                file: file
            });
        }
    }

    private validateIncrementStatement(file: BrsFile, incStmt: IncrementStatement) {
        const getTypeOpts = { flags: SymbolTypeFlag.runtime };

        let rightType = this.getNodeTypeWrapper(file, incStmt.value, getTypeOpts);

        if (!rightType.isResolvable()) {
            // Can not find the type. error handled elsewhere
            return;
        }

        if (isUnionType(rightType)) {
            // TODO: it is possible to validate based on innerTypes, but more complicated
            // because you need to verify each combination of types
        } else if (isDynamicType(rightType) || isObjectType(rightType)) {
            // operand is basically "any" type... ignore
        } else if (isNumberType(rightType)) {
            // operand is a number.. this is ok
        } else {
            // rhs is not a number, so no increment operator is not allowed
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(incStmt.tokens.operator.text, rightType.toString()),
                range: incStmt.range,
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
            if (isAssignmentStatement(expression.parent) && expression.parent.tokens.name === expression.tokens.name) {
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
        let exprType = this.getNodeTypeWrapper(file, expression, {
            flags: symbolType,
            typeChain: typeChain,
            data: typeData
        });

        const hasValidDeclaration = this.hasValidDeclaration(expression, exprType, typeData?.definingNode);

        //include a hint diagnostic if this type is marked as deprecated
        if (typeData.flags & SymbolTypeFlag.deprecated) { // eslint-disable-line no-bitwise
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.itemIsDeprecated(),
                range: expression.tokens.name.range,
                file: file,
                tags: [DiagnosticTag.Deprecated]
            });
        }

        if (!this.isTypeKnown(exprType) && !hasValidDeclaration) {
            if (this.getNodeTypeWrapper(file, expression, { flags: oppositeSymbolType, isExistenceTest: true })?.isResolvable()) {
                const oppoSiteTypeChain = [];
                const invalidlyUsedResolvedType = this.getNodeTypeWrapper(file, expression, { flags: oppositeSymbolType, typeChain: oppoSiteTypeChain, isExistenceTest: true });
                const typeChainScan = util.processTypeChain(oppoSiteTypeChain);
                if (isUsedAsType) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.itemCannotBeUsedAsType(typeChainScan.fullChainName),
                        range: expression.range,
                        file: file
                    });
                } else if (invalidlyUsedResolvedType && !isReferenceType(invalidlyUsedResolvedType)) {
                    if (!isAliasStatement(expression.parent)) {
                        // alias rhs CAN be a type!
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.itemCannotBeUsedAsVariable(invalidlyUsedResolvedType.toString()),
                            range: expression.range,
                            file: file
                        });
                    }
                } else {
                    const typeChainScan = util.processTypeChain(typeChain);
                    //if this is a function call, provide a different diganostic code
                    if (isCallExpression(typeChainScan.astNode.parent) && typeChainScan.astNode.parent.callee === expression) {
                        this.addMultiScopeDiagnostic({
                            file: file as BscFile,
                            ...DiagnosticMessages.cannotFindFunction(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                            range: typeChainScan.range
                        });
                    } else {
                        this.addMultiScopeDiagnostic({
                            file: file as BscFile,
                            ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                            range: typeChainScan.range
                        });
                    }
                }

            } else {
                const typeChainScan = util.processTypeChain(typeChain);
                if (isCallExpression(typeChainScan.astNode.parent) && typeChainScan.astNode.parent.callee === expression) {
                    this.addMultiScopeDiagnostic({
                        file: file as BscFile,
                        ...DiagnosticMessages.cannotFindFunction(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                        range: typeChainScan.range
                    });
                } else {
                    this.addMultiScopeDiagnostic({
                        file: file as BscFile,
                        ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                        range: typeChainScan.range
                    });
                }

            }
        }
        if (isUsedAsType) {
            return;
        }

        const containingNamespaceName = expression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);

        if (!(isCallExpression(expression.parent) && isNewExpression(expression.parent?.parent))) {
            const classUsedAsVarEntry = this.checkTypeChainForClassUsedAsVar(typeChain, containingNamespaceName);
            if (classUsedAsVarEntry) {

                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable(classUsedAsVarEntry.toString()),
                    range: expression.range,
                    file: file
                });
                return;
            }
        }

        const lastTypeInfo = typeChain[typeChain.length - 1];
        const parentTypeInfo = typeChain[typeChain.length - 2];

        this.checkMemberAccessibility(file, expression, typeChain);

        if (isNamespaceType(exprType) && !isAliasStatement(expression.parent)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.itemCannotBeUsedAsVariable('namespace'),
                range: expression.range,
                file: file
            });
        } else if (isEnumType(exprType) && !isAliasStatement(expression.parent)) {
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

    private checkTypeChainForClassUsedAsVar(typeChain: TypeChainEntry[], containingNamespaceName: string) {
        const ignoreKinds = [AstNodeKind.TypecastExpression, AstNodeKind.NewExpression];
        let lowerNameSoFar = '';
        let classUsedAsVar;
        let isFirst = true;
        for (let i = 0; i < typeChain.length - 1; i++) { // do not look at final entry - we CAN use the constructor as a variable
            const tce = typeChain[i];
            lowerNameSoFar += `${lowerNameSoFar ? '.' : ''}${tce.name.toLowerCase()}`;
            if (!isNamespaceType(tce.type)) {
                if (isFirst && containingNamespaceName) {
                    lowerNameSoFar = `${containingNamespaceName.toLowerCase()}.${lowerNameSoFar}`;
                }
                if (!tce.astNode || ignoreKinds.includes(tce.astNode.kind)) {
                    break;
                } else if (isClassType(tce.type) && lowerNameSoFar.toLowerCase() === tce.type.name.toLowerCase()) {
                    classUsedAsVar = tce.type;
                }
                break;
            }
            isFirst = false;
        }

        return classUsedAsVar;
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
     * Find all "new" statements in the program,
     * and make sure we can find a class with that name
     */
    private validateNewExpression(file: BrsFile, newExpression: NewExpression) {
        const newExprType = this.getNodeTypeWrapper(file, newExpression, { flags: SymbolTypeFlag.typetime });
        if (isClassType(newExprType)) {
            return;
        }

        let potentialClassName = newExpression.className.getName(ParseMode.BrighterScript);
        const namespaceName = newExpression.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
        let newableClass = this.event.scope.getClass(potentialClassName, namespaceName);

        if (!newableClass) {
            //try and find functions with this name.
            let fullName = util.getFullyQualifiedClassName(potentialClassName, namespaceName);

            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.expressionIsNotConstructable(fullName),
                file: file,
                range: newExpression.className.range
            });

        }
    }

    /**
     * Create diagnostics for any duplicate function declarations
     */
    private flagDuplicateFunctionDeclarations() {

        //for each list of callables with the same name
        for (let [lowerName, callableContainers] of this.event.scope.getCallableContainerMap()) {

            let globalCallables = [] as CallableContainer[];
            let nonGlobalCallables = [] as CallableContainer[];
            let ownCallables = [] as CallableContainer[];
            let ancestorNonGlobalCallables = [] as CallableContainer[];

            for (let container of callableContainers) {
                if (container.scope === this.event.program.globalScope) {
                    globalCallables.push(container);
                } else {
                    nonGlobalCallables.push(container);
                    if (container.scope === this.event.scope) {
                        ownCallables.push(container);
                    } else {
                        ancestorNonGlobalCallables.push(container);
                    }
                }
            }

            //add info diagnostics about child shadowing parent functions
            if (ownCallables.length > 0 && ancestorNonGlobalCallables.length > 0) {
                for (let container of ownCallables) {
                    //skip the init function (because every component will have one of those){
                    if (lowerName !== 'init') {
                        let shadowedCallable = ancestorNonGlobalCallables[ancestorNonGlobalCallables.length - 1];
                        if (!!shadowedCallable && shadowedCallable.callable.file === container.callable.file) {
                            //same file: skip redundant imports
                            continue;
                        }
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.overridesAncestorFunction(
                                container.callable.name,
                                container.scope.name,
                                shadowedCallable.callable.file.destPath,
                                //grab the last item in the list, which should be the closest ancestor's version
                                shadowedCallable.scope.name
                            ),
                            range: container.callable.nameRange,
                            file: container.callable.file
                        });
                    }
                }
            }

            //add error diagnostics about duplicate functions in the same scope
            if (ownCallables.length > 1) {

                for (let callableContainer of ownCallables) {
                    let callable = callableContainer.callable;
                    const related = [];
                    for (const ownCallable of ownCallables) {
                        const thatNameRange = ownCallable.callable.nameRange;
                        if (ownCallable.callable.nameRange !== callable.nameRange) {
                            related.push({
                                message: `Function declared here`,
                                location: util.createLocation(
                                    URI.file(ownCallable.callable.file?.srcPath).toString(),
                                    thatNameRange
                                )
                            });
                        }
                    }

                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.duplicateFunctionImplementation(callable.name),
                        range: callable.nameRange,
                        file: callable.file,
                        relatedInformation: related
                    });
                }
            }
        }
    }

    /**
     * Verify that all of the scripts imported by each file in this scope actually exist, and have the correct case
     */
    private validateScriptImportPaths() {
        let scriptImports = this.event.scope.getOwnScriptImports();
        //verify every script import
        for (let scriptImport of scriptImports) {
            let referencedFile = this.event.scope.getFileByRelativePath(scriptImport.destPath);
            //if we can't find the file
            if (!referencedFile) {
                //skip the default bslib file, it will exist at transpile time but should not show up in the program during validation cycle
                if (scriptImport.destPath === this.event.program.bslibPkgPath) {
                    continue;
                }
                let dInfo: DiagnosticInfo;
                if (scriptImport.text.trim().length === 0) {
                    dInfo = DiagnosticMessages.scriptSrcCannotBeEmpty();
                } else {
                    dInfo = DiagnosticMessages.referencedFileDoesNotExist();
                }

                this.addMultiScopeDiagnostic({
                    ...dInfo,
                    range: scriptImport.filePathRange,
                    file: scriptImport.sourceFile
                });
                //if the character casing of the script import path does not match that of the actual path
            } else if (scriptImport.destPath !== referencedFile.destPath) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.scriptImportCaseMismatch(referencedFile.destPath),
                    range: scriptImport.filePathRange,
                    file: scriptImport.sourceFile
                });
            }
        }
    }

    /**
     * Validate all classes defined in this scope
     */
    private validateClasses() {
        let validator = new BsClassValidator(this.event.scope);
        validator.validate();
        for (const diagnostic of validator.diagnostics) {
            this.addMultiScopeDiagnostic({
                ...diagnostic
            });
        }
    }


    /**
     * Find various function collisions
     */
    private diagnosticDetectFunctionCollisions(file: BrsFile) {
        for (let func of file.callables) {
            const funcName = func.getName(ParseMode.BrighterScript);
            const lowerFuncName = funcName?.toLowerCase();
            if (lowerFuncName) {

                //find function declarations with the same name as a stdlib function
                if (globalCallableMap.has(lowerFuncName)) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction(),
                        range: func.nameRange,
                        file: file

                    });
                }
            }
        }
    }

    public detectShadowedLocalVar(file: BrsFile, varDeclaration: { name: string; type: BscType; nameRange: Range }) {
        const varName = varDeclaration.name;
        const lowerVarName = varName.toLowerCase();
        const callableContainerMap = this.event.scope.getCallableContainerMap();

        const varIsFunction = () => {
            return isCallableType(varDeclaration.type);
        };

        if (
            //has same name as stdlib
            globalCallableMap.has(lowerVarName)
        ) {
            //local var function with same name as stdlib function
            if (varIsFunction()) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                    range: varDeclaration.nameRange,
                    file: file
                });
            }
        } else if (callableContainerMap.has(lowerVarName)) {
            const callable = callableContainerMap.get(lowerVarName);
            //is same name as a callable
            if (varIsFunction()) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarFunctionShadowsParentFunction('scope'),
                    range: varDeclaration.nameRange,
                    file: file,
                    relatedInformation: [{
                        message: 'Function declared here',
                        location: util.createLocation(
                            URI.file(callable[0].callable.file.srcPath).toString(),
                            callable[0].callable.nameRange
                        )
                    }]
                });
            } else {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                    range: varDeclaration.nameRange,
                    file: file,
                    relatedInformation: [{
                        message: 'Function declared here',
                        location: util.createLocation(
                            URI.file(callable[0].callable.file.srcPath).toString(),
                            callable[0].callable.nameRange
                        )
                    }]
                });
            }
            //has the same name as an in-scope class
        } else {
            const classStmtLink = this.event.scope.getClassFileLink(lowerVarName);
            if (classStmtLink) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarSameNameAsClass(classStmtLink?.item?.getName(ParseMode.BrighterScript)),
                    range: varDeclaration.nameRange,
                    file: file,
                    relatedInformation: [{
                        message: 'Class declared here',
                        location: util.createLocation(
                            URI.file(classStmtLink.file.srcPath).toString(),
                            classStmtLink?.item.tokens.name.range
                        )
                    }]
                });
            }
        }
    }

    private detectVariableNamespaceCollisions(file: BrsFile) {
        //find all function parameters
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let func of file['_cachedLookups'].functionExpressions) {
            for (let param of func.parameters) {
                let lowerParamName = param.tokens.name.text.toLowerCase();
                let namespace = this.event.scope.getNamespace(lowerParamName, param.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript).toLowerCase());
                //see if the param matches any starting namespace part
                if (namespace) {
                    this.addMultiScopeDiagnostic({
                        file: file,
                        ...DiagnosticMessages.parameterMayNotHaveSameNameAsNamespace(param.tokens.name.text),
                        range: param.tokens.name.range,
                        relatedInformation: [{
                            message: 'Namespace declared here',
                            location: util.createLocation(
                                URI.file(namespace.file.srcPath).toString(),
                                namespace.nameRange
                            )
                        }]
                    });
                }
            }
        }

        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let assignment of file['_cachedLookups'].assignmentStatements) {
            let lowerAssignmentName = assignment.tokens.name.text.toLowerCase();
            let namespace = this.event.scope.getNamespace(lowerAssignmentName, assignment.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript).toLowerCase());
            //see if the param matches any starting namespace part
            if (namespace) {
                this.addMultiScopeDiagnostic({
                    file: file,
                    ...DiagnosticMessages.variableMayNotHaveSameNameAsNamespace(assignment.tokens.name.text),
                    range: assignment.tokens.name.range,
                    relatedInformation: [{
                        message: 'Namespace declared here',
                        location: util.createLocation(
                            URI.file(namespace.file.srcPath).toString(),
                            namespace.nameRange
                        )
                    }]
                });
            }
        }
    }

    private validateXmlInterface(scope: XmlScope) {
        if (!scope.xmlFile.parser.ast?.componentElement?.interfaceElement) {
            return;
        }
        const iface = scope.xmlFile.parser.ast.componentElement.interfaceElement;
        const callableContainerMap = scope.getCallableContainerMap();
        //validate functions
        for (const func of iface.functions) {
            const name = func.name;
            if (!name) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlTagMissingAttribute(func.tokens.startTagName.text, 'name'),
                    range: func.tokens.startTagName.range,
                    file: scope.xmlFile
                });
            } else if (!callableContainerMap.has(name.toLowerCase())) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlFunctionNotFound(name),
                    range: func.getAttribute('name')?.tokens.value.range,
                    file: scope.xmlFile
                });
            }
        }
        //validate fields
        for (const field of iface.fields) {
            const { id, type, onChange } = field;
            if (!id) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlTagMissingAttribute(field.tokens.startTagName.text, 'id'),
                    range: field.tokens.startTagName.range,
                    file: scope.xmlFile
                });
            }
            if (!type) {
                if (!field.alias) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.xmlTagMissingAttribute(field.tokens.startTagName.text, 'type'),
                        range: field.tokens.startTagName.range,
                        file: scope.xmlFile
                    });
                }
            } else if (!SGFieldTypes.includes(type.toLowerCase())) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlInvalidFieldType(type),
                    range: field.getAttribute('type')?.tokens.value.range,
                    file: scope.xmlFile
                });
            }
            if (onChange) {
                if (!callableContainerMap.has(onChange.toLowerCase())) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.xmlFunctionNotFound(onChange),
                        range: field.getAttribute('onchange')?.tokens.value.range,
                        file: scope.xmlFile
                    });
                }
            }
        }
    }

    /**
     * Detect when a child has imported a script that an ancestor also imported
     */
    private diagnosticDetectDuplicateAncestorScriptImports(scope: XmlScope) {
        if (scope.xmlFile.parentComponent) {
            //build a lookup of pkg paths -> FileReference so we can more easily look up collisions
            let parentScriptImports = scope.xmlFile.getAncestorScriptTagImports();
            let lookup = {} as Record<string, FileReference>;
            for (let parentScriptImport of parentScriptImports) {
                //keep the first occurance of a pkgPath. Parent imports are first in the array
                if (!lookup[parentScriptImport.destPath]) {
                    lookup[parentScriptImport.destPath] = parentScriptImport;
                }
            }

            //add warning for every script tag that this file shares with an ancestor
            for (let scriptImport of scope.xmlFile.scriptTagImports) {
                let ancestorScriptImport = lookup[scriptImport.destPath];
                if (ancestorScriptImport) {
                    let ancestorComponent = ancestorScriptImport.sourceFile as XmlFile;
                    let ancestorComponentName = ancestorComponent.componentName?.text ?? ancestorComponent.destPath;
                    this.addDiagnostic({
                        file: scope.xmlFile,
                        range: scriptImport.filePathRange,
                        ...DiagnosticMessages.unnecessaryScriptImportInChildFromParent(ancestorComponentName)
                    });
                }
            }
        }
    }

    /**
     * Wraps the AstNode.getType() method, so that we can do extra processing on the result based on the current file
     * In particular, since BrightScript does not support Unions, and there's no way to cast them to something else
     * if the result of .getType() is a union, and we're in a .brs (brightScript) file, treat the result as Dynamic
     *
     * In most cases, this returns the result of node.getType()
     *
     * @param file the current file being processed
     * @param node the node to get the type of
     * @param getTypeOpts any options to pass to node.getType()
     * @returns the processed result type
     */
    private getNodeTypeWrapper(file: BrsFile, node: AstNode, getTypeOpts: GetTypeOptions) {
        const type = node?.getType(getTypeOpts);

        if (file.parseMode === ParseMode.BrightScript) {
            // this is a brightscript file
            const typeChain = getTypeOpts.typeChain;
            if (typeChain) {
                const hasUnion = typeChain.reduce((hasUnion, tce) => {
                    return hasUnion || isUnionType(tce.type);
                }, false);
                if (hasUnion) {
                    // there was a union somewhere in the typechain
                    return DynamicType.instance;
                }
            }
            if (isUnionType(type)) {
                //this is a union
                return DynamicType.instance;
            }
        }

        // by default return the result of node.getType()
        return type;
    }

    private getParentTypeDescriptor(typeChainResult: TypeChainProcessResult) {
        if (typeChainResult.itemParentTypeKind === BscTypeKind.NamespaceType) {
            return 'namespace';
        }
        return 'type';
    }

    private addDiagnostic(diagnostic: BsDiagnostic) {
        this.event.program.diagnostics.register(diagnostic, {
            tags: [ScopeValidatorDiagnosticTag],
            segment: this.currentSegmentBeingValidated
        });
    }

    /**
     * Add a diagnostic (to the first scope) that will have `relatedInformation` for each affected scope
     */
    private addMultiScopeDiagnostic(diagnostic: BsDiagnostic) {
        this.event.program.diagnostics.register(diagnostic, {
            tags: [ScopeValidatorDiagnosticTag],
            segment: this.currentSegmentBeingValidated,
            scope: this.event.scope
        });
    }
}
