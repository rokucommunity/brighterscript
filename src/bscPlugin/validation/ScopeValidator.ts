import { DiagnosticTag, type Range } from 'vscode-languageserver';
import { isAliasStatement, isAssignmentStatement, isAssociativeArrayType, isBinaryExpression, isBooleanType, isBrsFile, isCallExpression, isCallFuncableType, isCallableType, isCallfuncExpression, isClassStatement, isClassType, isComponentType, isDottedGetExpression, isDynamicType, isEnumMemberType, isEnumType, isFunctionExpression, isFunctionParameterExpression, isLiteralExpression, isNamespaceStatement, isNamespaceType, isNewExpression, isNumberType, isObjectType, isPrimitiveType, isReferenceType, isReturnStatement, isStringTypeLike, isTypedFunctionType, isUnionType, isVariableExpression, isVoidType, isXmlScope } from '../../astUtils/reflection';
import type { DiagnosticInfo } from '../../DiagnosticMessages';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic, CallableContainer, ExtraSymbolData, FileReference, GetTypeOptions, OnScopeValidateEvent, TypeChainEntry, TypeChainProcessResult, TypeCompatibilityData } from '../../interfaces';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import type { AssignmentStatement, AugmentedAssignmentStatement, ClassStatement, DottedSetStatement, IncrementStatement, NamespaceStatement, ReturnStatement } from '../../parser/Statement';
import { util } from '../../util';
import { nodes, components } from '../../roku-types';
import type { BRSComponentData } from '../../roku-types';
import type { Token } from '../../lexer/Token';
import { AstNodeKind } from '../../parser/AstNode';
import type { AstNode } from '../../parser/AstNode';
import type { Expression } from '../../parser/AstNode';
import type { VariableExpression, DottedGetExpression, BinaryExpression, UnaryExpression, NewExpression, LiteralExpression, FunctionExpression, CallfuncExpression } from '../../parser/Expression';
import { CallExpression } from '../../parser/Expression';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
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
import { DynamicType } from '../../types/DynamicType';
import { BscTypeKind } from '../../types/BscTypeKind';
import type { BrsDocWithType } from '../../parser/BrightScriptDocParser';
import brsDocParser from '../../parser/BrightScriptDocParser';
import type { Location } from 'vscode-languageserver';
import { InvalidType } from '../../types/InvalidType';
import { VoidType } from '../../types/VoidType';
import { LogLevel } from '../../Logger';
import { Stopwatch } from '../../Stopwatch';
import chalk from 'chalk';

