import { isArrayType, isBody, isBrsFile, isClassStatement, isCommentStatement, isConstStatement, isDottedGetExpression, isDottedSetStatement, isEnumStatement, isForEachStatement, isForStatement, isFunctionExpression, isFunctionStatement, isImportStatement, isIndexedGetExpression, isIndexedSetStatement, isInterfaceStatement, isLibraryStatement, isLiteralExpression, isNamespaceStatement, isUnaryExpression, isWhileStatement } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { ExtraSymbolData, OnFileValidateEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import type { FunctionExpression, LiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ContinueStatement, EnumMemberStatement, EnumStatement, ForEachStatement, ForStatement, ImportStatement, LibraryStatement, WhileStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTableFlag';
import { AssociativeArrayType } from '../../types/AssociativeArrayType';
import { DynamicType } from '../../types/DynamicType';
import util from '../../util';
import type { Range } from 'vscode-languageserver';

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

        this.walk();
        this.flagTopLevelStatements();
        //only validate the file if it was actually parsed (skip files containing typedefs)
        if (!this.event.file.hasTypedef) {
            this.validateImportStatements();
        }

        if (isBrsFile(this.event.file)) {
            this.event.file.processSymbolInformation();
        }
        unlinkGlobalSymbolTable();
    }

    /**
     * Walk the full AST
     */
    private walk() {
        const visitor = createVisitor({
            MethodStatement: (node) => {
                //add the `super` symbol to class methods
                if (isClassStatement(node.parent) && node.parent.hasParentClass()) {
                    const data: ExtraSymbolData = {};
                    const parentClassType = node.parent.parentClassName.getType({ flags: SymbolTypeFlag.typetime, data: data });
                    node.func.body.symbolTable.addSymbol('super', data, parentClassType, SymbolTypeFlag.runtime);
                }
            },
            CallfuncExpression: (node) => {
                if (node.args.length > 5) {
                    this.event.file.addDiagnostic({
                        ...DiagnosticMessages.callfuncHasToManyArgs(node.args.length),
                        range: node.tokens.methodName.range
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
                node.getSymbolTable().addSymbol('m', undefined, nodeType, SymbolTypeFlag.runtime);
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name?.text, { definingNode: node }, nodeType, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime);
            },
            AssignmentStatement: (node) => {
                //register this variable
                const nodeType = node.getType({ flags: SymbolTypeFlag.runtime });
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.runtime);
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
                const loopVarType = isArrayType(loopTargetType) ? loopTargetType.defaultType : DynamicType.instance;
                node.parent.getSymbolTable()?.addSymbol(node.tokens.item.text, { definingNode: node }, loopVarType, SymbolTypeFlag.runtime);
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
                if (!node.symbolTable.hasSymbol('m', SymbolTypeFlag.runtime)) {
                    node.symbolTable.addSymbol('m', undefined, new AssociativeArrayType(), SymbolTypeFlag.runtime);
                }
            },
            FunctionParameterExpression: (node) => {
                const paramName = node.tokens.name?.text;
                const symbolTable = node.findAncestor<FunctionExpression>(isFunctionExpression)?.body.getSymbolTable();
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                symbolTable?.addSymbol(paramName, { definingNode: node }, nodeType, SymbolTypeFlag.runtime);
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
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node }, nodeType, SymbolTypeFlag.runtime);
            },
            CatchStatement: (node) => {
                node.parent.getSymbolTable().addSymbol(node.tokens.exceptionVariable.text, { definingNode: node }, DynamicType.instance, SymbolTypeFlag.runtime);
            },
            DimStatement: (node) => {
                if (node.tokens.name) {
                    node.parent.getSymbolTable().addSymbol(node.tokens.name.text, { definingNode: node }, node.getType({ flags: SymbolTypeFlag.runtime }), SymbolTypeFlag.runtime);
                }
            },
            ContinueStatement: (node) => {
                this.validateContinueStatement(node);
            }
        });

        this.event.file.ast.walk((node, parent) => {
            visitor(node, parent);
        }, {
            walkMode: WalkMode.visitAllRecursive
        });
    }

    /**
     * Validate that a statement is defined in one of these specific locations
     *  - the root of the AST
     *  - inside a namespace
     * This is applicable to things like FunctionStatement, ClassStatement, NamespaceStatement, EnumStatement, InterfaceStatement
     */
    private validateDeclarationLocations(statement: Statement, keyword: string, rangeFactory?: () => (Range | undefined)) {
        //if nested inside a namespace, or defined at the root of the AST (i.e. in a body that has no parent)
        if (isNamespaceStatement(statement.parent?.parent) || (isBody(statement.parent) && !statement.parent?.parent)) {
            return;
        }
        //the statement was defined in the wrong place. Flag it.
        this.event.file.addDiagnostic({
            ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel(keyword),
            range: rangeFactory?.() ?? statement.range
        });
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
                this.event.file.addDiagnostic({
                    ...DiagnosticMessages.duplicateIdentifier(member.name),
                    range: member.range
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
        const range = (memberValue ?? member)?.range;
        if (
            //is integer enum, has value, that value type is not integer
            (enumValueKind === TokenKind.IntegerLiteral && memberValueKind && memberValueKind !== enumValueKind) ||
            //has value, that value is not a literal
            (memberValue && !isLiteralExpression(memberValue))
        ) {
            this.event.file.addDiagnostic({
                ...DiagnosticMessages.enumValueMustBeType(
                    enumValueKind.replace(/literal$/i, '').toLowerCase()
                ),
                range: range
            });
        }

        //is non integer value
        if (enumValueKind !== TokenKind.IntegerLiteral) {
            //default value present
            if (memberValueKind) {
                //member value is same as enum
                if (memberValueKind !== enumValueKind) {
                    this.event.file.addDiagnostic({
                        ...DiagnosticMessages.enumValueMustBeType(
                            enumValueKind.replace(/literal$/i, '').toLowerCase()
                        ),
                        range: range
                    });
                }

                //default value missing
            } else {
                this.event.file.addDiagnostic({
                    file: this.event.file,
                    ...DiagnosticMessages.enumValueIsRequired(
                        enumValueKind.replace(/literal$/i, '').toLowerCase()
                    ),
                    range: range
                });
            }
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
                    !isCommentStatement(statement) &&
                    !isLibraryStatement(statement) &&
                    !isImportStatement(statement) &&
                    !isConstStatement(statement)
                ) {
                    this.event.file.addDiagnostic({
                        ...DiagnosticMessages.unexpectedStatementOutsideFunction(),
                        range: statement.range
                    });
                }
            }
        }
    }

    private validateImportStatements() {
        let topOfFileIncludeStatements = [] as Array<LibraryStatement | ImportStatement>;
        for (let stmt of this.event.file.parser.ast.statements) {
            //skip comments
            if (isCommentStatement(stmt)) {
                continue;
            }
            //if we found a non-library statement, this statement is not at the top of the file
            if (isLibraryStatement(stmt) || isImportStatement(stmt)) {
                topOfFileIncludeStatements.push(stmt);
            } else {
                //break out of the loop, we found all of our library statements
                break;
            }
        }

        let statements = [
            // eslint-disable-next-line @typescript-eslint/dot-notation
            ...this.event.file['_cachedLookups'].libraryStatements,
            // eslint-disable-next-line @typescript-eslint/dot-notation
            ...this.event.file['_cachedLookups'].importStatements
        ];
        for (let result of statements) {
            //if this statement is not one of the top-of-file statements,
            //then add a diagnostic explaining that it is invalid
            if (!topOfFileIncludeStatements.includes(result)) {
                if (isLibraryStatement(result)) {
                    this.event.file.diagnostics.push({
                        ...DiagnosticMessages.libraryStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this.event.file
                    });
                } else if (isImportStatement(result)) {
                    this.event.file.diagnostics.push({
                        ...DiagnosticMessages.importStatementMustBeDeclaredAtTopOfFile(),
                        range: result.range,
                        file: this.event.file
                    });
                }
            }
        }
    }

    private validateContinueStatement(statement: ContinueStatement) {
        const validateLoopTypeMatch = (expectedLoopType: TokenKind) => {
            //coerce ForEach to For
            expectedLoopType = expectedLoopType === TokenKind.ForEach ? TokenKind.For : expectedLoopType;
            const actualLoopType = statement.tokens.loopType;
            if (actualLoopType && expectedLoopType?.toLowerCase() !== actualLoopType.text?.toLowerCase()) {
                this.event.file.addDiagnostic({
                    range: statement.tokens.loopType.range,
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
            this.event.file.addDiagnostic({
                range: statement.range,
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
                    range = util.createBoundingRange(parent.obj, parent.tokens.dot, parent.tokens.name);
                } else if (isIndexedSetStatement(parent)) {
                    range = util.createBoundingRange(parent.obj, parent.tokens.openingSquare, ...parent.indexes, parent.tokens.closingSquare);
                } else {
                    range = node.range;
                }

                this.event.file.addDiagnostic({
                    ...DiagnosticMessages.noOptionalChainingInLeftHandSideOfAssignment(),
                    range: range
                });
            }

            if (node === parent) {
                break;
            } else {
                nodes.push(node.parent);
            }
        }
    }
}
