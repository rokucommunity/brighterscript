import { URI } from 'vscode-uri';
import type { Range } from 'vscode-languageserver';
import { isAliasStatement, isAssignmentStatement, isAssociativeArrayType, isBrsFile, isCallExpression, isCallableType, isClassStatement, isClassType, isComponentType, isConstStatement, isDottedGetExpression, isDynamicType, isEnumMemberType, isEnumStatement, isEnumType, isFunctionExpression, isFunctionParameterExpression, isFunctionStatement, isInterfaceStatement, isLiteralExpression, isNamespaceStatement, isNamespaceType, isNewExpression, isObjectType, isPrimitiveType, isReferenceType, isStringType, isTypedFunctionType, isUnionType, isVariableExpression, isXmlScope } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import type { DiagnosticInfo } from '../../DiagnosticMessages';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic, CallableContainer, ExtraSymbolData, FileReference, OnScopeValidateEvent, TypeChainEntry, TypeCompatibilityData } from '../../interfaces';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import type { AssignmentStatement, ClassStatement, DottedSetStatement, EnumStatement, NamespaceStatement, ReturnStatement } from '../../parser/Statement';
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

    public processEvent(event: OnScopeValidateEvent) {
        this.event = event;
        if (this.event.program.globalScope === this.event.scope) {
            return;
        }
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, tag: ScopeValidatorDiagnosticTag });

        this.walkFiles();
        this.detectDuplicateEnums();
        this.flagDuplicateFunctionDeclarations();
        this.validateScriptImportPaths();
        this.validateClasses();
        if (isXmlScope(event.scope)) {
            //detect when the child imports a script that its ancestor also imports
            this.diagnosticDetectDuplicateAncestorScriptImports(event.scope);
            //validate component interface
            this.validateXmlInterface(event.scope);
        }
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
                this.detectNameCollisions(file);
            }
        });

        this.event.scope.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {
                const thisFileHasChanges = this.event.changedFiles.includes(file);

                const thisFileRequiresChangedSymbol = this.doesFileRequireChangedSymbol(file);

                const hasUnvalidatedSegments = file.validationSegmenter.hasUnvalidatedSegments();

                if (hasChangeInfo && !thisFileRequiresChangedSymbol && !thisFileHasChanges && !hasUnvalidatedSegments) {
                    // this file does not require a symbol that has changed, and this file has not changed

                    if (!this.doesFileAssignChangedSymbol(file)) {
                        // this file does not have a variable assignment that needs to be checked
                        return;
                    }

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
                            type: assignStmt.getType({ flags: SymbolTypeFlag.runtime }),
                            nameRange: assignStmt.tokens.name.range
                        });
                    },
                    NewExpression: (newExpr) => {
                        this.validateNewExpression(file, newExpr);
                    },
                    ForEachStatement: (forEachStmt) => {
                        this.detectShadowedLocalVar(file, {
                            name: forEachStmt.tokens.item.text,
                            type: forEachStmt.getType({ flags: SymbolTypeFlag.runtime }),
                            nameRange: forEachStmt.tokens.item.range
                        });
                    },
                    FunctionParameterExpression: (funcParam) => {
                        this.detectShadowedLocalVar(file, {
                            name: funcParam.tokens.name.text,
                            type: funcParam.getType({ flags: SymbolTypeFlag.runtime }),
                            nameRange: funcParam.tokens.name.range
                        });
                    }
                });
                const segmentsToWalkForValidation = (thisFileHasChanges || !hasChangeInfo)
                    ? file.validationSegmenter.segmentsForValidation // validate everything in the file
                    : file.getValidationSegments(this.event.changedSymbols); // validate only what's needed in the file

                for (const segment of segmentsToWalkForValidation) {
                    if (!file.validationSegmenter.checkIfSegmentNeedRevalidation(segment)) {
                        continue;
                    }
                    this.currentSegmentBeingValidated = segment;
                    this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, file: file, segment: segment });
                    segment.walk(validationVisitor, {
                        walkMode: InsideSegmentWalkMode
                    });
                    file.markSegmentAsValidated(segment);
                }
            }
        });
    }

    private doesFileRequireChangedSymbol(file: BrsFile) {
        let thisFileRequiresChangedSymbol = false;
        for (let requiredSymbol of file.requiredSymbols) {
            // eslint-disable-next-line no-bitwise
            for (const flag of [SymbolTypeFlag.runtime, SymbolTypeFlag.typetime]) {
                // eslint-disable-next-line no-bitwise
                if (flag & requiredSymbol.flags) {
                    const changeSymbolSetForFlag = this.event.changedSymbols.get(flag);
                    if (util.setContainsUnresolvedSymbol(changeSymbolSetForFlag, requiredSymbol)) {
                        thisFileRequiresChangedSymbol = true;
                        break;
                    }
                }
            }
        }
        return thisFileRequiresChangedSymbol;
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

    private doesFileAssignChangedSymbol(file: BrsFile) {
        let thisFileAssignsChangedSymbol = false;
        const runTimeChangedSymbolSet = this.event.changedSymbols.get(SymbolTypeFlag.runtime);
        for (let assignedSymbol of file.assignedSymbols) {
            if (runTimeChangedSymbolSet.has(assignedSymbol.token.text.toLowerCase())) {
                thisFileAssignsChangedSymbol = true;
                break;
            }
        }
        return thisFileAssignsChangedSymbol;
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
     * Flag duplicate enums
     */
    private detectDuplicateEnums() {
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
                this.addDiagnostic({
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

        let accessibilityIsOk = this.checkMemberAccessibility(file, dottedSetStmt, typeChainExpectedLHS);

        //special case for roSgNodeFont - these can accept string
        if (isComponentType(expectedLHSType) && expectedLHSType.name.toLowerCase() === 'font') {
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
        const expectedLHSType = assignStmt.typeExpression.getType({ ...getTypeOpts, data: {}, typeChain: typeChainExpectedLHS });
        const actualRHSType = assignStmt.value?.getType(getTypeOpts);
        const compatibilityData: TypeCompatibilityData = {};
        if (!expectedLHSType || !expectedLHSType.isResolvable()) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.cannotFindName(assignStmt.typeExpression.getName(ParseMode.BrighterScript)),
                range: assignStmt.typeExpression.range,
                file: file
            });
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
        let exprType = expression.getType({
            flags: symbolType,
            typeChain: typeChain,
            data: typeData
        });

        const hasValidDeclaration = this.hasValidDeclaration(expression, exprType, typeData?.definingNode);

        if (!this.isTypeKnown(exprType) && !hasValidDeclaration) {
            if (expression.getType({ flags: oppositeSymbolType, isExistenceTest: true })?.isResolvable()) {
                const oppoSiteTypeChain = [];
                const invalidlyUsedResolvedType = expression.getType({ flags: oppositeSymbolType, typeChain: oppoSiteTypeChain, isExistenceTest: true });
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
                    this.addMultiScopeDiagnostic({
                        file: file as BscFile,
                        ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem),
                        range: typeChainScan.range
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
                if (!tce.kind || ignoreKinds.includes(tce.kind)) {
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
        const newExprType = newExpression.getType({ flags: SymbolTypeFlag.typetime });
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

                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.duplicateFunctionImplementation(callable.name, callableContainer.scope.name),
                        range: callable.nameRange,
                        file: callable.file
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

                //find any functions that have the same name as a class
                const klassLink = this.event.scope.getClassFileLink(lowerFuncName);
                if (klassLink) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.functionCannotHaveSameNameAsClass(funcName),
                        range: func.nameRange,
                        file: file,
                        relatedInformation: [{
                            location: util.createLocation(
                                URI.file(klassLink.file.srcPath).toString(),
                                klassLink.item.tokens.name.range
                            ),
                            message: 'Original class declared here'
                        }]
                    });
                }
            }
        }
    }

    private detectNameCollisions(file: BrsFile) {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let nsStmt of file['_cachedLookups'].namespaceStatements) {
            this.validateNameCollision(file, nsStmt, nsStmt.getNameParts()?.[0]);

        }
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let classStmt of file['_cachedLookups'].classStatements) {
            this.validateNameCollision(file, classStmt, classStmt.tokens.name);

        }
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let ifaceStmt of file['_cachedLookups'].interfaceStatements) {
            this.validateNameCollision(file, ifaceStmt, ifaceStmt.tokens.name);

        }
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let constStmt of file['_cachedLookups'].constStatements) {
            this.validateNameCollision(file, constStmt, constStmt.tokens.name);
        }

        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let enumStmt of file['_cachedLookups'].enumStatements) {
            this.validateNameCollision(file, enumStmt, enumStmt.tokens.name);

        }
    }


    validateNameCollision(file: BrsFile, node: AstNode, nameIdentifier: Token) {
        const name = nameIdentifier?.text;
        if (!name || !node) {
            return;
        }
        const nameRange = nameIdentifier.range;

        const containingNamespace = node.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript);
        const containingNamespaceLower = containingNamespace?.toLowerCase();
        const links = this.event.scope.getAllFileLinks(name, containingNamespace, !isNamespaceStatement(node));
        for (let link of links) {
            if (!link || link.item === node) {
                // refers to same node
                continue;
            }
            if (isNamespaceStatement(link.item) && isNamespaceStatement(node)) {
                // namespace can be declared multiple times
                continue;
            }
            if (isFunctionStatement(link.item) || link.file?.destPath === 'global') {
                const linkItemNamespaceLower = link.item?.findAncestor<NamespaceStatement>(isNamespaceStatement)?.getName(ParseMode.BrighterScript)?.toLowerCase();
                if (!(containingNamespaceLower && linkItemNamespaceLower) || linkItemNamespaceLower !== containingNamespaceLower) {

                    // the thing found is a function OR from global (which is also a function)
                    if (isNamespaceStatement(node) ||
                        isEnumStatement(node) ||
                        isConstStatement(node) ||
                        isInterfaceStatement(node)) {
                        // these are not callable functions in transpiled code - ignore them
                        continue;
                    }
                }
            }

            const thisNodeKindName = util.getAstNodeFriendlyName(node);
            const thatNodeKindName = link.file.srcPath === 'global' ? 'Global Function' : util.getAstNodeFriendlyName(link.item) ?? '';

            let thatNameRange = (link.item as any)?.tokens?.name?.range ?? link.item?.range;

            if (isNamespaceStatement(link.item)) {
                thatNameRange = (link.item as NamespaceStatement).getNameParts()?.[0]?.range;
            }

            const relatedInformation = thatNameRange ? [{
                message: `${thatNodeKindName} declared here`,
                location: util.createLocation(
                    URI.file(link.file?.srcPath).toString(),
                    thatNameRange
                )
            }] : undefined;

            this.addMultiScopeDiagnostic({
                file: file,
                ...DiagnosticMessages.nameCollision(thisNodeKindName, thatNodeKindName, name),
                range: nameRange,
                relatedInformation: relatedInformation
            });
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