/**
 * The lower-case names of all platform-included scenegraph nodes
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const platformNodeNames = nodes ? new Set((Object.values(nodes) as { name: string }[]).map(x => x?.name.toLowerCase())) : new Set();
const platformComponentNames = components ? new Set((Object.values(components) as { name: string }[]).map(x => x?.name.toLowerCase())) : new Set();

const enum ScopeValidatorDiagnosticTag {
    Imports = 'ScopeValidatorImports',
    NamespaceCollisions = 'ScopeValidatorNamespaceCollisions',
    DuplicateFunctionDeclaration = 'ScopeValidatorDuplicateFunctionDeclaration',
    FunctionCollisions = 'ScopeValidatorFunctionCollisions',
    Classes = 'ScopeValidatorClasses',
    XMLInterface = 'ScopeValidatorXML',
    XMLImports = 'ScopeValidatorXMLImports',
    Default = 'ScopeValidator',
    Segment = 'ScopeValidatorSegment'
}

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

    private segmentsMetrics = new Map<string, { segments: number; time: string }>();
    private validationKindsMetrics = new Map<string, { timeMs: number; count: number }>();

    public processEvent(event: OnScopeValidateEvent) {
        this.event = event;
        if (this.event.program.globalScope === this.event.scope) {
            return;
        }
        const logger = this.event.program.logger;
        const metrics = {
            fileWalkTime: '',
            flagDuplicateFunctionTime: '',
            classValidationTime: '',
            scriptImportValidationTime: '',
            xmlValidationTime: ''
        };
        this.segmentsMetrics.clear();
        this.validationKindsMetrics.clear();
        const validationStopwatch = new Stopwatch();

        logger.time(LogLevel.debug, ['Validating scope', this.event.scope.name], () => {
            metrics.fileWalkTime = validationStopwatch.getDurationTextFor(() => {
                this.walkFiles();
            }).durationText;
            this.currentSegmentBeingValidated = null;
            metrics.flagDuplicateFunctionTime = validationStopwatch.getDurationTextFor(() => {
                this.flagDuplicateFunctionDeclarations();
            }).durationText;
            metrics.scriptImportValidationTime = validationStopwatch.getDurationTextFor(() => {
                this.validateScriptImportPaths();
            }).durationText;
            metrics.classValidationTime = validationStopwatch.getDurationTextFor(() => {
                this.validateClasses();
            }).durationText;
            metrics.xmlValidationTime = validationStopwatch.getDurationTextFor(() => {
                if (isXmlScope(this.event.scope)) {
                    //detect when the child imports a script that its ancestor also imports
                    this.diagnosticDetectDuplicateAncestorScriptImports(this.event.scope);
                    //validate component interface
                    this.validateXmlInterface(this.event.scope);
                }
            }).durationText;
        });
        logger.debug(this.event.scope.name, 'segment metrics:');
        let totalSegments = 0;
        for (const [filePath, metric] of this.segmentsMetrics) {
            this.event.program.logger.debug(' - ', filePath, metric.segments, metric.time);
            totalSegments += metric.segments;
        }
        logger.debug(this.event.scope.name, 'total segments validated', totalSegments);
        this.logValidationMetrics(metrics);
    }

    // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
    private logValidationMetrics(metrics: { [key: string]: number | string }) {
        let logs = [] as string[];
        for (let key in metrics) {
            logs.push(`${key}=${chalk.yellow(metrics[key].toString())}`);
        }
        this.event.program.logger.debug(`Validation Metrics (Scope: ${this.event.scope.name}): ${logs.join(', ')}`);
        let kindsLogs = [] as string[];
        const kindsArray = Array.from(this.validationKindsMetrics.keys()).sort();
        for (let key of kindsArray) {
            const timeData = this.validationKindsMetrics.get(key);
            kindsLogs.push(`${key}=${chalk.yellow(timeData.timeMs.toFixed(3).toString()) + 'ms'} (${timeData.count})`);
        }
        this.event.program.logger.debug(`Validation Walk Metrics (Scope: ${this.event.scope.name}): ${kindsLogs.join(', ')}`);
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

            if (thisFileHasChanges || this.doesFileProvideChangedSymbol(file, this.event.changedSymbols)) {
                this.diagnosticDetectFunctionCollisions(file);
            }
        });
        const fileWalkStopWatch = new Stopwatch();

        this.event.scope.enumerateOwnFiles((file) => {
            if (isBrsFile(file)) {

                if (this.event.program.diagnostics.shouldFilterFile(file)) {
                    return;
                }

                fileWalkStopWatch.reset();
                fileWalkStopWatch.start();

                const fileUri = util.pathToUri(file.srcPath);
                const thisFileHasChanges = this.event.changedFiles.includes(file);

                const hasUnvalidatedSegments = file.validationSegmenter.hasUnvalidatedSegments();

                if (hasChangeInfo && !hasUnvalidatedSegments) {
                    return;
                }

                const validationVisitor = createVisitor({
                    VariableExpression: (varExpr) => {
                        this.addValidationKindMetric('VariableExpression', () => {
                            this.validateVariableAndDottedGetExpressions(file, varExpr);
                        });
                    },
                    DottedGetExpression: (dottedGet) => {
                        this.addValidationKindMetric('DottedGetExpression', () => {
                            this.validateVariableAndDottedGetExpressions(file, dottedGet);
                        });
                    },
                    CallExpression: (functionCall) => {
                        this.addValidationKindMetric('CallExpression', () => {
                            this.validateCallExpression(file, functionCall);
                            this.validateCreateObjectCall(file, functionCall);
                            this.validateComponentMethods(file, functionCall);
                        });
                    },
                    CallfuncExpression: (functionCall) => {
                        this.addValidationKindMetric('CallfuncExpression', () => {
                            this.validateCallFuncExpression(file, functionCall);
                        });
                    },
                    ReturnStatement: (returnStatement) => {
                        this.addValidationKindMetric('ReturnStatement', () => {
                            this.validateReturnStatement(file, returnStatement);
                        });
                    },
                    DottedSetStatement: (dottedSetStmt) => {
                        this.addValidationKindMetric('DottedSetStatement', () => {
                            this.validateDottedSetStatement(file, dottedSetStmt);
                        });
                    },
                    BinaryExpression: (binaryExpr) => {
                        this.addValidationKindMetric('BinaryExpression', () => {
                            this.validateBinaryExpression(file, binaryExpr);
                        });
                    },
                    UnaryExpression: (unaryExpr) => {
                        this.addValidationKindMetric('UnaryExpression', () => {
                            this.validateUnaryExpression(file, unaryExpr);
                        });
                    },
                    AssignmentStatement: (assignStmt) => {
                        this.addValidationKindMetric('AssignmentStatement', () => {
                            this.validateAssignmentStatement(file, assignStmt);
                            // Note: this also includes For statements
                            this.detectShadowedLocalVar(file, {
                                expr: assignStmt,
                                name: assignStmt.tokens.name.text,
                                type: this.getNodeTypeWrapper(file, assignStmt, { flags: SymbolTypeFlag.runtime }),
                                nameRange: assignStmt.tokens.name.location?.range
                            });
                        });
                    },
                    AugmentedAssignmentStatement: (binaryExpr) => {
                        this.addValidationKindMetric('AugmentedAssignmentStatement', () => {
                            this.validateBinaryExpression(file, binaryExpr);
                        });
                    },
                    IncrementStatement: (stmt) => {
                        this.addValidationKindMetric('IncrementStatement', () => {
                            this.validateIncrementStatement(file, stmt);
                        });
                    },
                    NewExpression: (newExpr) => {
                        this.addValidationKindMetric('NewExpression', () => {
                            this.validateNewExpression(file, newExpr);
                        });
                    },
                    ForEachStatement: (forEachStmt) => {
                        this.addValidationKindMetric('ForEachStatement', () => {
                            this.detectShadowedLocalVar(file, {
                                expr: forEachStmt,
                                name: forEachStmt.tokens.item.text,
                                type: this.getNodeTypeWrapper(file, forEachStmt, { flags: SymbolTypeFlag.runtime }),
                                nameRange: forEachStmt.tokens.item.location?.range
                            });
                        });
                    },
                    FunctionParameterExpression: (funcParam) => {
                        this.addValidationKindMetric('FunctionParameterExpression', () => {
                            this.detectShadowedLocalVar(file, {
                                expr: funcParam,
                                name: funcParam.tokens.name.text,
                                type: this.getNodeTypeWrapper(file, funcParam, { flags: SymbolTypeFlag.runtime }),
                                nameRange: funcParam.tokens.name.location?.range
                            });
                        });
                    },
                    FunctionExpression: (func) => {
                        if (file.isTypedef) {
                            return;
                        }
                        this.addValidationKindMetric('FunctionExpression', () => {
                            this.validateFunctionExpressionForReturn(func);
                        });
                    },
                    AstNode: (node) => {
                        //check for doc comments
                        if (!node.leadingTrivia || node.leadingTrivia.filter(triviaToken => triviaToken.kind === TokenKind.Comment).length === 0) {
                            return;
                        }
                        this.addValidationKindMetric('AstNode', () => {
                            this.validateDocComments(node);
                        });
                    }
                });
                // validate only what's needed in the file

                const segmentsToWalkForValidation = thisFileHasChanges
                    ? file.validationSegmenter.getAllUnvalidatedSegments()
                    : file.validationSegmenter.getSegmentsWithChangedSymbols(this.event.changedSymbols);

                let segmentsValidated = 0;

                if (thisFileHasChanges) {
                    // clear all ScopeValidatorSegment diagnostics for this file
                    this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, fileUri: fileUri, tag: ScopeValidatorDiagnosticTag.Segment });
                }


                for (const segment of segmentsToWalkForValidation) {
                    if (!thisFileHasChanges && !file.validationSegmenter.checkIfSegmentNeedsRevalidation(segment, this.event.changedSymbols)) {
                        continue;
                    }
                    this.currentSegmentBeingValidated = segment;
                    if (!thisFileHasChanges) {
                        // just clear the affected diagnostics
                        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, fileUri: fileUri, segment: segment, tag: ScopeValidatorDiagnosticTag.Segment });
                    }
                    segmentsValidated++;
                    segment.walk(validationVisitor, {
                        walkMode: InsideSegmentWalkMode
                    });
                    file.markSegmentAsValidated(segment);
                    this.currentSegmentBeingValidated = null;
                }
                fileWalkStopWatch.stop();
                const timeString = fileWalkStopWatch.getDurationText();
                this.segmentsMetrics.set(file.pkgPath, { segments: segmentsValidated, time: timeString });
            }
        });
    }

    private addValidationKindMetric(name: string, funcToTime: () => void) {
        if (!this.validationKindsMetrics.has(name)) {
            this.validationKindsMetrics.set(name, { timeMs: 0, count: 0 });
        }
        const timeData = this.validationKindsMetrics.get(name);
        const validationKindStopWatch = new Stopwatch();
        validationKindStopWatch.start();
        funcToTime();
        validationKindStopWatch.stop();
        this.validationKindsMetrics.set(name, { timeMs: timeData.timeMs + validationKindStopWatch.totalMilliseconds, count: timeData.count + 1 });
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

    private getCircularReference(exprType: BscType) {
        if (exprType?.isResolvable()) {
            return { isCircularReference: false };
        }
        if (isReferenceType(exprType)) {

            const info = exprType.getCircularReferenceInfo();
            return info;
        }
        return { isCircularReference: false };
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
        const firstParamToken = (call?.args[0] as LiteralExpression)?.tokens?.value;
        const firstParamStringValue = firstParamToken?.text?.replace(/"/g, '');
        if (!firstParamStringValue) {
            return;
        }
        const firstParamStringValueLower = firstParamStringValue.toLowerCase();

        //if this is a `createObject('roSGNode'` call, only support known sg node types
        if (firstParamStringValueLower === 'rosgnode' && isLiteralExpression(call?.args[1])) {
            const componentName: Token = call?.args[1]?.tokens.value;
            this.checkComponentName(componentName);
            if (call?.args.length !== 2) {
                // roSgNode should only ever have 2 args in `createObject`
                this.addDiagnostic({
                    ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, [2], call?.args.length),
                    location: call.location
                });
            }
        } else if (!platformComponentNames.has(firstParamStringValueLower)) {
            this.addDiagnostic({
                ...DiagnosticMessages.unknownBrightScriptComponent(firstParamStringValue),
                location: firstParamToken.location
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
                    ...DiagnosticMessages.mismatchCreateObjectArgumentCount(firstParamStringValue, validArgCounts, call?.args.length),
                    location: call.location
                });
            }

            // Test for deprecation
            if (brightScriptComponent?.isDeprecated) {
                this.addDiagnostic({
                    ...DiagnosticMessages.itemIsDeprecated(firstParamStringValue, brightScriptComponent.deprecatedDescription),
                    location: call.location
                });
            }
        }

    }

    private checkComponentName(componentName: Token) {
        //don't validate any components with a colon in their name (probably component libraries, but regular components can have them too).
        if (!componentName || componentName?.text?.includes(':')) {
            return;
        }
        //add diagnostic for unknown components
        const unquotedComponentName = componentName?.text?.replace(/"/g, '');
        if (unquotedComponentName && !platformNodeNames.has(unquotedComponentName.toLowerCase()) && !this.event.program.getComponent(unquotedComponentName)) {
            this.addDiagnostic({
                ...DiagnosticMessages.unknownRoSGNode(unquotedComponentName),
                location: componentName.location
            });
        }
    }

    /**
     * Validate every method call to `component.callfunc()`, `component.createChild()`, etc.
     */
    protected validateComponentMethods(file: BrsFile, call: CallExpression) {
        const lowerMethodNamesChecked = ['callfunc', 'createchild'];
        if (!isDottedGetExpression(call.callee)) {
            return;
        }

        const callName = call.callee.tokens?.name?.text?.toLowerCase();
        if (!callName || !lowerMethodNamesChecked.includes(callName) || !isLiteralExpression(call?.args[0])) {
            return;
        }

        const callerType = call.callee.obj?.getType({ flags: SymbolTypeFlag.runtime });
        if (!isCallFuncableType(callerType)) {
            return;
        }
        const firstArgToken = call?.args[0]?.tokens.value;
        if (callName === 'createchild') {
            this.checkComponentName(firstArgToken);
        } else if (callName === 'callfunc' && !util.isGenericNodeType(callerType)) {
            const funcType = util.getCallFuncType(call, firstArgToken, { flags: SymbolTypeFlag.runtime, ignoreCall: true });
            if (!funcType?.isResolvable()) {
                const functionName = firstArgToken.text.replace(/"/g, '');
                const functionFullname = `${callerType.toString()}@.${functionName}`;
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.cannotFindCallFuncFunction(functionName, functionFullname, callerType.toString()),
                    location: firstArgToken?.location
                });
            } else {
                this.validateFunctionCall(file, call, funcType, firstArgToken.location, call.args, 1);
            }
        }
    }


    private validateCallExpression(file: BrsFile, expression: CallExpression) {
        const getTypeOptions = { flags: SymbolTypeFlag.runtime, data: {} };
        let funcType = this.getNodeTypeWrapper(file, expression?.callee, getTypeOptions);
        if (funcType?.isResolvable() && isClassType(funcType)) {
            // We're calling a class - get the constructor
            funcType = funcType.getMemberType('new', getTypeOptions);
        }
        const callErrorLocation = expression?.callee?.location;
        return this.validateFunctionCall(file, expression.callee, funcType, callErrorLocation, expression.args);

    }

    private validateCallFuncExpression(file: BrsFile, expression: CallfuncExpression) {
        const callerType = expression.callee?.getType({ flags: SymbolTypeFlag.runtime });
        if (isDynamicType(callerType)) {
            return;
        }
        const methodToken = expression.tokens.methodName;
        const methodName = methodToken?.text ?? '';
        const functionFullname = `${callerType.toString()}@.${methodName}`;
        const callErrorLocation = expression.location;
        if (util.isGenericNodeType(callerType) || isObjectType(callerType) || isDynamicType(callerType)) {
            // ignore "general" node
            return;
        }

        const funcType = util.getCallFuncType(expression, methodToken, { flags: SymbolTypeFlag.runtime, ignoreCall: true });
        if (!funcType?.isResolvable()) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.cannotFindCallFuncFunction(methodName, functionFullname, callerType.toString()),
                location: callErrorLocation
            });
        }

        return this.validateFunctionCall(file, expression, funcType, callErrorLocation, expression.args);
    }

    /**
     * Detect calls to functions with the incorrect number of parameters, or wrong types of arguments
     */
    private validateFunctionCall(file: BrsFile, callee: Expression, funcType: BscType, callErrorLocation: Location, args: Expression[], argOffset = 0) {
        if (!funcType?.isResolvable() || !isCallableType(funcType)) {
            const funcName = util.getAllDottedGetPartsAsString(callee, ParseMode.BrighterScript, isCallfuncExpression(callee) ? '@.' : '.');
            if (isUnionType(funcType)) {
                if (!util.isUnionOfFunctions(funcType) && !isCallfuncExpression(callee)) {
                    // union of func and non func. not callable
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.notCallable(funcName),
                        location: callErrorLocation
                    });
                    return;
                }
                const callablesInUnion = funcType.types.filter(isCallableType);
                const funcsInUnion = callablesInUnion.filter(isTypedFunctionType);
                if (funcsInUnion.length < callablesInUnion.length) {
                    // potentially a non-typed func in union
                    // cannot validate
                    return;
                }
                // check all funcs to see if they work
                for (let i = 1; i < funcsInUnion.length; i++) {
                    const compatibilityData: TypeCompatibilityData = {};
                    if (!funcsInUnion[0].isTypeCompatible(funcsInUnion[i], compatibilityData)) {
                        if (!compatibilityData.returnTypeMismatch) {
                            // param differences!
                            this.addMultiScopeDiagnostic({
                                ...DiagnosticMessages.incompatibleSymbolDefinition(
                                    funcName,
                                    { isUnion: true, data: compatibilityData }),
                                location: callErrorLocation
                            });
                            return;
                        }
                    }
                }
                // The only thing different was return type
                funcType = util.getFunctionTypeFromUnion(funcType);

            }
            if (funcType && !isCallableType(funcType) && !isReferenceType(funcType)) {
                const globalFuncWithVarName = globalCallableMap.get(funcName.toLowerCase());
                if (globalFuncWithVarName) {
                    funcType = globalFuncWithVarName.type;
                } else {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.notCallable(funcName),
                        location: callErrorLocation
                    });
                    return;
                }

            }
        }

        if (!isTypedFunctionType(funcType)) {
            // non typed function. nothing to check
            return;
        }

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
        const argsForCall = argOffset < 1 ? args : args.slice(argOffset);

        let expCallArgCount = argsForCall.length;
        if (expCallArgCount > maxParams || expCallArgCount < minParams) {
            let minMaxParamsText = minParams === maxParams ? maxParams + argOffset : `${minParams + argOffset}-${maxParams + argOffset}`;
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount + argOffset),
                location: callErrorLocation
            });
        }
        let paramIndex = 0;
        for (let arg of argsForCall) {
            const data = {} as ExtraSymbolData;
            let argType = this.getNodeTypeWrapper(file, arg, { flags: SymbolTypeFlag.runtime, data: data });

            const paramType = funcType.params[paramIndex]?.type;
            if (!paramType) {
                // unable to find a paramType -- maybe there are more args than params
                break;
            }

            if (isCallableType(paramType) && isClassType(argType) && isClassStatement(data.definingNode)) {
                argType = data.definingNode.getConstructorType();
            }

            const compatibilityData: TypeCompatibilityData = {};
            const isAllowedArgConversion = this.checkAllowedArgConversions(paramType, argType);
            if (!isAllowedArgConversion && !paramType?.isTypeCompatible(argType, compatibilityData)) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.argumentTypeMismatch(argType?.toString() ?? 'unknown', paramType?.toString() ?? 'unknown', compatibilityData),
                    location: arg.location
                });
            }
            paramIndex++;
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
        const data: ExtraSymbolData = {};
        const getTypeOptions = { flags: SymbolTypeFlag.runtime, data: data };
        let funcType = returnStmt.findAncestor(isFunctionExpression)?.getType({ flags: SymbolTypeFlag.typetime });
        if (isTypedFunctionType(funcType)) {
            let actualReturnType = returnStmt?.value
                ? this.getNodeTypeWrapper(file, returnStmt?.value, getTypeOptions)
                : VoidType.instance;
            const compatibilityData: TypeCompatibilityData = {};

            // `return` statement by itself in non-built-in function will actually result in `invalid`
            const valueReturnType = isVoidType(actualReturnType) ? InvalidType.instance : actualReturnType;

            if (funcType.returnType.isResolvable()) {
                if (!returnStmt?.value && isVoidType(funcType.returnType)) {
                    // allow empty return when function is return `as void`
                    // eslint-disable-next-line no-useless-return
                    return;
                } else if (!funcType.returnType.isTypeCompatible(valueReturnType, compatibilityData)) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.returnTypeMismatch(actualReturnType.toString(), funcType.returnType.toString(), compatibilityData),
                        location: returnStmt.value?.location ?? returnStmt.location
                    });
                }
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
                ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                location: typeChainScan?.location
            });
            return;
        }

        let accessibilityIsOk = this.checkMemberAccessibility(file, dottedSetStmt, typeChainExpectedLHS);

        //Most Component fields can be set with strings
        //TODO: be more precise about which fields can actually accept strings
        //TODO: if RHS is a string literal, we can do more validation to make sure it's the correct type
        if (isComponentType(dottedSetStmt.obj?.getType({ flags: SymbolTypeFlag.runtime }))) {
            if (isStringTypeLike(actualRHSType)) {
                return;
            }
        }

        if (accessibilityIsOk && !expectedLHSType?.isTypeCompatible(actualRHSType, compatibilityData)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.assignmentTypeMismatch(actualRHSType?.toString() ?? 'unknown', expectedLHSType?.toString() ?? 'unknown', compatibilityData),
                location: dottedSetStmt.location
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
                location: assignStmt.location
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

        if (!leftType || !rightType || !leftType.isResolvable() || !rightType.isResolvable()) {
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
        const opResult = util.binaryOperatorResultType(leftTypeToTest, binaryExpr.tokens.operator, rightTypeToTest);

        if (!opResult) {
            // if the result was dynamic or void, that means there wasn't a valid operation
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(binaryExpr.tokens.operator.text, leftType.toString(), rightType.toString()),
                location: binaryExpr.location
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
            if (!opResult) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.operatorTypeMismatch(unaryExpr.tokens.operator.text, rightType.toString()),
                    location: unaryExpr.location
                });
            }
        } else {
            // rhs is not a primitive, so no binary operator is allowed
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.operatorTypeMismatch(unaryExpr.tokens.operator.text, rightType.toString()),
                location: unaryExpr.location
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
                location: incStmt.location
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
                location: expression.tokens.name.location,
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
                        location: expression.location
                    });
                } else if (invalidlyUsedResolvedType && !isReferenceType(invalidlyUsedResolvedType)) {
                    if (!isAliasStatement(expression.parent)) {
                        // alias rhs CAN be a type!
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.itemCannotBeUsedAsVariable(invalidlyUsedResolvedType.toString()),
                            location: expression.location
                        });
                    }
                } else {
                    const typeChainScan = util.processTypeChain(typeChain);
                    //if this is a function call, provide a different diagnostic code
                    if (isCallExpression(typeChainScan.astNode.parent) && typeChainScan.astNode.parent.callee === expression) {
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.cannotFindFunction(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                            location: typeChainScan?.location
                        });
                    } else {
                        this.addMultiScopeDiagnostic({
                            ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                            location: typeChainScan?.location
                        });
                    }
                }

            } else if (!(typeData?.isFromDocComment)) {
                // only show "cannot find... " errors if the type is not defined from a doc comment
                const typeChainScan = util.processTypeChain(typeChain);
                const circularReferenceInfo = this.getCircularReference(exprType);
                if (isCallExpression(typeChainScan.astNode.parent) && typeChainScan.astNode.parent.callee === expression) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.cannotFindFunction(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                        location: typeChainScan?.location
                    });
                } else if (circularReferenceInfo?.isCircularReference) {
                    let diagnosticDetail = util.getCircularReferenceDetail(circularReferenceInfo, typeChainScan.fullNameOfItem);
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.circularReferenceDetected(diagnosticDetail),
                        location: typeChainScan?.location
                    });
                } else {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.cannotFindName(typeChainScan.itemName, typeChainScan.fullNameOfItem, typeChainScan.itemParentTypeName, this.getParentTypeDescriptor(typeChainScan)),
                        location: typeChainScan?.location
                    });
                }

            }
        }
        if (isUsedAsType) {
            return;
        }

        const containingNamespace = expression.findAncestor<NamespaceStatement>(isNamespaceStatement);
        const containingNamespaceName = containingNamespace?.getName(ParseMode.BrighterScript);

        if (!(isCallExpression(expression.parent) && isNewExpression(expression.parent?.parent))) {
            const classUsedAsVarEntry = this.checkTypeChainForClassUsedAsVar(typeChain, containingNamespaceName);
            const isClassInNamespace = containingNamespace?.getSymbolTable().hasSymbol(typeChain[0].name, SymbolTypeFlag.runtime);
            if (classUsedAsVarEntry && !isClassInNamespace) {

                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable(classUsedAsVarEntry.toString()),
                    location: expression.location
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
                location: expression.location
            });
        } else if (isEnumType(exprType) && !isAliasStatement(expression.parent)) {
            const enumStatement = this.event.scope.getEnum(util.getAllDottedGetPartsAsString(expression));
            if (enumStatement) {
                // there's an enum with this name
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.itemCannotBeUsedAsVariable('enum'),
                    location: expression.location
                });
            }
        } else if (isDynamicType(exprType) && isEnumType(parentTypeInfo?.type) && isDottedGetExpression(expression)) {
            const enumFileLink = this.event.scope.getEnumFileLink(util.getAllDottedGetPartsAsString(expression.obj));
            const typeChainScanForItem = util.processTypeChain(typeChain);
            const typeChainScanForParent = util.processTypeChain(typeChain.slice(0, -1));
            if (enumFileLink) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.cannotFindName(lastTypeInfo?.name, typeChainScanForItem.fullChainName, typeChainScanForParent.fullNameOfItem, 'enum'),
                    location: lastTypeInfo?.location,
                    relatedInformation: [{
                        message: 'Enum declared here',
                        location: util.createLocationFromRange(
                            util.pathToUri(enumFileLink?.file.srcPath),
                            enumFileLink?.item?.tokens.name.location?.range
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
                                location: expression.location
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
                                location: expression.location
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
                location: newExpression.className.location
            });

        }
    }

    private validateFunctionExpressionForReturn(func: FunctionExpression) {
        const returnType = func?.returnTypeExpression?.getType({ flags: SymbolTypeFlag.typetime });

        if (!returnType || !returnType.isResolvable() || isVoidType(returnType) || isDynamicType(returnType)) {
            return;
        }
        const returns = func.body?.findChild<ReturnStatement>(isReturnStatement, { walkMode: WalkMode.visitAll });
        if (!returns && isStringTypeLike(returnType)) {
            this.addMultiScopeDiagnostic({
                ...DiagnosticMessages.returnTypeCoercionMismatch(returnType.toString()),
                location: func.location
            });
        }
    }

    /**
     * Create diagnostics for any duplicate function declarations
     */
    private flagDuplicateFunctionDeclarations() {
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, tag: ScopeValidatorDiagnosticTag.DuplicateFunctionDeclaration });

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
                            location: util.createLocationFromFileRange(container.callable.file, container.callable.nameRange)
                        }, ScopeValidatorDiagnosticTag.DuplicateFunctionDeclaration);
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
                                location: util.createLocationFromRange(
                                    util.pathToUri(ownCallable.callable.file?.srcPath),
                                    thatNameRange
                                )
                            });
                        }
                    }

                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.duplicateFunctionImplementation(callable.name),
                        location: util.createLocationFromFileRange(callable.file, callable.nameRange),
                        relatedInformation: related
                    }, ScopeValidatorDiagnosticTag.DuplicateFunctionDeclaration);
                }
            }
        }
    }

    /**
     * Verify that all of the scripts imported by each file in this scope actually exist, and have the correct case
     */
    private validateScriptImportPaths() {
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, tag: ScopeValidatorDiagnosticTag.Imports });

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
                    location: util.createLocationFromFileRange(scriptImport.sourceFile, scriptImport.filePathRange)
                }, ScopeValidatorDiagnosticTag.Imports);
                //if the character casing of the script import path does not match that of the actual path
            } else if (scriptImport.destPath !== referencedFile.destPath) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.scriptImportCaseMismatch(referencedFile.destPath),
                    location: util.createLocationFromFileRange(scriptImport.sourceFile, scriptImport.filePathRange)
                }, ScopeValidatorDiagnosticTag.Imports);
            }
        }
    }

    /**
     * Validate all classes defined in this scope
     */
    private validateClasses() {
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, tag: ScopeValidatorDiagnosticTag.Classes });

        let validator = new BsClassValidator(this.event.scope);
        validator.validate();
        for (const diagnostic of validator.diagnostics) {
            this.addMultiScopeDiagnostic({
                ...diagnostic
            }, ScopeValidatorDiagnosticTag.Classes);
        }
    }


    /**
     * Find various function collisions
     */
    private diagnosticDetectFunctionCollisions(file: BrsFile) {
        const fileUri = util.pathToUri(file.srcPath);
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, fileUri: fileUri, tag: ScopeValidatorDiagnosticTag.FunctionCollisions });
        for (let func of file.callables) {
            const funcName = func.getName(ParseMode.BrighterScript);
            const lowerFuncName = funcName?.toLowerCase();
            if (lowerFuncName) {

                //find function declarations with the same name as a stdlib function
                if (globalCallableMap.has(lowerFuncName)) {
                    this.addMultiScopeDiagnostic({
                        ...DiagnosticMessages.scopeFunctionShadowedByBuiltInFunction(),
                        location: util.createLocationFromRange(fileUri, func.nameRange)

                    });
                }
            }
        }
    }

    public detectShadowedLocalVar(file: BrsFile, varDeclaration: { expr: AstNode; name: string; type: BscType; nameRange: Range }) {
        const varName = varDeclaration.name;
        const lowerVarName = varName.toLowerCase();
        const callableContainerMap = this.event.scope.getCallableContainerMap();
        const containingNamespace = varDeclaration.expr?.findAncestor<NamespaceStatement>(isNamespaceStatement);
        const localVarIsInNamespace = util.isVariableMemberOfNamespace(varDeclaration.name, varDeclaration.expr, containingNamespace);

        const varIsFunction = () => {
            return isCallableType(varDeclaration.type) && !isDynamicType(varDeclaration.type);
        };

        if (
            //has same name as stdlib
            globalCallableMap.has(lowerVarName)
        ) {
            //local var function with same name as stdlib function
            if (varIsFunction()) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarFunctionShadowsParentFunction('stdlib'),
                    location: util.createLocationFromFileRange(file, varDeclaration.nameRange)
                });
            }
        } else if (callableContainerMap.has(lowerVarName) && !localVarIsInNamespace) {
            const callable = callableContainerMap.get(lowerVarName);
            //is same name as a callable
            if (varIsFunction()) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarFunctionShadowsParentFunction('scope'),
                    location: util.createLocationFromFileRange(file, varDeclaration.nameRange),
                    relatedInformation: [{
                        message: 'Function declared here',
                        location: util.createLocationFromFileRange(
                            callable[0].callable.file,
                            callable[0].callable.nameRange
                        )
                    }]
                });
            } else {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                    location: util.createLocationFromFileRange(file, varDeclaration.nameRange),
                    relatedInformation: [{
                        message: 'Function declared here',
                        location: util.createLocationFromRange(
                            util.pathToUri(callable[0].callable.file.srcPath),
                            callable[0].callable.nameRange
                        )
                    }]
                });
            }
            //has the same name as an in-scope class
        } else if (!localVarIsInNamespace) {
            const classStmtLink = this.event.scope.getClassFileLink(lowerVarName);
            if (classStmtLink) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.localVarShadowedByScopedFunction(),
                    location: util.createLocationFromFileRange(file, varDeclaration.nameRange),
                    relatedInformation: [{
                        message: 'Class declared here',
                        location: util.createLocationFromRange(
                            util.pathToUri(classStmtLink.file.srcPath),
                            classStmtLink?.item.tokens.name.location?.range
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
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, fileUri: util.pathToUri(scope.xmlFile?.srcPath), tag: ScopeValidatorDiagnosticTag.XMLInterface });

        const iface = scope.xmlFile.parser.ast.componentElement.interfaceElement;
        const callableContainerMap = scope.getCallableContainerMap();
        //validate functions
        for (const func of iface.functions) {
            const name = func.name;
            if (!name) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlTagMissingAttribute(func.tokens.startTagName.text, 'name'),
                    location: func.tokens.startTagName.location
                }, ScopeValidatorDiagnosticTag.XMLInterface);
            } else if (!callableContainerMap.has(name.toLowerCase())) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlFunctionNotFound(name),
                    location: func.getAttribute('name')?.tokens.value.location
                }, ScopeValidatorDiagnosticTag.XMLInterface);
            }
        }
        //validate fields
        for (const field of iface.fields) {
            const { id, type, onChange } = field;
            if (!id) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlTagMissingAttribute(field.tokens.startTagName.text, 'id'),
                    location: field.tokens.startTagName.location
                }, ScopeValidatorDiagnosticTag.XMLInterface);
            }
            if (!type) {
                if (!field.alias) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.xmlTagMissingAttribute(field.tokens.startTagName.text, 'type'),
                        location: field.tokens.startTagName.location
                    }, ScopeValidatorDiagnosticTag.XMLInterface);
                }
            } else if (!SGFieldTypes.includes(type.toLowerCase())) {
                this.addDiagnostic({
                    ...DiagnosticMessages.xmlInvalidFieldType(type),
                    location: field.getAttribute('type')?.tokens.value.location
                }, ScopeValidatorDiagnosticTag.XMLInterface);
            }
            if (onChange) {
                if (!callableContainerMap.has(onChange.toLowerCase())) {
                    this.addDiagnostic({
                        ...DiagnosticMessages.xmlFunctionNotFound(onChange),
                        location: field.getAttribute('onchange')?.tokens.value.location
                    }, ScopeValidatorDiagnosticTag.XMLInterface);
                }
            }
        }
    }

    private validateDocComments(node: AstNode) {
        const doc = brsDocParser.parseNode(node);
        for (const docTag of doc.tags) {
            const docTypeTag = docTag as BrsDocWithType;
            if (!docTypeTag.typeExpression || !docTypeTag.location) {
                continue;
            }
            const foundType = docTypeTag.typeExpression?.getType({ flags: SymbolTypeFlag.typetime });
            if (!foundType?.isResolvable()) {
                this.addMultiScopeDiagnostic({
                    ...DiagnosticMessages.cannotFindName(docTypeTag.typeString),
                    location: brsDocParser.getTypeLocationFromToken(docTypeTag.token) ?? docTypeTag.location
                });
            }
        }
    }

    /**
     * Detect when a child has imported a script that an ancestor also imported
     */
    private diagnosticDetectDuplicateAncestorScriptImports(scope: XmlScope) {
        this.event.program.diagnostics.clearByFilter({ scope: this.event.scope, fileUri: util.pathToUri(scope.xmlFile?.srcPath), tag: ScopeValidatorDiagnosticTag.XMLImports });
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
                        location: util.createLocationFromFileRange(scope.xmlFile, scriptImport.filePathRange),
                        ...DiagnosticMessages.unnecessaryScriptImportInChildFromParent(ancestorComponentName)
                    }, ScopeValidatorDiagnosticTag.XMLImports);
                }
            }
        }
    }

    /**
     * Wraps the AstNode.getType() method, so that we can do extra processing on the result based on the current file
     * In particular, since BrightScript does not support Unions, and there's no way to cast them to something else
     * if the result of .getType() is a union, and we're in a .brs (brightScript) file, treat the result as Dynamic
     *
     * Also, for BrightScript parse-mode, if .getType() returns a node type, do not validate unknown members.
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

            if (isComponentType(type)) {
                // modify type to allow any member access for Node types
                type.changeUnknownMemberToDynamic = true;
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

    private addDiagnostic(diagnostic: BsDiagnostic, diagnosticTag?: string) {
        diagnosticTag = diagnosticTag ?? (this.currentSegmentBeingValidated ? ScopeValidatorDiagnosticTag.Segment : ScopeValidatorDiagnosticTag.Default);
        this.event.program.diagnostics.register(diagnostic, {
            tags: [diagnosticTag],
            segment: this.currentSegmentBeingValidated
        });
    }

    /**
     * Add a diagnostic (to the first scope) that will have `relatedInformation` for each affected scope
     */
    private addMultiScopeDiagnostic(diagnostic: BsDiagnostic, diagnosticTag?: string) {
        diagnosticTag = diagnosticTag ?? (this.currentSegmentBeingValidated ? ScopeValidatorDiagnosticTag.Segment : ScopeValidatorDiagnosticTag.Default);
        this.event.program.diagnostics.register(diagnostic, {
            tags: [diagnosticTag],
            segment: this.currentSegmentBeingValidated,
            scope: this.event.scope
        });
    }
}
