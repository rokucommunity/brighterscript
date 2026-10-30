import { isAliasStatement, isBlock, isBody, isCallExpression, isCaseStatement, isClassStatement, isConditionalCompileConstStatement, isConditionalCompileErrorStatement, isConditionalCompileStatement, isConstStatement, isDottedGetExpression, isDottedSetStatement, isEnumStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isIfStatement, isImportStatement, isIndexedGetExpression, isIndexedSetStatement, isInterfaceStatement, isInvalidType, isLibraryStatement, isLiteralBoolean, isLiteralExpression, isLiteralNumber, isLiteralString, isMethodStatement, isNamespaceStatement, isSelectCaseStatement, isSpreadExpression, isTryCatchStatement, isTypecastExpression, isTaggedTemplateStringExpression, isTypecastStatement, isTypedFunctionTypeExpression, isTypeStatement, isUnaryExpression, isVariableExpression, isVoidType, isWhileStatement } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, ValidateFileEvent } from '../../interfaces';
import { TokenKind, UnreferencableBuiltins } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import { CallExpression, FunctionExpression, type AALiteralExpression, type FunctionParameterExpression, type ArrayLiteralExpression, type LiteralExpression, type RegexLiteralExpression, type SourceLiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ClassStatement, ContinueStatement, EnumMemberStatement, EnumStatement, ForEachStatement, ForStatement, FunctionStatement, ImportStatement, LibraryStatement, Body, MethodStatement, WhileStatement, TypecastStatement, Block, AliasStatement, IfStatement, ConditionalCompileStatement, ConditionalCompileConstStatement, SelectCaseStatement, LabelStatement, GotoStatement } from '../../parser/Statement';
import { getExitSelectTarget, isExitSelectStatement, PrintStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import { DynamicType } from '../../types/DynamicType';
import util from '../../util';
import type { Location } from 'vscode-languageserver';
import type { Locatable, SourceInfo, Token } from '../../lexer/Token';
import type { BrightScriptDoc } from '../../parser/BrightScriptDocParser';
import brsDocParser from '../../parser/BrightScriptDocParser';
import { TypeStatementType } from '../../types/TypeStatementType';
import { findUnreachableRegions } from './ControlFlowReachability';
import { findRegexLiteralProblems } from './RegexLiteralValidation';
import * as semver from 'semver';
import { CONTINUE_MIN_FIRMWARE_VERSION, OPTIONAL_CHAINING_MIN_FIRMWARE_VERSION } from '../../RokuConstants';
import type { AvailabilityAxis } from '../../DiagnosticMessages';
import { globalCallableMap } from '../../globalCallables';

export class BrsFileValidator {
    constructor(
        public event: ValidateFileEvent<BrsFile>
    ) {
    }


    private literalPools: Partial<Record<LiteralPoolName, LiteralPool>> = {};

    /**
     * Labels and gotos collected during `walk()`, grouped by their enclosing function.
     * Collected from the main walk so that `#if` branches are evaluated against the live `bsConsts`.
     */
    private labelsAndGotosByFunction = new Map<FunctionExpression, LabelsAndGotos>();

    /**
     * Statements inside a run already reported as unreachable by control flow. Anything inside one is covered by that report.
     */
    private controlFlowUnreachableNodes = new Set<AstNode>();

    /**
     * Conditional compile chains whose inactive branches are covered by a run reported by control flow
     */
    private controlFlowCoveredChains = new Set<AstNode>();

    /**
     * Conditional compile chains that a run reported by control flow ends inside, mapped to that run's location
     */
    private controlFlowPartiallyCoveredChains = new Map<AstNode, Location>();

    /**
     * Parser diagnostics sorted by start position. Each entry also holds the furthest end among the entries up to and including it.
     */
    private parseDiagnosticIndex: Array<{ startPosition: number; furthestEndPosition: number }> | undefined;

    public process() {
        const unlinkGlobalSymbolTable = this.event.file.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);

        util.validateTooDeepFile(this.event.file);

        // Invalidate cache on this file
        // It could have potentially changed before this from plugins, after this, it will not change
        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.event.file['_cachedLookups'].invalidate();
        //rebuild the lookups now, because that full walk resolves every `#if` and `#const` (and sets `isActive`) before the walk below,
        //whose visitors can ask about nodes it has not reached yet (such as the members of a class)
        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.event.file['_cachedLookups'].rehydrate();

        this.literalPools = {};
        this.walk();
        this.validateFileLiteralCount();
        this.validateGotosAndLabels();
        this.flagTopLevelStatements();
        //only validate the file if it was actually parsed (skip files containing typedefs)
        if (!this.event.file.hasTypedef) {
            this.validateTopOfFileStatements();
            this.validateTypecastStatements();
        }

        unlinkGlobalSymbolTable();
    }

    private getLabelsAndGotos(node: LabelStatement | GotoStatement): LabelsAndGotos | undefined {
        const func = node.findAncestor<FunctionExpression>(isFunctionExpression);
        if (!func) {
            return undefined;
        }
        let record = this.labelsAndGotosByFunction.get(func);
        if (!record) {
            record = { labels: [], gotos: [] };
            this.labelsAndGotosByFunction.set(func, record);
        }
        return record;
    }

    /**
     * Report duplicate labels, labels inside `try` blocks, gotos with no matching label,
     * and gotos that jump into a `for` / `for each` loop from outside it.
     */
    private validateGotosAndLabels() {
        for (const [func, { labels, gotos }] of this.labelsAndGotosByFunction) {
            const firstLabelByName = new Map<string, LabelStatement>();
            for (const label of labels) {
                const labelName = label.tokens.name.text;
                const lowerName = labelName.toLowerCase();
                if (firstLabelByName.has(lowerName)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.duplicateLabel(labelName),
                        location: label.tokens.name
                    });
                } else {
                    firstLabelByName.set(lowerName, label);
                }
                if (this.isInsideTryBranch(label, func)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.labelInTryBlock(labelName),
                        location: label.tokens.name
                    });
                }
            }

            for (const gotoStatement of gotos) {
                const labelToken = gotoStatement.tokens.label;
                if (!labelToken?.text) {
                    continue;
                }
                const targetLabel = firstLabelByName.get(labelToken.text.toLowerCase());
                if (!targetLabel) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.labelNotFound(labelToken.text),
                        location: labelToken
                    });
                } else if (this.jumpsIntoForLoop(gotoStatement, targetLabel, func)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.gotoIntoForLoop(labelToken.text),
                        location: labelToken
                    });
                }
            }
        }
    }

    /**
     * Is the label inside the `try` branch of any try/catch within the function, at any depth? A `catch` between the label and an outer `try` does not exempt it. A label in a `catch` with no enclosing `try` is allowed.
     */
    private isInsideTryBranch(label: LabelStatement, func: FunctionExpression) {
        let child: AstNode = label;
        let parent = label.parent;
        while (parent && parent !== func) {
            if (isTryCatchStatement(parent) && parent.tryBranch === child) {
                return true;
            }
            child = parent;
            parent = parent.parent;
        }
        return false;
    }

    /**
     * Does the goto land inside a `for` / `for each` loop that does not also contain the goto?
     */
    private jumpsIntoForLoop(gotoStatement: GotoStatement, targetLabel: LabelStatement, func: FunctionExpression) {
        const gotoAncestors = new Set<AstNode>();
        for (let ancestor = gotoStatement.parent; ancestor && ancestor !== func; ancestor = ancestor.parent) {
            gotoAncestors.add(ancestor);
        }
        for (let ancestor = targetLabel.parent; ancestor && ancestor !== func; ancestor = ancestor.parent) {
            if ((isForStatement(ancestor) || isForEachStatement(ancestor)) && !gotoAncestors.has(ancestor)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Walk the full AST
     */
    private walk() {
        const isBrighterscript = this.event.file.parser.options.mode === ParseMode.BrighterScript;

        const visitor = createVisitor({
            MethodStatement: (node) => {
                //add the `super` symbol to class methods
                if (isClassStatement(node.parent) && node.parent.hasParentClass()) {
                    const data: ExtraSymbolData = {};
                    const parentClassType = node.parent.parentClassName.getType({ flags: SymbolTypeFlag.typetime, data: data });
                    node.func.body.getSymbolTable().addSymbol('super', { ...data, isInstance: true }, parentClassType, SymbolTypeFlag.runtime);
                }
                this.validateFunctionNameLength(node, this.getMethodRuntimeName(node));
            },
            CallfuncExpression: (node) => {
                if (node.args.length > 5) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.callfuncHasToManyArgs(node.args.length),
                        location: node.tokens.methodName
                    });
                }
            },
            DottedGetExpression: (node) => {
                if (node.tokens.dot?.kind === TokenKind.QuestionDot) {
                    this.validateMinFirmwareVersionForOptionalChaining(node.tokens.dot);
                }
            },
            IndexedGetExpression: (node) => {
                if (node.tokens.questionDot || node.tokens.openingSquare?.kind === TokenKind.QuestionLeftSquare) {
                    this.validateMinFirmwareVersionForOptionalChaining(util.firstLocatable(node.tokens.questionDot, node.tokens.openingSquare));
                }
            },
            CallExpression: (node) => {
                if (node.tokens.openingParen?.kind === TokenKind.QuestionLeftParen) {
                    this.validateMinFirmwareVersionForOptionalChaining(node.tokens.openingParen);
                }
                this.validateGlobalCallableAvailability(node);
            },
            RegexLiteralExpression: (node) => {
                this.validateRegexLiteral(node);
            },
            EnumStatement: (node) => {
                this.validateDeclarationLocations(node, 'enum', () => util.setBounds({} as Locatable, node.tokens.enum, node.tokens.name));

                this.validateEnumDeclaration(node);

                if (!node.tokens.name) {
                    return;
                }
                //register this enum declaration
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime);
            },
            ClassStatement: (node) => {
                if (!node?.tokens?.name) {
                    return;
                }
                this.validateDeclarationLocations(node, 'class', () => util.setBounds({} as Locatable, node.tokens.class, node.tokens.name));

                for (const constructor of node.getConditionalCompileConstructors()) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.classConstructorNotAllowedInConditionalCompile(),
                        location: constructor.tokens.name
                    });
                }

                //register this class
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                node.getSymbolTable().addSymbol('m', { definingNode: node, isInstance: true }, nodeType, SymbolTypeFlag.runtime);
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name?.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime);

                if (node.findAncestor(isNamespaceStatement)) {
                    //add the transpiled name for namespaced constructors to the root symbol table
                    const transpiledClassConstructor = node.getName(ParseMode.BrightScript);

                    this.event.file.parser.ast.symbolTable.addSymbol(
                        transpiledClassConstructor,
                        { definingNode: node },
                        node.getConstructorType(),
                        // eslint-disable-next-line no-bitwise
                        SymbolTypeFlag.runtime | SymbolTypeFlag.postTranspile
                    );
                }
            },
            AssignmentStatement: (node) => {
                if (!node?.tokens?.name) {
                    return;
                }
                if (isForStatement(node.parent) && node.parent.counterDeclaration === node) {
                    // for loop variable variable is added to the block symbol table elsewhere
                    return;
                }
                const data: ExtraSymbolData = {};
                //register this variable
                let nodeType = node.getType({ flags: SymbolTypeFlag.runtime, data: data });
                if (isInvalidType(nodeType) || isVoidType(nodeType)) {
                    nodeType = DynamicType.instance;
                }
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name.text, { definingNode: node, isInstance: true, isFromDocComment: data.isFromDocComment, isFromCallFunc: data.isFromCallFunc }, nodeType, SymbolTypeFlag.runtime);
            },
            DottedSetStatement: (node) => {
                this.validateNoOptionalChainingInVarSet(node, [node.obj]);
            },
            IndexedSetStatement: (node) => {
                this.validateNoOptionalChainingInVarSet(node, [node.obj]);
            },
            ArrayLiteralExpression: (node) => {
                this.validateSpreadPosition(node);
            },
            AALiteralExpression: (node) => {
                this.validateSpreadPosition(node);
            },
            ForEachStatement: (node) => {
                //registering the for loop variable happens in the visitor for Block, since the loop variable is scoped to the loop body
            },
            NamespaceStatement: (node) => {
                if (!node?.nameExpression) {
                    return;
                }
                this.validateDeclarationLocations(node, 'namespace', () => util.setBounds({} as Locatable, node.tokens.namespace, node.nameExpression));
                //Namespace Types are added at the Scope level - This is handled when the SymbolTables get linked
            },
            FunctionStatement: (node) => {
                this.validateDeclarationLocations(node, 'function', () => util.setBounds({} as Locatable, node.func.tokens.functionType, node.tokens.name));
                const funcType = node.getType({ flags: SymbolTypeFlag.typetime });

                if (node.tokens.name?.text) {
                    node.parent.getSymbolTable().addSymbol(
                        node.tokens.name.text,
                        { definingNode: node },
                        funcType,
                        SymbolTypeFlag.runtime
                    );
                }

                const namespace = node.findAncestor(isNamespaceStatement);
                //the function's actual runtime name (namespaced functions get flattened into a single global name, e.g. `namespace_functionName`)
                let runtimeName = node.tokens.name?.text;
                //this function is declared inside a namespace
                if (namespace) {
                    namespace.getSymbolTable().addSymbol(
                        node.tokens.name?.text,
                        { definingNode: node },
                        funcType,
                        SymbolTypeFlag.runtime
                    );
                    if (node.tokens?.name) {
                        //add the transpiled name for namespaced functions to the root symbol table
                        const transpiledNamespaceFunctionName = node.getName(ParseMode.BrightScript);
                        runtimeName = transpiledNamespaceFunctionName;

                        this.event.file.parser.ast.symbolTable.addSymbol(
                            transpiledNamespaceFunctionName,
                            { definingNode: node },
                            funcType,
                            // eslint-disable-next-line no-bitwise
                            SymbolTypeFlag.runtime | SymbolTypeFlag.postTranspile
                        );
                    }
                }

                this.validateFunctionNameLength(node, runtimeName);
            },
            FunctionExpression: (node) => {
                const funcSymbolTable = node.getSymbolTable();
                const isInlineFunc = !(isFunctionStatement(node.parent) || isMethodStatement(node.parent));
                if (isInlineFunc) {
                    // symbol table should not include any symbols from parent func
                    funcSymbolTable.pushParentProvider(() => node.findAncestor<Body>(isBody).getSymbolTable());
                }
                if (!funcSymbolTable?.hasSymbol('m', SymbolTypeFlag.runtime) || isInlineFunc) {
                    if (!isTypecastStatement(node.body?.statements?.[0])) {
                        // if this is an inline function, or if the function body does not start with a typecast statement, add the `m` symbol to the function scope. If the function body starts with a typecast statement, the `m` symbol will be added in the visitor for TypecastStatement, and it will be typed as the type from the typecast statement
                        funcSymbolTable?.addSymbol('m', { isInstance: true }, new AssociativeArrayType(), SymbolTypeFlag.runtime);
                    }
                }
                this.validateFunctionParameterCount(node);
                this.validateFunctionVariableCount(node);
                this.collectFunctionLiterals(node);
                this.validateFunctionGotoLabelCount(node);
                this.flagControlFlowUnreachableCode(node);
            },
            FunctionParameterExpression: (node) => {
                if (isTypedFunctionTypeExpression(node.parent)) {
                    return;
                }
                const paramName = node.tokens?.name?.text;
                if (!paramName) {
                    return;
                }
                this.validateTypeDesignatorMatchesDeclaredType(node);
                const data: ExtraSymbolData = {};
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime, data: data });
                // add param symbol at expression level, so it can be used as default value in other params
                const funcExpr = node.findAncestor<FunctionExpression>(isFunctionExpression);
                const funcSymbolTable = funcExpr?.getSymbolTable();
                const extraSymbolData: ExtraSymbolData = {
                    definingNode: node,
                    isInstance: true,
                    isFromDocComment: data.isFromDocComment,
                    description: data.description
                };
                funcSymbolTable?.addSymbol(paramName, extraSymbolData, nodeType, SymbolTypeFlag.runtime);

                //also add param symbol at block level, as it may be redefined, and if so, should show a union
                funcExpr.body.getSymbolTable()?.addSymbol(paramName, extraSymbolData, nodeType, SymbolTypeFlag.runtime);
            },
            InterfaceStatement: (node) => {
                if (!node.tokens.name) {
                    return;
                }
                this.validateDeclarationLocations(node, 'interface', () => util.setBounds({} as Locatable, node.tokens.interface, node.tokens.name));

                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime);
            },
            ConstStatement: (node) => {
                if (!node.tokens.name) {
                    return;
                }
                this.validateDeclarationLocations(node, 'const', () => util.setBounds({} as Locatable, node.tokens.const, node.tokens.name));
                const nodeType = node.getType({ flags: SymbolTypeFlag.runtime });
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, isInstance: true }, nodeType, SymbolTypeFlag.runtime);
            },
            CatchStatement: (node) => {
                //brs and bs both support variableExpression for the exception variable
                if (isVariableExpression(node.exceptionVariableExpression)) {
                    node.parent.getSymbolTable().addSymbol(
                        node.exceptionVariableExpression.getName(),
                        { definingNode: node, isInstance: true },
                        //TODO I think we can produce a slightly more specific type here (like an AA but with the known exception properties)
                        DynamicType.instance,
                        SymbolTypeFlag.runtime
                    );
                    //brighterscript allows catch without an exception variable
                } else if (isBrighterscript && !node.exceptionVariableExpression) {
                    //this is fine

                    //brighterscript allows a typecast expression here
                } else if (isBrighterscript && isTypecastExpression(node.exceptionVariableExpression) && isVariableExpression(node.exceptionVariableExpression.obj)) {
                    node.parent.getSymbolTable().addSymbol(
                        node.exceptionVariableExpression.obj.getName(),
                        { definingNode: node, isInstance: true },
                        node.exceptionVariableExpression.getType({ flags: SymbolTypeFlag.runtime }),
                        SymbolTypeFlag.runtime
                    );

                    //no other expressions are allowed here
                } else {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.expectedExceptionVarToFollowCatch(),
                        location: util.firstLocatable<Locatable>(node.exceptionVariableExpression, node.tokens.catch)
                    });
                }
            },
            DimStatement: (node) => {
                if (node.tokens.name) {
                    node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, isInstance: true }, node.getType({ flags: SymbolTypeFlag.runtime }), SymbolTypeFlag.runtime);
                }
            },
            ReturnStatement: (node) => {
                const func = node.findAncestor(isFunctionExpression);
                //these situations cannot have a value next to `return`
                if (
                    //`function as void`, `sub as void`
                    (isVariableExpression(func?.returnTypeExpression?.expression) && func.returnTypeExpression.expression.tokens.name.text?.toLowerCase() === 'void') ||
                    //`sub` <without return value>
                    (func.tokens.functionType?.kind === TokenKind.Sub && !func.returnTypeExpression)
                ) {
                    //there may not be a return value
                    if (node.value) {
                        this.event.program.diagnostics.register({
                            ...DiagnosticMessages.voidFunctionMayNotReturnValue(func.tokens.functionType?.text),
                            location: node
                        });
                    }

                } else {
                    //there MUST be a return value
                    if (!node.value) {
                        this.event.program.diagnostics.register({
                            ...DiagnosticMessages.nonVoidFunctionMustReturnValue(func?.tokens.functionType?.text),
                            location: node
                        });
                    }
                }
            },
            ContinueStatement: (node) => {
                this.validateContinueStatement(node);
            },
            TypecastStatement: (node) => {
                const obj = node.typecastExpression.obj;
                if (isVariableExpression(obj)) {
                    node.parent.getSymbolTable().addSymbol(obj.tokens.name.text, { definingNode: node, doNotMerge: true, isInstance: true }, node.getType({ flags: SymbolTypeFlag.typetime }), SymbolTypeFlag.runtime);
                }
            },
            PrintStatement: (node) => {
                this.validatePrintStatementItemCount(node);
            },
            LabelStatement: (node) => {
                this.getLabelsAndGotos(node)?.labels.push(node);
            },
            GotoStatement: (node) => {
                this.getLabelsAndGotos(node)?.gotos.push(node);
            },
            ConditionalCompileStatement: (node) => {
                this.validateHashIfCondition(node);
                this.flagInactiveConditionalCompileBranches(node);
            },
            ConditionalCompileConstStatement: (node) => {
                this.validateHashConst(node);
            },
            ConditionalCompileErrorStatement: (node) => {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.hashError(node.tokens.message.text),
                    location: node
                });
            },
            AliasStatement: (node) => {
                // eslint-disable-next-line no-bitwise
                const targetType = node.value.getType({ flags: SymbolTypeFlag.typetime | SymbolTypeFlag.runtime });

                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, doNotMerge: true, isAlias: true }, targetType, SymbolTypeFlag.runtime | SymbolTypeFlag.typetime);

            },
            TypeStatement: (node) => {
                this.validateDeclarationLocations(node, 'type', () => util.setBounds({} as Locatable, node.tokens.type, node.tokens.name));
                const wrappedNodeType = node.getType({ flags: SymbolTypeFlag.runtime });
                const typeStmtType = new TypeStatementType(node.tokens.name.text, wrappedNodeType);
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, isFromTypeStatement: true }, typeStmtType, SymbolTypeFlag.typetime);

            },
            IfStatement: (node) => {
                this.setUpComplementSymbolTables(node, isIfStatement);
            },
            ExitStatement: (node) => {
                if (isExitSelectStatement(node)) {
                    const target = getExitSelectTarget(node);
                    if (!target || target.isInLoop) {
                        this.event.program.diagnostics.register({
                            ...(target ? DiagnosticMessages.exitSelectInLoop() : DiagnosticMessages.exitSelectOutsideSelectCase()),
                            location: node
                        });
                    }
                }
            },
            SelectCaseStatement: (node) => {
                //a variable assigned in every case (including `case else`) is known to exist after the `select case`.
                //But if any case might `exit select` part way through, the rest of that case might not run
                const elseCase = node.elseCase;
                if (elseCase?.body && !node.cases.some(x => x.canExitEarly)) {
                    for (const caseStatement of node.cases) {
                        if (caseStatement !== elseCase && caseStatement.body) {
                            elseCase.body.symbolTable.complementOtherTable(caseStatement.body.symbolTable);
                        }
                    }
                }
                this.validateSelectCaseStatement(node);
            },
            Block: (node) => {
                const blockSymbolTable = node.symbolTable;
                if (node.findAncestor<Block>(isFunctionExpression)) {
                    // this block is in a function. order matters!
                    blockSymbolTable.isOrdered = true;
                }
                if (!isFunctionExpression(node.parent) && node.parent) {
                    node.symbolTable.name = `Block-${node.parent.kind}@${util.getLocation(node)?.range?.start?.line}`;
                    // we're a block inside another block (or body). This block is a pocket in the bigger block
                    node.parent.getSymbolTable().addPocketTable({
                        index: node.parent.statementIndex,
                        table: blockSymbolTable,
                        // code always flows through ConditionalCompiles, because we walk according to defined BSConsts
                        willAlwaysBeExecuted: isConditionalCompileStatement(node.parent) || this.isAlwaysExecutedCase(node.parent)
                    });

                    if (isForStatement(node.parent)) {
                        const counterDecl = node.parent.counterDeclaration;
                        const loopVar = counterDecl.tokens.name;
                        const loopVarType = counterDecl.getType({ flags: SymbolTypeFlag.runtime });
                        blockSymbolTable.addSymbol(loopVar.text, { isInstance: true }, loopVarType, SymbolTypeFlag.runtime);

                    } else if (isForEachStatement(node.parent)) {
                        const loopVarType = node.parent.getLoopVariableType({ flags: SymbolTypeFlag.runtime });
                        blockSymbolTable.addSymbol(node.parent.tokens.item.text, { isInstance: true }, loopVarType, SymbolTypeFlag.runtime);
                    }
                }
            },
            VariableExpression: (node) => {
                //flag reserved unreferencable builtins (e.g. `ObjFun`, `type`) used in non-call position.
                //these compile cleanly as values today but are device compile errors
                //(`Syntax Error. Builtin function call expected`).
                const name = node.tokens.name?.text;
                if (
                    name &&
                    UnreferencableBuiltins.has(name.toLowerCase()) &&
                    //only valid use is as the callee of a CallExpression
                    !(isCallExpression(node.parent) && node.parent.callee === node)
                ) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.reservedBuiltinUsedAsValue(name),
                        location: node.tokens.name
                    });
                }
            },
            AstNode: (node) => {
                //check for doc comments
                if (!node.leadingTrivia || node.leadingTrivia.length === 0) {
                    return;
                }
                const doc = brsDocParser.parseNode(node);
                if (doc.tags.length === 0) {
                    return;
                }

                let funcExpr = node.findAncestor<FunctionExpression>(isFunctionExpression);
                if (funcExpr) {
                    // handle comment tags inside a function expression
                    this.processDocTagsInFunction(doc, node, funcExpr);
                } else {
                    //handle comment tags outside of a function expression
                    this.processDocTagsAtTopLevel(doc, node);
                }
            }
        });

        this.event.file.ast.walk((node, parent) => {
            visitor(node, parent);
        }, {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    private processDocTagsInFunction(doc: BrightScriptDoc, node: AstNode, funcExpr: FunctionExpression) {
        //TODO: Handle doc tags that influence the function they're in

        // For example, declaring variable types:
        // const symbolTable = funcExpr.body.getSymbolTable();

        // for (const varTag of doc.getAllTags(BrsDocTagKind.Var)) {
        //     const varName = (varTag as BrsDocParamTag).name;
        //     const varTypeStr = (varTag as BrsDocParamTag).type;
        //     const data: ExtraSymbolData = {};
        //     const type = doc.getTypeFromContext(varTypeStr, node, { flags: SymbolTypeFlag.typetime, fullName: varTypeStr, data: data, tableProvider: () => symbolTable });
        //     if (type) {
        //         symbolTable.addSymbol(varName, { ...data, isFromDocComment: true }, type, SymbolTypeFlag.runtime);
        //     }
        // }
    }

    private processDocTagsAtTopLevel(doc: BrightScriptDoc, node: AstNode) {
        //TODO:
        // - handle import statements?
        // - handle library statements?
        // - handle typecast statements?
        // - handle alias statements?
        // - handle const statements?
        // - allow interface definitions?
    }

    /**
     * Validate that a statement is defined in one of these specific locations
     *  - the root of the AST
     *  - inside a namespace
     * This is applicable to things like FunctionStatement, ClassStatement, NamespaceStatement, EnumStatement, InterfaceStatement
     */
    private validateDeclarationLocations(statement: Statement, keyword: string, locatableFactory?: () => Locatable) {
        //if nested inside a namespace, or defined at the root of the AST (i.e. in a body that has no parent)
        const isOkDeclarationLocation = (parentNode: AstNode | undefined) => {
            return isNamespaceStatement(parentNode?.parent) || (isBody(parentNode) && !parentNode?.parent);
        };
        if (isOkDeclarationLocation(statement.parent)) {
            return;
        }

        // is this in a conditional compile whose outermost statement is at an ok location? Climbs `#else if` chains and nested `#if` statements
        let conditionalCompile = statement.parent?.parent;
        if (isConditionalCompileStatement(conditionalCompile)) {
            while (true) {
                const parentNode = conditionalCompile.parent;
                if (isConditionalCompileStatement(parentNode)) {
                    conditionalCompile = parentNode;
                } else if (isBlock(parentNode) && isConditionalCompileStatement(parentNode.parent)) {
                    conditionalCompile = parentNode.parent;
                } else {
                    break;
                }
            }
            if (isOkDeclarationLocation(conditionalCompile.parent)) {
                return;
            }
        }

        //the statement was defined in the wrong place. Flag it.
        this.event.program.diagnostics.register({
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel(keyword),
            location: locatableFactory ? locatableFactory() : statement
        });
    }

    /**
     * The maximum function name length, in characters, before the Roku device truncates it
     * when converting it to a string (e.g. via `ToStr()` or when printed in a stack trace).
     * Verified on real devices running Roku OS 15.x. See https://github.com/rokucommunity/brighterscript/issues/1003.
     */
    private static MaxFunctionNameLength = 89;

    /**
     * Compute the runtime name of a class method. Methods are transpiled onto the class builder as
     * `__<transpiledClassName>_method_<methodName>`, so the effective name is meaningfully longer than
     * the name written in source.
     */
    private getMethodRuntimeName(node: MethodStatement): string | undefined {
        const methodName = node.tokens.name?.text;
        const classStatement = node.findAncestor<ClassStatement>(isClassStatement);
        if (!methodName || !classStatement) {
            return undefined;
        }
        const className = classStatement.getName(ParseMode.BrightScript)?.replace(/\./g, '_');
        if (!className) {
            return undefined;
        }
        return `__${className}_method_${methodName}`;
    }

    private validateFunctionNameLength(node: FunctionStatement, name: string) {
        if (name && name.length > BrsFileValidator.MaxFunctionNameLength) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.functionNameTooLong(name, name.length, BrsFileValidator.MaxFunctionNameLength),
                location: util.firstLocatable<Locatable>(node.tokens.name, node)
            });
        }
    }

    /**
     * A parameter with a type designator (i.e. `name$`) can only have an `as` type that matches it (i.e. `name$ as string`).
     * Anything else, including `as dynamic` and `as object`, is a "Type Mismatch" compile error on device.
     */
    private validateTypeDesignatorMatchesDeclaredType(param: FunctionParameterExpression) {
        const designatorType = param.getMismatchedTypeDesignatorType();
        if (!designatorType) {
            return;
        }
        const paramName = param.tokens.name.text;
        const declaredType = param.typeExpression.getName(ParseMode.BrighterScript);
        this.event.program.diagnostics.register({
            ...DiagnosticMessages.typeDesignatorMismatch(paramName, designatorType.toString(), declaredType),
            location: param.location
        });
    }

    private validateFunctionParameterCount(func: FunctionExpression) {
        if (func.parameters.length > CallExpression.MaximumArguments) {
            //flag every parameter over the limit
            for (let i = CallExpression.MaximumArguments; i < func.parameters.length; i++) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.tooManyCallableParameters(func.parameters.length, CallExpression.MaximumArguments),
                    location: util.firstLocatable<Locatable>(func.parameters[i]?.tokens.name, func.parameters[i], func)
                });
            }
        }
    }

    private validatePrintStatementItemCount(statement: PrintStatement) {
        const { valueCount, commaCount } = statement.getPrintCounts();
        const count = valueCount + commaCount;
        if (count > PrintStatement.MaximumPrintCount) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.tooManyPrintItems(count, PrintStatement.MaximumPrintCount),
                location: statement
            });
        }
    }

    /**
     * Flag functions whose own variables (parameters, assigned names, loop variables, catch variables) exceed the device limit.
     * Nested functions have their own limit and are not included. Names that are only read are not counted, so the count is a lower bound.
     */
    private validateFunctionVariableCount(func: FunctionExpression) {
        //keep the locatable for each variable, and only build a `Location` for the one we report
        const variableLocatables = new Map<string, Locatable>();
        const addVariable = (nameToken: Token | undefined, fallback: Locatable) => {
            const name = nameToken?.text?.toLowerCase();
            if (name && !variableLocatables.has(name)) {
                variableLocatables.set(name, nameToken.sourceInfo ? nameToken : fallback);
            }
        };
        // count all the parameters as they count as variables
        for (const parameter of func.parameters) {
            addVariable(parameter.tokens.name, parameter);
        }

        // count all the variables in the function body
        func.body?.walk(createVisitor({
            AssignmentStatement: (statement) => {
                addVariable(statement.tokens.name, statement);
            },
            AugmentedAssignmentStatement: (statement) => {
                if (isVariableExpression(statement.item)) {
                    addVariable(statement.item.tokens.name, statement);
                }
            },
            DimStatement: (statement) => {
                addVariable(statement.tokens.name, statement);
            },
            IncrementStatement: (statement) => {
                if (isVariableExpression(statement.value)) {
                    addVariable(statement.value.tokens.name, statement);
                }
            },
            ForEachStatement: (statement) => {
                addVariable(statement.tokens.item, statement);
            },
            CatchStatement: (statement) => {
                const exceptionVariable = isTypecastExpression(statement.exceptionVariableExpression) ? statement.exceptionVariableExpression.obj : statement.exceptionVariableExpression;
                if (isVariableExpression(exceptionVariable)) {
                    addVariable(exceptionVariable.tokens.name, statement);
                }
            }
        }), { walkMode: WalkMode.visitAll });

        if (variableLocatables.size > FunctionExpression.MaximumVariables) {
            const firstOverLimit = [...variableLocatables.values()][FunctionExpression.MaximumVariables];
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.tooManyFunctionVariables(variableLocatables.size, FunctionExpression.MaximumVariables),
                location: util.firstLocatable<Locatable>(firstOverLimit, func.tokens.functionType, func)
            });
        }
    }

    /**
     * Add the literals directly inside the function body to the file's literal pools.
     * Nested functions are collected when they are visited themselves, so every function in the file shares the same pools.
     * Literals outside functions are not counted. A function's default parameter values count with that function.
     * Brighterscript source literals (like `SOURCE_LINE_NUM` or `PKG_PATH`) count as the literals they transpile to, in .bs files only.
     * `LINE_NUM` (and the `str(LINE_NUM)` that `PKG_LOCATION` transpiles to) counts as the integer `line % 65536`; for .bs files this is the source line, which can differ from the transpiled line.
     * Enum and const values that get inlined are not counted.
     * Quoted associative array keys count as strings; unquoted keys and dotted property names do not.
     * Template strings, regex literals and callfunc (`@.`) count as the literals they transpile to: `chr(N)` escapes as integers, the `roRegex` pieces and the callfunc method name as strings.
     * Values are deduplicated by normalized value: integers by numeric value (`1` and `&h1` match), doubles by numeric value, floats by single-precision numeric value, strings by their content.
     */
    private collectFunctionLiterals(func: FunctionExpression) {
        const pools = this.literalPools;
        const addToPool = (poolName: LiteralPoolName, key: string | number, location: Locatable) => {
            let pool = pools[poolName];
            if (!pool) {
                pool = { values: new Set<string | number>(), firstOverLimitLocation: undefined };
                pools[poolName] = pool;
            }
            pool.values.add(key);
            if (pool.firstOverLimitLocation === undefined && pool.values.size > maximumLiteralsPerType) {
                pool.firstOverLimitLocation = location;
            }
        };

        const literalVisitor = createVisitor({
            LiteralExpression: (literal) => {
                if (literal.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    return;
                }
                const token = literal.tokens.value;
                const text = token.text;
                switch (token.kind) {
                    case TokenKind.IntegerLiteral:
                        addToPool('integer', /^&h/i.test(text) ? parseInt(text.slice(2), 16) : Number(text.replace('%', '')), literal);
                        break;
                    case TokenKind.LongIntegerLiteral:
                        addToPool('longinteger', getLongIntegerKey(text), literal);
                        break;
                    case TokenKind.FloatLiteral:
                        addToPool('float', Math.fround(getFloatingPointValue(text)), literal);
                        break;
                    case TokenKind.DoubleLiteral:
                        addToPool('double', getFloatingPointValue(text), literal);
                        break;
                    case TokenKind.StringLiteral:
                        addToPool('string', getStringLiteralKey(text), literal);
                        break;
                    case TokenKind.TemplateStringQuasi:
                        //empty quasi strings are dropped from template strings, but tagged templates keep them
                        if (text !== '' || isTaggedTemplateStringExpression(literal.parent?.parent)) {
                            addToPool('string', text, literal);
                        }
                        break;
                    default:
                        break;
                }
            },
            SourceLiteralExpression: (sourceLiteral) => {
                if (sourceLiteral.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    return;
                }
                for (const part of this.getSourceLiteralReplacements(sourceLiteral, this.event.file)) {
                    addToPool(part.type, part.value, sourceLiteral);
                }
                const literalKind = sourceLiteral.tokens.value.kind;
                const lineRange = sourceLiteral.location?.range;
                if (lineRange && (literalKind === TokenKind.LineNumLiteral || literalKind === TokenKind.PkgLocationLiteral)) {
                    addToPool('integer', (lineRange.start.line + 1) % 65536, sourceLiteral);
                }
            },
            AAMemberExpression: (member) => {
                const keyToken = member.tokens.key;
                if (keyToken?.kind !== TokenKind.StringLiteral || member.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    return;
                }
                addToPool('string', getStringLiteralKey(keyToken.text), util.firstLocatable<Locatable>(keyToken, member));
            },
            //template string escapes (like `\n` or `"`) transpile to `chr(charCode)`
            EscapedCharCodeLiteralExpression: (escape) => {
                if (escape.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    return;
                }
                addToPool('integer', escape.tokens.value.charCode, escape);
            },
            //`/pattern/flags` transpiles to `CreateObject("roRegex", "pattern", "flags")`, with each `"` in the pattern split out as `chr(34)`
            RegexLiteralExpression: (regex) => {
                if (regex.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    return;
                }
                let text = regex.tokens.regexLiteral?.text ?? '';
                let flags = '';
                const flagMatch = /\/([a-z]+)$/i.exec(text);
                if (flagMatch) {
                    text = text.substring(0, flagMatch.index + 1);
                    flags = flagMatch[1];
                }
                const patternParts = text.substring(1, text.length - 1).split('"');
                addToPool('string', 'roRegex', regex);
                for (const part of patternParts) {
                    addToPool('string', part, regex);
                }
                if (patternParts.length > 1) {
                    addToPool('integer', 34, regex);
                }
                addToPool('string', flags, regex);
            },
            //`node@.method()` transpiles to `node.callfunc("method")`
            CallfuncExpression: (callfunc) => {
                //skip incomplete code (like `node@.` while typing), which has no method name yet
                if (!callfunc.tokens.methodName || callfunc.findAncestor<FunctionExpression>(isFunctionExpression) !== func) {
                    return;
                }
                addToPool('string', callfunc.tokens.methodName.text, util.firstLocatable<Locatable>(callfunc.tokens.methodName, callfunc));
            }
        });

        func.body?.walk(literalVisitor, { walkMode: WalkMode.visitAll });
        for (const param of func.parameters ?? []) {
            param.walk(literalVisitor, { walkMode: WalkMode.visitAll });
        }
    }

    /**
     * Get the literals a source literal is replaced with when transpiled (mirrors `SourceLiteralExpression.transpile`).
     * Returns an empty array for source literals that stay native identifiers (like `LINE_NUM`).
     * `PKG_LOCATION` additionally emits a native `str(LINE_NUM)` that is not part of the returned parts.
     */
    private getSourceLiteralReplacements(sourceLiteral: SourceLiteralExpression, file: BrsFile): Array<{ type: LiteralPoolName; value: string | number }> {
        switch (sourceLiteral.tokens.value.kind) {
            case TokenKind.SourceFilePathLiteral:
                const pathUrl = util.fileUrl(file.srcPath);
                return [
                    { type: 'string', value: pathUrl.substring(0, 4) },
                    { type: 'string', value: pathUrl.substring(4) }
                ];
            case TokenKind.SourceLineNumLiteral:
                return [{ type: 'integer', value: this.getClosestLineNumber(sourceLiteral) }];
            case TokenKind.FunctionNameLiteral:
                return [{ type: 'string', value: this.getSourceLiteralFunctionName(sourceLiteral, ParseMode.BrightScript) }];
            case TokenKind.SourceFunctionNameLiteral:
                return [{ type: 'string', value: this.getSourceLiteralFunctionName(sourceLiteral, ParseMode.BrighterScript) }];
            case TokenKind.SourceNamespaceNameLiteral:
                let namespaceParts = this.getSourceLiteralFunctionName(sourceLiteral, ParseMode.BrighterScript).split('.');
                namespaceParts.pop(); // remove the function name
                return [{ type: 'string', value: namespaceParts.join('.') }];
            case TokenKind.SourceNamespaceRootNameLiteral:
                let namespaceRootParts = this.getSourceLiteralFunctionName(sourceLiteral, ParseMode.BrighterScript).split('.');
                namespaceRootParts.pop(); // remove the function name
                return [{ type: 'string', value: namespaceRootParts.shift() ?? '' }];
            case TokenKind.SourceLocationLiteral:
                const locationUrl = util.fileUrl(file.srcPath);
                return [
                    { type: 'string', value: locationUrl.substring(0, 4) },
                    { type: 'string', value: `${locationUrl.substring(4)}:${this.getClosestLineNumber(sourceLiteral)}` }
                ];
            case TokenKind.PkgPathLiteral:
                return [{ type: 'string', value: util.sanitizePkgPath(file.pkgPath) }];
            case TokenKind.PkgLocationLiteral:
                return [{ type: 'string', value: `${util.sanitizePkgPath(file.pkgPath)}:` }];
            default:
                return [];
        }
    }

    /**
     * Get the line number from the node or from the closest ancestor that has a range (mirrors `SourceLiteralExpression`)
     */
    private getClosestLineNumber(node: AstNode) {
        while (node) {
            if (node.location?.range) {
                return node.location.range.start.line + 1;
            }
            node = node.parent;
        }
        return -1;
    }

    /**
     * Get the name of the function a source literal lives in, as `SourceLiteralExpression` computes it when transpiling
     */
    private getSourceLiteralFunctionName(sourceLiteral: SourceLiteralExpression, parseMode: ParseMode) {
        let func = sourceLiteral.findAncestor<FunctionExpression>(isFunctionExpression);
        let nameParts = [] as string[];
        let parentFunction: FunctionExpression;
        while ((parentFunction = func.findAncestor<FunctionExpression>(isFunctionExpression))) {
            nameParts.unshift(`anon${this.findFunctionIndex(parentFunction, func)}`);
            func = parentFunction;
        }
        if (isFunctionStatement(func.parent)) {
            nameParts.unshift(
                func.parent.getName(parseMode)
            );
        }
        return nameParts.join('$');
    }

    /**
     * Find the index of the function in its parent
     */
    private findFunctionIndex(parentFunction: FunctionExpression, func: FunctionExpression) {
        let index = -1;
        parentFunction.findChild((node) => {
            if (isFunctionExpression(node)) {
                index++;
                if (node === func) {
                    return true;
                }
            }
        }, {
            walkMode: WalkMode.visitAllRecursive
        });
        return index;
    }

    /**
     * Flag the file if any literal pool holds more distinct values than the device allows.
     */
    private validateFileLiteralCount() {
        for (const poolName of literalPoolNames) {
            const pool = this.literalPools[poolName];
            if (pool && pool.values.size > maximumLiteralsPerType) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.tooManyLiterals(pool.values.size, poolName, maximumLiteralsPerType),
                    location: pool.firstOverLimitLocation
                });
            }
        }
    }

    /**
     * Flag functions that goto more distinct labels than the device allows. Only labels targeted by a goto count, whether or not the label exists.
     * When `continue` will be transpiled into a goto, each loop containing a continue directly adds one more label.
     * Nested functions have their own limit and are not included.
     */
    private validateFunctionGotoLabelCount(func: FunctionExpression) {
        const labelLocations = new Map<string, Locatable>();
        const continueLoops = new Set<AstNode>();
        const continueIsTranspiled = this.event.file.needsTranspiled && !this.event.program.firmwareCapabilities.continueStatement;
        func.body?.walk(createVisitor({
            GotoStatement: (statement) => {
                const labelName = statement.tokens.label?.text?.toLowerCase();
                if (labelName && !labelLocations.has(labelName)) {
                    labelLocations.set(labelName, util.firstLocatable<Locatable>(statement.tokens.label, statement));
                }
            },
            ContinueStatement: (statement) => {
                if (!continueIsTranspiled) {
                    return;
                }
                let enclosingLoop = statement.parent;
                while (enclosingLoop && enclosingLoop !== func && !isForStatement(enclosingLoop) && !isForEachStatement(enclosingLoop) && !isWhileStatement(enclosingLoop)) {
                    enclosingLoop = enclosingLoop.parent;
                }
                if (enclosingLoop && enclosingLoop !== func && !continueLoops.has(enclosingLoop)) {
                    continueLoops.add(enclosingLoop);
                    labelLocations.set(`continue-loop:${continueLoops.size}`, statement);
                }
            }
        }), { walkMode: WalkMode.visitAll });

        if (labelLocations.size > FunctionExpression.MaximumGotoLabels) {
            const firstOverLimitLocation = [...labelLocations.values()][FunctionExpression.MaximumGotoLabels];
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.tooManyGotoLabels(labelLocations.size, FunctionExpression.MaximumGotoLabels),
                location: firstOverLimitLocation ?? util.firstLocatable<Locatable>(func.tokens.functionType, func)
            });
        }
    }

    private validateEnumDeclaration(stmt: EnumStatement) {
        const members = stmt.getMembers();
        //the enum data type is based on the first member value
        const enumValueKind = (members.find(x => x.value)?.value as LiteralExpression)?.tokens?.value?.kind ?? TokenKind.IntegerLiteral;
        const memberNames = new Set<string>();
        for (const member of members) {
            const memberNameLower = member.name?.toLowerCase();

            /**
             * flag duplicate member names
             */
            if (memberNames.has(memberNameLower)) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.duplicateIdentifier(member.name),
                    location: member
                });
            } else {
                memberNames.add(memberNameLower);
            }

            //Enforce all member values are the same type
            this.validateEnumValueTypes(member, enumValueKind);
        }
    }

    private validateEnumValueTypes(member: EnumMemberStatement, enumValueKind: TokenKind) {
        let memberValueKind: TokenKind;
        let memberValue: Expression;
        if (isUnaryExpression(member.value)) {
            memberValueKind = (member.value?.right as LiteralExpression)?.tokens?.value?.kind;
            memberValue = member.value?.right;
        } else {
            memberValueKind = (member.value as LiteralExpression)?.tokens?.value?.kind;
            memberValue = member.value;
        }
        const valueLocatable: Locatable = memberValue ?? member;
        if (
            //is integer enum, has value, that value type is not integer
            (enumValueKind === TokenKind.IntegerLiteral && memberValueKind && memberValueKind !== enumValueKind) ||
            //has value, that value is not a literal
            (memberValue && !isLiteralExpression(memberValue))
        ) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.enumValueMustBeType(
                    enumValueKind.replace(/literal$/i, '').toLowerCase()
                ),
                location: valueLocatable
            });
        }

        //is non integer value
        if (enumValueKind !== TokenKind.IntegerLiteral) {
            //default value present
            if (memberValueKind) {
                //member value is same as enum
                if (memberValueKind !== enumValueKind) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.enumValueMustBeType(
                            enumValueKind.replace(/literal$/i, '').toLowerCase()
                        ),
                        location: valueLocatable
                    });
                }

                //default value missing
            } else {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.enumValueIsRequired(
                        enumValueKind.replace(/literal$/i, '').toLowerCase()
                    ),
                    location: valueLocatable
                });
            }
        }
    }


    /**
     * Validate an active `#const` against the constants in effect at its position in the file (the walk resolved it just before visiting it)
     */
    private validateHashConst(statement: ConditionalCompileConstStatement) {
        const assignment = statement.assignment;
        if (!isLiteralBoolean(assignment.value)) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.invalidHashConstValue(),
                location: assignment.value
            });
        } else if (statement.isDuplicate) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.duplicateConstDeclaration(assignment.tokens.name.text),
                location: assignment.tokens.name
            });
        }
    }

    /**
     * Report the statements of a function that control flow can never reach, one diagnostic per run.
     * Functions inside an already reported run are skipped, since the outer report covers them,
     * and so are functions that overlap a parse error, since the AST there does not reflect what the author meant.
     */
    private flagControlFlowUnreachableCode(func: FunctionExpression) {
        if (func.isActive === false || this.isInsideControlFlowUnreachableRun(func) || this.hasParseDiagnosticWithin(func)) {
            return;
        }
        const analysis = findUnreachableRegions(func);
        for (const node of analysis.unreachableNodes) {
            this.controlFlowUnreachableNodes.add(node);
        }
        for (const chain of analysis.coveredConditionalCompileChains) {
            this.controlFlowCoveredChains.add(chain);
        }
        for (const [chain, runLocation] of analysis.partiallyCoveredConditionalCompileChains) {
            this.controlFlowPartiallyCoveredChains.set(chain, runLocation);
        }
        for (const region of analysis.regions) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.unreachableCode(region.message),
                location: region.location
            });
        }
    }

    /**
     * Is the node, or any ancestor of it, a statement inside a run that control flow already reported?
     */
    private isInsideControlFlowUnreachableRun(node: AstNode) {
        for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
            if (this.controlFlowUnreachableNodes.has(ancestor)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Does any parser diagnostic intersect the function's range?
     * The diagnostics are indexed once per validator, so each call is a binary search instead of a scan.
     */
    private hasParseDiagnosticWithin(func: FunctionExpression) {
        if (func.startPosition === undefined || !func.sourceInfo) {
            return false;
        }
        const index = this.getParseDiagnosticIndex(func.sourceInfo);
        let low = 0;
        let high = index.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (index[middle].startPosition < func.endPosition) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low > 0 && index[low - 1].furthestEndPosition > func.startPosition;
    }

    private getParseDiagnosticIndex(sourceInfo: SourceInfo) {
        if (!this.parseDiagnosticIndex) {
            const spans = this.event.file.parser.diagnostics
                //parser diagnostics are usually Locatables (tokens/nodes). Convert any resolved `Location` into positions too
                .map(diagnostic => {
                    const location = diagnostic.location;
                    if (location && ('startPosition' in location || !('uri' in location))) {
                        return location as Locatable;
                    }
                    const range = (location as Location)?.range;
                    return {
                        startPosition: util.getOffset(sourceInfo, range?.start),
                        endPosition: util.getOffset(sourceInfo, range?.end)
                    };
                })
                //synthetic locatables have no positions
                .filter(span => span?.startPosition !== undefined && span.endPosition !== undefined)
                .sort((spanA, spanB) => spanA.startPosition - spanB.startPosition);
            let furthestEndPosition = -1;
            this.parseDiagnosticIndex = spans.map(span => {
                furthestEndPosition = Math.max(furthestEndPosition, span.endPosition);
                return { startPosition: span.startPosition, furthestEndPosition: furthestEndPosition };
            });
        }
        return this.parseDiagnosticIndex;
    }

    /**
     * Fade each inactive branch of a reached `#if` / `#else if`: the lines between its directives, so the directive lines themselves stay unfaded.
     * An `#if` inside an inactive branch is never visited, and the outer branch already covers it. A branch with no lines between its directives is not reported.
     * A branch already covered by a control flow unreachable run is not reported either.
     */
    private flagInactiveConditionalCompileBranches(statement: ConditionalCompileStatement) {
        //the control flow analysis records coverage on the first `#if` of the chain, and an active `#else if` is visited on its own
        let chainStart = statement;
        while (isConditionalCompileStatement(chainStart.parent) && chainStart.parent.elseBranch === chainStart) {
            chainStart = chainStart.parent;
        }
        if (this.controlFlowCoveredChains.has(chainStart) || this.isInsideControlFlowUnreachableRun(chainStart)) {
            return;
        }
        this.flagInactiveBranchBodies(statement, this.controlFlowPartiallyCoveredChains.get(chainStart));
    }

    /**
     * @param statement the `#if` / `#else if` whose inactive branches to fade
     * @param overlappingRunLocation a run reported by control flow that ends inside the chain. A branch it overlaps is already reported by it.
     */
    private flagInactiveBranchBodies(statement: ConditionalCompileStatement, overlappingRunLocation: Location | undefined) {
        for (const branch of [statement.thenBranch, statement.elseBranch]) {
            if (isConditionalCompileStatement(branch)) {
                //an `#else if` is stored as this statement's `elseBranch`. Once the chain has taken an earlier branch, the walk skips it
                //and it is inactive, so fade its branches here. When the chain reaches it, it is active and the walk visits it on its own
                if (branch.isActive === false) {
                    this.flagInactiveBranchBodies(branch, overlappingRunLocation);
                }
            } else if (branch?.isActive === false && branch.sourceInfo) {
                //the branch runs from the end of its opening directive to the start of its closing directive
                const { start, end } = util.getLocation(branch).range;
                if (end.line - start.line > 1) {
                    const location = util.createLocation(start.line + 1, 0, end.line, 0, this.event.file.srcPath);
                    if (overlappingRunLocation && util.rangesIntersect(location.range, overlappingRunLocation.range)) {
                        continue;
                    }
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.inactiveConditionalCompileBranch(),
                        location: location
                    });
                }
            }
        }
    }

    /**
     * Flag a reached `#if` / `#else if` condition that names an undeclared constant, unless the target firmware evaluates it as false
     */
    private validateHashIfCondition(statement: ConditionalCompileStatement) {
        if (statement.isConditionDeclared === false && statement.tokens.condition && !this.event.program.firmwareCapabilities.undeclaredHashConstIsFalse) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.hashConstDoesNotExist(),
                location: statement.tokens.condition
            });
        }
    }

    /**
     * Find statements defined at the top level (or inside a namespace body) that are not allowed to be there
     */
    private flagTopLevelStatements() {
        const statements = [...this.event.file.ast.statements];
        while (statements.length > 0) {
            const statement = statements.pop();
            if (isNamespaceStatement(statement)) {
                statements.push(...statement.body.statements);
            } else {
                //only allow these statement types
                if (
                    !isFunctionStatement(statement) &&
                    !isClassStatement(statement) &&
                    !isEnumStatement(statement) &&
                    !isInterfaceStatement(statement) &&
                    !isLibraryStatement(statement) &&
                    !isImportStatement(statement) &&
                    !isConstStatement(statement) &&
                    !isTypecastStatement(statement) &&
                    !isConditionalCompileConstStatement(statement) &&
                    !isConditionalCompileErrorStatement(statement) &&
                    !isConditionalCompileStatement(statement) &&
                    !isAliasStatement(statement) &&
                    !isTypeStatement(statement)
                ) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementOutsideFunction(),
                        location: statement
                    });
                }
            }
        }
    }

    private isAllowedAtTopOfFile(statement: Statement): statement is LibraryStatement | ImportStatement | TypecastStatement | AliasStatement {
        return isLibraryStatement(statement) || isImportStatement(statement) || isTypecastStatement(statement) || isAliasStatement(statement);
    }

    private getTopOfFileStatements() {
        let topOfFileIncludeStatements = [] as Array<LibraryStatement | ImportStatement | TypecastStatement | AliasStatement>;
        for (let stmt of this.event.file.parser.ast.statements) {
            //if we found a non-library statement, this statement is not at the top of the file
            if (this.isAllowedAtTopOfFile(stmt)) {
                topOfFileIncludeStatements.push(stmt);
            } else {
                //break out of the loop, we found all of our library statements
                break;
            }
        }
        return topOfFileIncludeStatements;
    }

    private validateTopOfFileStatements() {
        let topOfFileStatements = this.getTopOfFileStatements();

        let statements = [
            // eslint-disable-next-line @typescript-eslint/dot-notation
            ...this.event.file['_cachedLookups'].libraryStatements,
            // eslint-disable-next-line @typescript-eslint/dot-notation
            ...this.event.file['_cachedLookups'].importStatements,
            // eslint-disable-next-line @typescript-eslint/dot-notation
            ...this.event.file['_cachedLookups'].aliasStatements
        ];
        for (let result of statements) {
            //if this statement is not one of the top-of-file statements,
            //then add a diagnostic explaining that it is invalid
            if (!topOfFileStatements.includes(result)) {
                if (isLibraryStatement(result)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementLocation('library', 'at the top of the file'),
                        location: result
                    });
                } else if (isImportStatement(result)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementLocation('import', 'at the top of the file'),
                        location: result
                    });
                } else if (isAliasStatement(result)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementLocation('alias', 'at the top of the file'),
                        location: result
                    });
                }
            }
        }
    }

    private validateTypecastStatements() {
        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let typecastStmt of this.event.file['_cachedLookups'].typecastStatements) {
            let isBadTypecastObj = false;

            const block = typecastStmt.findAncestor<Body | Block>(node => (isBody(node) || isBlock(node)));
            const resultVarStr = util.getAllDottedGetPartsAsString(typecastStmt.typecastExpression.obj);
            const hasFunctionAncestor = !!typecastStmt.findAncestor(isFunctionExpression);
            if (!isVariableExpression(typecastStmt.typecastExpression.obj)) {
                isBadTypecastObj = true;
            } else if (!hasFunctionAncestor && resultVarStr.toLowerCase() !== 'm') {
                // only 'm' can be typecast outside of a function body
                isBadTypecastObj = true;
            } else if (block.getSymbolTable().hasSymbol(resultVarStr, SymbolTypeFlag.typetime)) {
                // can only typecast runtime symbols
                isBadTypecastObj = true;
            }

            if (isBadTypecastObj) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.invalidTypecastStatementApplication(resultVarStr, hasFunctionAncestor),
                    location: typecastStmt.typecastExpression.obj
                });
            }

            let isFirst = true;
            for (let i = 0; i < typecastStmt.statementIndex; i++) {
                const targetStatement = block.statements[i];
                // allow multiple typecast statements at the top of a block or namespace, but no other statements before them
                isFirst = isFirst && this.isAllowedAtTopOfFile(targetStatement);
                if (isTypecastStatement(targetStatement) && targetStatement !== typecastStmt) {
                    // do not allow multiple typecast statements that typecast the same variable, even if they are at the top of the block/namespace
                    const otherResultVarStr = util.getAllDottedGetPartsAsString(targetStatement.typecastExpression.obj);
                    if (otherResultVarStr.toLowerCase() === resultVarStr.toLowerCase()) {
                        isFirst = false;
                    }
                }
                if (!isFirst) {
                    break;
                }
            }

            if (!isFirst) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of block or namespace'),
                    location: typecastStmt
                });
            }
        }
    }

    private validateSelectCaseStatement(statement: SelectCaseStatement) {
        if (statement.cases.length === 0) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.selectCaseHasNoCases(),
                location: util.setBounds({} as Locatable, statement.tokens.select, statement.tokens.case)
            });
            return;
        }

        //`case else` must be the last case, and there can only be one of them.
        //(A missing `case else` depends on the subject's type, so the ScopeValidator checks for that)
        const elseCases = statement.cases.filter(x => x.isElse);
        if (elseCases.length > 0) {
            for (const elseCase of elseCases.slice(1)) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.duplicateCaseElse(),
                    location: util.setBounds({} as Locatable, elseCase.tokens.case, elseCase.tokens.else)
                });
            }
            //only flag the first one. Any others were already flagged as duplicates
            if (statement.cases.indexOf(elseCases[0]) < statement.cases.length - elseCases.length) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.caseElseMustBeLast(),
                    location: util.setBounds({} as Locatable, elseCases[0].tokens.case, elseCases[0].tokens.else)
                });
            }
        }

        //people coming from C-style languages might expect an empty case to fall through to the next one. It doesn't.
        //A case containing only a comment (or `exit select`) is treated as intentionally empty. (Comments are trivia, so they live on the next `case` keyword)
        for (let i = 0; i < statement.cases.length - 1; i++) {
            const caseStatement = statement.cases[i];
            if (
                !caseStatement.isElse &&
                !(caseStatement.body?.statements.length > 0) &&
                !util.hasLeadingComments(statement.cases[i + 1].tokens.case)
            ) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.emptyCaseDoesNotFallThrough(),
                    location: caseStatement.tokens.case
                });
            }
        }

        this.validateCaseValues(statement);
    }

    /**
     * Flag duplicate case values, and literal values whose type can't be compared against the others
     */
    private validateCaseValues(statement: SelectCaseStatement) {
        //the type of every literal case value should match the subject (or, when the subject isn't a literal, the first literal case value)
        let expectedType = this.getCaseLiteralType(statement.subject);
        const seenValues = new Map<string, Expression>();

        for (const caseStatement of statement.cases) {
            for (const value of caseStatement.values) {
                const key = this.getCaseValueKey(value);
                if (key) {
                    const firstValue = seenValues.get(key);
                    if (firstValue) {
                        this.event.program.diagnostics.register({
                            ...DiagnosticMessages.duplicateCaseValue(
                                util.getTextForRange(this.event.file.fileContents, util.getLocation(value)?.range) ?? key,
                                util.getStartPosition(firstValue)?.line + 1
                            ),
                            location: value
                        });
                    } else {
                        seenValues.set(key, value);
                    }
                }

                const valueType = this.getCaseLiteralType(value);
                if (valueType) {
                    if (!expectedType) {
                        expectedType = valueType;
                    } else if (valueType !== expectedType) {
                        this.event.program.diagnostics.register({
                            ...DiagnosticMessages.caseValueTypeMismatch(valueType, expectedType),
                            location: value
                        });
                    }
                }
            }
        }
    }

    /**
     * Get the comparison type of a literal case value (or `select case` subject). `invalid` and non-literals return undefined,
     * because we can't know what they'll be compared against
     */
    private getCaseLiteralType(expression: Expression | undefined): 'string' | 'number' | 'boolean' | undefined {
        //negative numbers like `-1` are unary expressions
        if (isUnaryExpression(expression) && expression.tokens.operator.kind === TokenKind.Minus) {
            return isLiteralNumber(expression.right) ? 'number' : undefined;
        }
        if (isLiteralString(expression)) {
            return 'string';
        } else if (isLiteralNumber(expression)) {
            return 'number';
        } else if (isLiteralBoolean(expression)) {
            return 'boolean';
        }
    }

    /**
     * Get a key that identifies a case value, so that exact duplicates can be found. Only literals and variable names
     * (including enums and constants like `Direction.up`) produce a key, since anything else could produce a different value each time
     */
    private getCaseValueKey(expression: Expression): string | undefined {
        if (isUnaryExpression(expression) && expression.tokens.operator.kind === TokenKind.Minus && isLiteralNumber(expression.right)) {
            return `literal:-${expression.right.tokens.value.text.toLowerCase()}`;
        }
        if (isLiteralExpression(expression)) {
            //string comparisons are case sensitive, but everything else (`true`, `&HFF`, etc) is not
            const text = expression.tokens.value.text;
            return `literal:` + (isLiteralString(expression) ? text : text.toLowerCase());
        }
        //only plain dotted names like `a.b.c` (not `getObject().value`)
        let root = expression;
        while (isDottedGetExpression(root)) {
            root = root.obj;
        }
        if (isVariableExpression(root)) {
            const parts = util.getAllDottedGetParts(expression);
            if (parts) {
                return 'name:' + parts.map(x => x.text.toLowerCase()).join('.');
            }
        }
    }

    private validateContinueStatement(statement: ContinueStatement) {
        const validateLoopTypeMatch = (expectedLoopType: TokenKind) => {
            //coerce ForEach to For
            expectedLoopType = expectedLoopType === TokenKind.ForEach ? TokenKind.For : expectedLoopType;
            const actualLoopType = statement.tokens.loopType;
            if (actualLoopType && expectedLoopType?.toLowerCase() !== actualLoopType.text?.toLowerCase()) {
                this.event.program.diagnostics.register({
                    location: statement.tokens.loopType,
                    ...DiagnosticMessages.expectedToken(expectedLoopType)
                });
            }
        };

        //find the parent loop statement
        const parent = statement.findAncestor<WhileStatement | ForStatement | ForEachStatement>((node) => {
            if (isWhileStatement(node)) {
                validateLoopTypeMatch(node.tokens.while.kind);
                return true;
            } else if (isForStatement(node)) {
                validateLoopTypeMatch(node.tokens.for.kind);
                return true;
            } else if (isForEachStatement(node)) {
                validateLoopTypeMatch(node.tokens.forEach.kind);
                return true;
            }
        });
        //flag continue statements found outside of a loop
        if (!parent) {
            this.event.program.diagnostics.register({
                location: statement,
                ...DiagnosticMessages.illegalContinueStatement()
            });
        }
        this.validateMinFirmwareVersionForContinue(statement);
    }

    /**
     * Add a diagnostic when a file that will NOT be transpiled uses `continue` while targeting
     * firmware older than the version that introduced it. Transpiled files are exempt because
     * `ContinueStatement.transpile` rewrites `continue` into a `goto` label jump for those
     * targets, so the emitted code runs on the older device.
     */
    private validateMinFirmwareVersionForContinue(statement: ContinueStatement) {
        if (this.event.file.needsTranspiled) {
            return;
        }
        if (!this.event.program.firmwareCapabilities.continueStatement) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.featureRequiresMinFirmwareVersion(
                    'continue',
                    CONTINUE_MIN_FIRMWARE_VERSION,
                    this.event.program.getMinFirmwareVersion()
                ),
                location: statement
            });
        }
    }

    /**
     * Validate that there are no optional chaining operators on the left-hand-side of an assignment, indexed set, or dotted get
     */
    private validateSpreadPosition(node: ArrayLiteralExpression | AALiteralExpression) {
        if (util.getSpreadLiteralOwnerStatement(node)) {
            return;
        }
        for (const element of node.elements) {
            if (isSpreadExpression(element)) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.spreadOperatorNotAllowedHere(),
                    location: element.tokens.dotDotDot
                });
            }
        }
    }

    private validateNoOptionalChainingInVarSet(parent: AstNode, children: AstNode[]) {
        const nodes = [...children, parent];
        //flag optional chaining anywhere in the left of this statement
        while (nodes.length > 0) {
            const node = nodes.shift();
            if (
                // a?.b = true or a.b?.c = true
                ((isDottedSetStatement(node) || isDottedGetExpression(node)) && node.tokens.dot?.kind === TokenKind.QuestionDot) ||
                // a.b?[2] = true
                (isIndexedGetExpression(node) && (node?.tokens.questionDot?.kind === TokenKind.QuestionDot || node.tokens.openingSquare?.kind === TokenKind.QuestionLeftSquare)) ||
                // a?[1] = true
                (isIndexedSetStatement(node) && node.tokens.openingSquare?.kind === TokenKind.QuestionLeftSquare)
            ) {
                //try to highlight the entire left-hand-side expression if possible
                let locatable: Locatable;
                if (isDottedSetStatement(parent)) {
                    locatable = util.setBounds({} as Locatable, parent.obj, parent.tokens.dot, parent.tokens.name);
                } else if (isIndexedSetStatement(parent)) {
                    locatable = util.setBounds({} as Locatable, parent.obj, parent.tokens.openingSquare, ...parent.indexes, parent.tokens.closingSquare);
                } else {
                    locatable = node;
                }

                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                    location: locatable
                });
            }

            if (node === parent) {
                break;
            } else {
                nodes.push(node.parent);
            }
        }
    }

    /**
     * A `case else` that is the only case in its `select case` always runs all the way through (unless it can `exit select` early)
     */
    private isAlwaysExecutedCase(node: AstNode) {
        return isCaseStatement(node) &&
            node.isElse &&
            isSelectCaseStatement(node.parent) &&
            node.parent.cases.length === 1 &&
            !node.canExitEarly;
    }

    private setUpComplementSymbolTables(node: IfStatement | ConditionalCompileStatement, predicate: (node: AstNode) => boolean) {
        if (isBlock(node.elseBranch)) {
            const elseTable = node.elseBranch.symbolTable;
            let currentNode = node;
            while (predicate(currentNode)) {
                const thenBranch = (currentNode as IfStatement | ConditionalCompileStatement).thenBranch;
                elseTable.complementOtherTable(thenBranch.symbolTable);
                currentNode = currentNode.parent as IfStatement | ConditionalCompileStatement;
            }
        }
    }

    /**
     * Flag regex literals that `roRegex` would fail to compile (i.e. `/(abc/`), and unsupported flags
     */
    private validateRegexLiteral(node: RegexLiteralExpression) {
        const token = node.tokens.regexLiteral;
        if (!token?.sourceInfo) {
            return;
        }
        //problem offsets are relative to the start of the token
        for (const problem of findRegexLiteralProblems(token.text)) {
            this.event.program.diagnostics.register({
                ...problem.diagnostic,
                location: {
                    startPosition: token.startPosition + problem.start,
                    endPosition: token.startPosition + problem.end,
                    sourceInfo: token.sourceInfo
                }
            });
        }
    }

    /**
     * Add a diagnostic if the configured minFirmwareVersion is lower than the version that
     * introduced optional chaining support (Roku OS 11).
     * This applies to both .brs and .bs files because optional chaining is not transpiled —
     * it is emitted as-is, so the target device must natively support it.
     */
    private validateMinFirmwareVersionForOptionalChaining(locatable: Locatable | undefined) {
        if (!this.event.program.firmwareCapabilities.optionalChaining) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.featureRequiresMinFirmwareVersion(
                    'optional chaining',
                    OPTIONAL_CHAINING_MIN_FIRMWARE_VERSION,
                    this.event.program.getMinFirmwareVersion()
                ),
                location: locatable
            });
        }
    }

    /**
     * For a bare top-level call to a known global callable, fire one deprecation/removal
     * diagnostic driven by `callable.availability`. The rsg axis takes precedence: if it
     * fires, the os axis is skipped entirely. The os axis is only consulted when rsg is
     * silent (rsg axis not configured, or effective rsg below its thresholds).
     *
     * Skips method calls (`m.foo()`) and namespaced calls (`alpha.foo()`) — only the bare
     * top-level builtin form resolves to a global callable.
     */
    private validateGlobalCallableAvailability(node: CallExpression) {
        if (!isVariableExpression(node.callee)) {
            return;
        }
        const calleeName = node.callee.name?.text;
        if (!calleeName) {
            return;
        }
        const callable = globalCallableMap.get(calleeName.toLowerCase());
        const availability = callable?.availability;
        if (!availability) {
            return;
        }
        const rsgDiagnostic = this.computeAvailabilityDiagnostic(calleeName, 'rsg', availability.rsg, this.event.file.program.getRsgVersion());
        const diagnostic = rsgDiagnostic ??
            this.computeAvailabilityDiagnostic(calleeName, 'os', availability.os, this.event.file.program.getMinFirmwareVersion());
        if (diagnostic) {
            this.event.program.diagnostics.register({
                ...diagnostic,
                location: node.callee
            });
        }
    }

    /**
     * Compute (but don't emit) the diagnostic for one axis of {@link Availability}: returns
     * `globalCallableRemoved` if the project's effective version is at/past the axis's
     * `removed` threshold, otherwise `globalCallableDeprecated` if it's at/past `deprecated`,
     * otherwise `undefined`.
     *
     * `effectiveVersion` is expected in canonical semver form (program getters guarantee this);
     * availability constants are authored in canonical form too, so no coercion is needed here.
     */
    private computeAvailabilityDiagnostic(calleeName: string, axis: AvailabilityAxis, info: { added?: string; deprecated?: string; removed?: string } | undefined, effectiveVersion: string) {
        if (!info) {
            return undefined;
        }
        if (info.removed && semver.gte(effectiveVersion, info.removed)) {
            return DiagnosticMessages.globalCallableRemoved(calleeName, axis, info.removed, effectiveVersion);
        }
        if (info.deprecated && semver.gte(effectiveVersion, info.deprecated)) {
            return DiagnosticMessages.globalCallableDeprecated(calleeName, axis, info.deprecated, effectiveVersion);
        }
        return undefined;
    }
}

/**
 * The maximum number of distinct literal values of a single type (integer, string, float, double, longinteger) a file can hold.
 * Repeated identical values count once, and every function in the file, including anonymous functions, shares the same pools.
 */
export const maximumLiteralsPerType = 65535;

const literalPoolNames: LiteralPoolName[] = ['integer', 'string', 'float', 'double', 'longinteger'];

function getStringLiteralKey(text: string) {
    return text.endsWith('"') && text.length > 1 ? text.slice(1, -1) : text.slice(1);
}

function getLongIntegerKey(text: string) {
    const digits = text.replace(/&$/, '');
    try {
        return BigInt(/^&h/i.test(digits) ? '0x' + digits.slice(2) : digits).toString();
    } catch {
        return digits;
    }
}

function getFloatingPointValue(text: string) {
    return Number(text.toLowerCase().replace(/[!#%&]$/, '').replace('d', 'e'));
}

type LiteralPoolName = 'integer' | 'string' | 'float' | 'double' | 'longinteger';

interface LiteralPool {
    values: Set<string | number>;
    firstOverLimitLocation: Locatable | undefined;
}

interface LabelsAndGotos {
    labels: LabelStatement[];
    gotos: GotoStatement[];
}
