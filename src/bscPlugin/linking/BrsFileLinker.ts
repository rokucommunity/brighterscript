import { isBlock, isBody, isCaseStatement, isClassStatement, isConditionalCompileStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isIfStatement, isInvalidType, isMethodStatement, isNamespaceStatement, isSelectCaseStatement, isTypecastExpression, isTypecastStatement, isTypedFunctionTypeExpression, isVariableExpression, isVoidType } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, ValidateFileEvent } from '../../interfaces';
import type { AstNode } from '../../parser/AstNode';
import type { FunctionExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { Block, Body, ConditionalCompileStatement, IfStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import { DynamicType } from '../../types/DynamicType';
import type { BrightScriptDoc } from '../../parser/BrightScriptDocParser';
import brsDocParser from '../../parser/BrightScriptDocParser';
import { TypeStatementType } from '../../types/TypeStatementType';
import util from '../../util';

/**
 * Populates a file's symbol tables from its AST and registers the file's symbol information with the program,
 * so that types and symbols can be looked up during validation
 */
export class BrsFileLinker {
    constructor(
        public event: ValidateFileEvent<BrsFile>
    ) {
    }

    public process() {
        const unlinkGlobalSymbolTable = this.event.file.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);

        // Invalidate cache on this file
        // It could have potentially changed before this from plugins, after this, it will not change
        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.event.file['_cachedLookups'].invalidate();
        //rebuild the lookups now, because that full walk resolves every `#if` and `#const` (and sets `isActive`) before the walk below,
        //whose visitors can ask about nodes it has not reached yet (such as the members of a class)
        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.event.file['_cachedLookups'].rehydrate();

        this.walk();
        this.event.file.processSymbolInformation();

        unlinkGlobalSymbolTable();
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
            },
            EnumStatement: (node) => {
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
            //Namespace Types are added at the Scope level - This is handled when the SymbolTables get linked
            FunctionStatement: (node) => {
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

                        this.event.file.parser.ast.symbolTable.addSymbol(
                            transpiledNamespaceFunctionName,
                            { definingNode: node },
                            funcType,
                            // eslint-disable-next-line no-bitwise
                            SymbolTypeFlag.runtime | SymbolTypeFlag.postTranspile
                        );
                    }
                }
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
            },
            FunctionParameterExpression: (node) => {
                if (isTypedFunctionTypeExpression(node.parent)) {
                    return;
                }
                const paramName = node.tokens?.name?.text;
                if (!paramName) {
                    return;
                }
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
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime);
            },
            ConstStatement: (node) => {
                if (!node.tokens.name) {
                    return;
                }
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

                    //brighterscript allows a typecast expression here
                } else if (isBrighterscript && isTypecastExpression(node.exceptionVariableExpression) && isVariableExpression(node.exceptionVariableExpression.obj)) {
                    node.parent.getSymbolTable().addSymbol(
                        node.exceptionVariableExpression.obj.getName(),
                        { definingNode: node, isInstance: true },
                        node.exceptionVariableExpression.getType({ flags: SymbolTypeFlag.runtime }),
                        SymbolTypeFlag.runtime
                    );
                }
            },
            DimStatement: (node) => {
                if (node.tokens.name) {
                    node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, isInstance: true }, node.getType({ flags: SymbolTypeFlag.runtime }), SymbolTypeFlag.runtime);
                }
            },
            TypecastStatement: (node) => {
                const obj = node.typecastExpression.obj;
                if (isVariableExpression(obj)) {
                    node.parent.getSymbolTable().addSymbol(obj.tokens.name.text, { definingNode: node, doNotMerge: true, isInstance: true }, node.getType({ flags: SymbolTypeFlag.typetime }), SymbolTypeFlag.runtime);
                }
            },
            AliasStatement: (node) => {
                // eslint-disable-next-line no-bitwise
                const targetType = node.value.getType({ flags: SymbolTypeFlag.typetime | SymbolTypeFlag.runtime });

                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, doNotMerge: true, isAlias: true }, targetType, SymbolTypeFlag.runtime | SymbolTypeFlag.typetime);

            },
            TypeStatement: (node) => {
                const wrappedNodeType = node.getType({ flags: SymbolTypeFlag.runtime });
                const typeStmtType = new TypeStatementType(node.tokens.name.text, wrappedNodeType);
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, isFromTypeStatement: true }, typeStmtType, SymbolTypeFlag.typetime);

            },
            IfStatement: (node) => {
                this.setUpComplementSymbolTables(node, isIfStatement);
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

                    //the loop variable is scoped to the loop body
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
}
