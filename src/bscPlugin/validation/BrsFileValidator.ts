import { isAliasStatement, isArrayType, isBlock, isBody, isCallableType, isClassStatement, isClassType, isConditionalCompileConstStatement, isConditionalCompileErrorStatement, isConditionalCompileStatement, isConstStatement, isDottedGetExpression, isDottedSetStatement, isEnumStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isImportStatement, isIndexedGetExpression, isIndexedSetStatement, isInterfaceStatement, isInvalidType, isLibraryStatement, isLiteralExpression, isMethodStatement, isNamespaceStatement, isStatement, isTypecastExpression, isTypecastStatement, isTypedFunctionType, isUnaryExpression, isVariableExpression, isVoidType, isWhileStatement } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnFileValidateEvent, TypeCompatibilityData } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import type { FunctionExpression, LiteralExpression } from '../../parser/Expression';
import { CallExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ContinueStatement, EnumMemberStatement, EnumStatement, ForEachStatement, ForStatement, ImportStatement, LibraryStatement, Body, WhileStatement, TypecastStatement, Block, AliasStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTypeFlag';
import { ArrayDefaultTypeReferenceType } from '../../types/ReferenceType';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import { DynamicType } from '../../types/DynamicType';
import util from '../../util';
import type { Range } from 'vscode-languageserver';
import type { Token } from '../../lexer/Token';
import type { BrightScriptDoc } from '../../parser/BrightScriptDocParser';
import brsDocParser from '../../parser/BrightScriptDocParser';
import { UninitializedType } from '../../types';

export class BrsFileValidator {
    constructor(
        public event: OnFileValidateEvent<BrsFile>
    ) {
    }


    public process() {
        const unlinkGlobalSymbolTable = this.event.file.parser.symbolTable.pushParentProvider(() => this.event.program.globalScope.symbolTable);

        util.validateTooDeepFile(this.event.file);

        // Invalidate cache on this file
        // It could have potentially changed before this from plugins, after this, it will not change
        // eslint-disable-next-line @typescript-eslint/dot-notation
        this.event.file['_cachedLookups'].invalidate();

        // make a copy of the bsConsts, because they might be added to
        const bsConstsBackup = new Map<string, boolean>(this.event.file.ast.getBsConsts());

        this.walk();
        this.flagTopLevelStatements();
        //only validate the file if it was actually parsed (skip files containing typedefs)
        if (!this.event.file.hasTypedef) {
            this.validateTopOfFileStatements();
            this.validateTypecastStatements();
        }

        this.event.file.ast.bsConsts = bsConstsBackup;
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
            CallfuncExpression: (node) => {
                if (node.args.length > 5) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.callfuncHasToManyArgs(node.args.length),
                        location: node.tokens.methodName.location
                    });
                }
            },
            EnumStatement: (node) => {
                this.validateDeclarationLocations(node, 'enum', () => util.createBoundingRange(node.tokens.enum, node.tokens.name));

                this.validateEnumDeclaration(node);

                //register this enum declaration
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime);
            },
            ClassStatement: (node) => {
                this.validateDeclarationLocations(node, 'class', () => util.createBoundingRange(node.tokens.class, node.tokens.name));

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
            ForEachStatement: (node) => {
                //register the for loop variable
                const loopTargetType = node.target.getType({ flags: SymbolTypeFlag.runtime });
                let loopVarType = isArrayType(loopTargetType) ? loopTargetType.defaultType : DynamicType.instance;
                if (!loopTargetType.isResolvable()) {
                    loopVarType = new ArrayDefaultTypeReferenceType(loopTargetType);
                }
                node.parent.getSymbolTable()?.addSymbol(node.tokens.item.text, { definingNode: node, isInstance: true }, loopVarType, SymbolTypeFlag.runtime);
            },
            NamespaceStatement: (node) => {
                this.validateDeclarationLocations(node, 'namespace', () => util.createBoundingRange(node.tokens.namespace, node.nameExpression));
                //Namespace Types are added at the Scope level - This is handled when the SymbolTables get linked
            },
            FunctionStatement: (node) => {
                this.validateDeclarationLocations(node, 'function', () => util.createBoundingRange(node.func.tokens.functionType, node.tokens.name));
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
                        funcSymbolTable?.addSymbol('m', { isInstance: true }, new AssociativeArrayType(), SymbolTypeFlag.runtime);
                    }
                }
                this.validateFunctionParameterCount(node);
            },
            FunctionParameterExpression: (node) => {
                const paramName = node.tokens.name?.text;
                const data: ExtraSymbolData = {};
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime, data: data });
                // add param symbol at expression level, so it can be used as default value in other params
                const funcExpr = node.findAncestor<FunctionExpression>(isFunctionExpression);
                const funcSymbolTable = funcExpr?.getSymbolTable();
                funcSymbolTable?.addSymbol(paramName, { definingNode: node, isInstance: true, isFromDocComment: data.isFromDocComment }, nodeType, SymbolTypeFlag.runtime);

                //also add param symbol at block level, as it may be redefined, and if so, should show a union
                funcExpr.body.getSymbolTable()?.addSymbol(paramName, { definingNode: node, isInstance: true, isFromDocComment: data.isFromDocComment }, nodeType, SymbolTypeFlag.runtime);
            },
            InterfaceStatement: (node) => {
                this.validateDeclarationLocations(node, 'interface', () => util.createBoundingRange(node.tokens.interface, node.tokens.name));

                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime);
            },
            ConstStatement: (node) => {
                this.validateDeclarationLocations(node, 'const', () => util.createBoundingRange(node.tokens.const, node.tokens.name));
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
                        location: node.exceptionVariableExpression?.location ?? node.tokens.catch?.location
                    });
                }
            },
            DimStatement: (node) => {
                if (node.tokens.name) {
                    node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, isInstance: true }, node.getType({ flags: SymbolTypeFlag.runtime }), SymbolTypeFlag.runtime);
                }
            },
            ContinueStatement: (node) => {
                this.validateContinueStatement(node);
            },
            TypecastStatement: (node) => {
                node.parent.getSymbolTable().addSymbol('m', { definingNode: node, doNotMerge: true, isInstance: true }, node.getType({ flags: SymbolTypeFlag.typetime }), SymbolTypeFlag.runtime);
            },
            ConditionalCompileConstStatement: (node) => {
                const assign = node.assignment;
                const constNameLower = assign.tokens.name?.text.toLowerCase();
                const astBsConsts = this.event.file.ast.bsConsts;
                if (isLiteralExpression(assign.value)) {
                    astBsConsts.set(constNameLower, assign.value.tokens.value.text.toLowerCase() === 'true');
                } else if (isVariableExpression(assign.value)) {
                    if (this.validateConditionalCompileConst(assign.value.tokens.name)) {
                        astBsConsts.set(constNameLower, astBsConsts.get(assign.value.tokens.name.text.toLowerCase()));
                    }
                }
            },
            ConditionalCompileStatement: (node) => {
                this.validateConditionalCompileConst(node.tokens.condition);
            },
            ConditionalCompileErrorStatement: (node) => {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.hashError(node.tokens.message.text),
                    location: node.location
                });
            },
            AliasStatement: (node) => {
                // eslint-disable-next-line no-bitwise
                const targetType = node.value.getType({ flags: SymbolTypeFlag.typetime | SymbolTypeFlag.runtime });

                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node, doNotMerge: true, isAlias: true }, targetType, SymbolTypeFlag.runtime | SymbolTypeFlag.typetime);

            },
            AstNode: (node) => {
                if (isStatement(node)) {
                    this.validateAnnotations(node);
                }
                this.handleDocTags(node);
            }
        });

        this.event.file.ast.walk((node, parent) => {
            visitor(node, parent);
        }, {
            walkMode: WalkMode.visitAllRecursive
        });
    }


    private handleDocTags(node: AstNode) {
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
    private validateDeclarationLocations(statement: Statement, keyword: string, rangeFactory?: () => (Range | undefined)) {
        //if nested inside a namespace, or defined at the root of the AST (i.e. in a body that has no parent)
        const isOkDeclarationLocation = (parentNode) => {
            return isNamespaceStatement(parentNode?.parent) || (isBody(parentNode) && !parentNode?.parent);
        };
        if (isOkDeclarationLocation(statement.parent)) {
            return;
        }

        // is this in a top levelconditional compile?
        if (isConditionalCompileStatement(statement.parent?.parent)) {
            if (isOkDeclarationLocation(statement.parent.parent.parent)) {
                return;
            }
        }

        //the statement was defined in the wrong place. Flag it.
        this.event.program.diagnostics.register({
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel(keyword),
            location: rangeFactory ? util.createLocationFromFileRange(this.event.file, rangeFactory()) : statement.location
        });
    }

    private validateFunctionParameterCount(func: FunctionExpression) {
        if (func.parameters.length > CallExpression.MaximumArguments) {
            //flag every parameter over the limit
            for (let i = CallExpression.MaximumArguments; i < func.parameters.length; i++) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.tooManyCallableParameters(func.parameters.length, CallExpression.MaximumArguments),
                    location: func.parameters[i]?.tokens.name?.location ?? func.parameters[i]?.location ?? func.location
                });
            }
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
                    location: member.location
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
        const range = (memberValue ?? member)?.location?.range;
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
                location: util.createLocationFromFileRange(this.event.file, range)
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
                        location: util.createLocationFromFileRange(this.event.file, range)
                    });
                }

                //default value missing
            } else {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.enumValueIsRequired(
                        enumValueKind.replace(/literal$/i, '').toLowerCase()
                    ),
                    location: util.createLocationFromFileRange(this.event.file, range)
                });
            }
        }
    }


    private validateConditionalCompileConst(ccConst: Token) {
        const isBool = ccConst.kind === TokenKind.True || ccConst.kind === TokenKind.False;
        if (!isBool && !this.event.file.ast.bsConsts.has(ccConst.text.toLowerCase())) {
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.hashConstDoesNotExist(),
                location: ccConst.location
            });
            return false;
        }
        return true;
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
                    !isAliasStatement(statement)
                ) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementOutsideFunction(),
                        location: statement.location
                    });
                }
            }
        }
    }

    private getTopOfFileStatements() {
        let topOfFileIncludeStatements = [] as Array<LibraryStatement | ImportStatement | TypecastStatement | AliasStatement>;
        for (let stmt of this.event.file.parser.ast.statements) {
            //if we found a non-library statement, this statement is not at the top of the file
            if (isLibraryStatement(stmt) || isImportStatement(stmt) || isTypecastStatement(stmt) || isAliasStatement(stmt)) {
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
                        location: result.location
                    });
                } else if (isImportStatement(result)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementLocation('import', 'at the top of the file'),
                        location: result.location
                    });
                } else if (isAliasStatement(result)) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.unexpectedStatementLocation('alias', 'at the top of the file'),
                        location: result.location
                    });
                }
            }
        }
    }

    private validateTypecastStatements() {
        let topOfFileTypecastStatements = this.getTopOfFileStatements().filter(stmt => isTypecastStatement(stmt));

        //check only one `typecast` statement at "top" of file (eg. before non import/library statements)
        for (let i = 1; i < topOfFileTypecastStatements.length; i++) {
            const typecastStmt = topOfFileTypecastStatements[i];
            this.event.program.diagnostics.register({
                ...DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of function or namespace'),
                location: typecastStmt.location
            });
        }

        // eslint-disable-next-line @typescript-eslint/dot-notation
        for (let result of this.event.file['_cachedLookups'].typecastStatements) {
            let isBadTypecastObj = false;
            if (!isVariableExpression(result.typecastExpression.obj)) {
                isBadTypecastObj = true;
            } else if (result.typecastExpression.obj.tokens.name.text.toLowerCase() !== 'm') {
                isBadTypecastObj = true;
            }
            if (isBadTypecastObj) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.invalidTypecastStatementApplication(util.getAllDottedGetPartsAsString(result.typecastExpression.obj)),
                    location: result.typecastExpression.obj.location
                });
            }

            if (topOfFileTypecastStatements.includes(result)) {
                // already validated
                continue;
            }

            const block = result.findAncestor<Body | Block>(node => (isBody(node) || isBlock(node)));
            const isFirst = block?.statements[0] === result;
            const isAllowedBlock = (isBody(block) || isFunctionExpression(block.parent) || isNamespaceStatement(block.parent));

            if (!isFirst || !isAllowedBlock) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.unexpectedStatementLocation('typecast', 'at the top of the file or beginning of function or namespace'),
                    location: result.location
                });
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
                    location: statement.tokens.loopType.location,
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
                location: statement.location,
                ...DiagnosticMessages.illegalContinueStatement()
            });
        }
    }

    /**
     * Validate that there are no optional chaining operators on the left-hand-side of an assignment, indexed set, or dotted get
     */
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
                let range: Range;
                if (isDottedSetStatement(parent)) {
                    range = util.createBoundingRange(parent.obj?.location, parent.tokens.dot, parent.tokens.name);
                } else if (isIndexedSetStatement(parent)) {
                    range = util.createBoundingRange(parent.obj?.location, parent.tokens.openingSquare, ...parent.indexes, parent.tokens.closingSquare);
                } else {
                    range = node.location?.range;
                }

                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                    location: util.createLocationFromFileRange(this.event.file, range)
                });
            }

            if (node === parent) {
                break;
            } else {
                nodes.push(node.parent);
            }
        }
    }

    private validateAnnotations(statement: Statement) {
        if (!statement.annotations || statement.annotations.length < 1) {
            return;
        }

        const symbolTable = this.event.program.pluginAnnotationTable;
        const extraData: ExtraSymbolData = {};

        for (const annotation of statement.annotations) {
            const annotationType = symbolTable.getSymbolType(annotation.name, { flags: SymbolTypeFlag.annotation, data: extraData });

            if (!annotationType || !annotationType?.isResolvable()) {
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.cannotFindAnnotation(annotation.name),
                    location: brsDocParser.getTypeLocationFromToken(annotation.tokens.name) ?? annotation.location
                });
                continue;
            }
            if (!isTypedFunctionType(annotationType)) {
                // TODO: handle multiple function definitions - in that case this would be a UnionType
                continue;
            }
            const { minParams, maxParams } = annotationType.getMinMaxParamCount();
            let expCallArgCount = annotation.call?.args.length ?? 0;
            if (expCallArgCount > maxParams || expCallArgCount < minParams) {
                let minMaxParamsText = minParams === maxParams ? maxParams : `${minParams}-${maxParams}`;
                this.event.program.diagnostics.register({
                    ...DiagnosticMessages.mismatchArgumentCount(minMaxParamsText, expCallArgCount),
                    location: annotation.location
                });
            }

            // validate the arg types - very similar to code in ScopeValidator
            let paramIndex = 0;
            for (let arg of annotation.call?.args ?? []) {
                const data = {} as ExtraSymbolData;
                let argType = arg.getType({ flags: SymbolTypeFlag.runtime, data: data, onlyAllowLiterals: true });

                if (!argType || !argType.isResolvable()) {
                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.expectedLiteralValue('in annotation argument', util.getAllDottedGetPartsAsString(arg)),
                        location: arg.location
                    });
                    break;
                }
                let paramType = annotationType.params[paramIndex]?.type;
                if (!paramType) {
                    // unable to find a paramType -- maybe there are more args than params
                    break;
                }

                if (isCallableType(paramType) && isClassType(argType) && isClassStatement(data.definingNode)) {
                    argType = data.definingNode?.getConstructorType();
                }

                const compatibilityData: TypeCompatibilityData = {};
                if (!argType || !argType.isResolvable() || !paramType?.isTypeCompatible(argType, compatibilityData)) {

                    const argTypeStr = argType?.toString() ?? UninitializedType.instance.toString();

                    this.event.program.diagnostics.register({
                        ...DiagnosticMessages.argumentTypeMismatch(argTypeStr, paramType.toString(), compatibilityData),
                        location: arg.location
                    });
                }
                paramIndex++;
            }
        }
    }

}
