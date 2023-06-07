import { isBody, isClassStatement, isCommentStatement, isConstStatement, isDottedGetExpression, isDottedSetStatement, isEnumStatement, isForEachStatement, isForStatement, isFunctionStatement, isImportStatement, isIndexedGetExpression, isIndexedSetStatement, isInterfaceStatement, isLibraryStatement, isLiteralExpression, isNamespaceStatement, isNamespaceType, isUnaryExpression, isWhileStatement } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { GetTypeOptions, OnFileValidateEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression, Statement } from '../../parser/AstNode';
import type { LiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ContinueStatement, EnumMemberStatement, EnumStatement, ForEachStatement, ForStatement, ImportStatement, LibraryStatement, WhileStatement } from '../../parser/Statement';
import { SymbolTypeFlag } from '../../SymbolTable';
import type { BscType } from '../../types/BscType';
import { DynamicType } from '../../types/DynamicType';
import { NamespaceType } from '../../types/NamespaceType';
import util from '../../util';
import type { Range } from 'vscode-languageserver';

export class BrsFileValidator {
    constructor(
        public event: OnFileValidateEvent<BrsFile>
    ) {
    }

    public process() {
        util.validateTooDeepFile(this.event.file);
        this.walk();
        this.flagTopLevelStatements();
        //only validate the file if it was actually parsed (skip files containing typedefs)
        if (!this.event.file.hasTypedef) {
            this.validateImportStatements();
        }
    }

    /**
     *  Wrapper for getting the type from an expression, so we can use a program option to just return a default Dynamic type
     */
    private getTypeFromNode(node: AstNode, options?: GetTypeOptions): BscType {
        if (this.event.program.options.enableTypeValidation) {
            return node.getType(options);
        }
        return DynamicType.instance;
    }


    /**
     * Walk the full AST
     */
    private walk() {
        const visitor = createVisitor({
            MethodStatement: (node) => {
                //add the `super` symbol to class methods
                //Todo:  get the actual type of the parent class
                node.func.body.symbolTable.addSymbol('super', undefined, DynamicType.instance, SymbolTypeFlag.runtime);
            },
            CallfuncExpression: (node) => {
                if (node.args.length > 5) {
                    this.event.file.addDiagnostic({
                        ...DiagnosticMessages.callfuncHasToManyArgs(node.args.length),
                        range: node.methodName.range
                    });
                }
            },
            EnumStatement: (node) => {
                this.validateDeclarationLocations(node, 'enum', () => util.createBoundingRange(node.tokens.enum, node.tokens.name));

                this.validateEnumDeclaration(node);

                //register this enum declaration
                const nodeType = this.getTypeFromNode(node, { flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name.text, node.tokens.name.range, nodeType, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime);
            },
            ClassStatement: (node) => {
                this.validateDeclarationLocations(node, 'class', () => util.createBoundingRange(node.classKeyword, node.name));

                //register this class
                const nodeType = this.getTypeFromNode(node, { flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable()?.addSymbol(node.name.text, node.name.range, nodeType, SymbolTypeFlag.typetime | SymbolTypeFlag.runtime);
            },
            AssignmentStatement: (node) => {
                //register this variable
                const nodeType = this.getTypeFromNode(node, { flags: SymbolTypeFlag.runtime });
                node.parent.getSymbolTable()?.addSymbol(node.name.text, node.name.range, nodeType, SymbolTypeFlag.runtime);
            },
            DottedSetStatement: (node) => {
                this.validateNoOptionalChainingInVarSet(node, [node.obj]);
            },
            IndexedSetStatement: (node) => {
                this.validateNoOptionalChainingInVarSet(node, [node.obj]);
            },
            ForEachStatement: (node) => {
                //register the for loop variable
                node.parent.getSymbolTable()?.addSymbol(node.item.text, node.item.range, DynamicType.instance, SymbolTypeFlag.runtime);
            },
            NamespaceStatement: (node) => {
                this.validateDeclarationLocations(node, 'namespace', () => util.createBoundingRange(node.keyword, node.nameExpression));

                // Since namespaces are accessed via a DottedGetExpression, we need to build the types for
                // the top level namespace, all the way down.
                const namespaceParts = node.name.split('.');
                const topLevel = namespaceParts[0];
                if (!topLevel) {
                    return;
                }
                const parentSymbolTable = node.parent.getSymbolTable();
                // eslint-disable-next-line no-bitwise
                const namespaceTypeFlags = SymbolTypeFlag.runtime | SymbolTypeFlag.typetime;

                //Build namespace types, part by part, if they don't exist
                //Last one can use the node's `getType()` method
                let nameSoFar = '';
                let nextNamespaceType: BscType;
                let currentSymbolTable = parentSymbolTable;
                for (let i = 0; i < namespaceParts.length; i++) {
                    const part = namespaceParts[i];
                    nameSoFar += (i > 0 ? '.' : '') + part;
                    //TODO: is this correct?
                    nextNamespaceType = currentSymbolTable.getSymbol(part, SymbolTypeFlag.typetime)?.[0]?.type;

                    if (!isNamespaceType(nextNamespaceType)) {
                        // if it is the last one, ie, the part that represents this node/namespace.
                        // make sure the namespace's symboltable is a provider for the previous types' member table
                        nextNamespaceType = (i === namespaceParts.length - 1) ? node.getType({ flags: SymbolTypeFlag.typetime }) : new NamespaceType(nameSoFar);
                        currentSymbolTable.addSymbol(part, node.nameExpression.range, nextNamespaceType, namespaceTypeFlags);

                    }
                    // this type already exists!
                    if (i === namespaceParts.length - 1) {
                        // something could have previously been added to the the type's memberTable, which is just as valid as adding it to the namespaceStatement's symboltable
                        //
                        node.getSymbolTable().addSibling(nextNamespaceType.memberTable);
                    }

                    currentSymbolTable = nextNamespaceType.memberTable;
                }
            },
            FunctionStatement: (node) => {
                this.validateDeclarationLocations(node, 'function', () => util.createBoundingRange(node.func.functionType, node.name));
                const funcType = node.getType({ flags: SymbolTypeFlag.typetime });

                if (node.name?.text) {
                    node.parent.getSymbolTable().addSymbol(
                        node.name.text,
                        node.name.range,
                        funcType,
                        SymbolTypeFlag.runtime
                    );
                }

                const namespace = node.findAncestor(isNamespaceStatement);
                //this function is declared inside a namespace
                if (namespace) {
                    namespace.getSymbolTable().addSymbol(
                        node.name.text,
                        node.name.range,
                        funcType,
                        SymbolTypeFlag.runtime
                    );
                    //add the transpiled name for namespaced functions to the root symbol table
                    const transpiledNamespaceFunctionName = node.getName(ParseMode.BrightScript);

                    this.event.file.parser.ast.symbolTable.addSymbol(
                        transpiledNamespaceFunctionName,
                        node.name.range,
                        funcType,
                        SymbolTypeFlag.runtime
                    );
                }
            },
            FunctionExpression: (node) => {
                if (!node.symbolTable.hasSymbol('m', SymbolTypeFlag.runtime)) {
                    node.symbolTable.addSymbol('m', undefined, DynamicType.instance, SymbolTypeFlag.runtime);
                }
            },
            FunctionParameterExpression: (node) => {
                const paramName = node.name?.text;
                const symbolTable = node.getSymbolTable();
                const nodeType = node.getType({ flags: SymbolTypeFlag.typetime });
                symbolTable?.addSymbol(paramName, node.name.range, nodeType, SymbolTypeFlag.runtime);
            },
            InterfaceStatement: (node) => {
                this.validateDeclarationLocations(node, 'interface', () => util.createBoundingRange(node.tokens.interface, node.tokens.name));

                const nodeType = this.getTypeFromNode(node, { flags: SymbolTypeFlag.typetime });
                // eslint-disable-next-line no-bitwise
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, node.tokens.name.range, nodeType, SymbolTypeFlag.runtime | SymbolTypeFlag.typetime);
            },
            ConstStatement: (node) => {
                this.validateDeclarationLocations(node, 'const', () => util.createBoundingRange(node.tokens.const, node.tokens.name));
                const nodeType = this.getTypeFromNode(node, { flags: SymbolTypeFlag.typetime });
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, node.tokens.name.range, nodeType, SymbolTypeFlag.runtime);
            },
            CatchStatement: (node) => {
                node.parent.getSymbolTable().addSymbol(node.exceptionVariable.text, node.exceptionVariable.range, DynamicType.instance, SymbolTypeFlag.runtime);
            },
            DimStatement: (node) => {
                if (node.identifier) {
                    node.parent.getSymbolTable().addSymbol(node.identifier.text, node.identifier.range, DynamicType.instance, SymbolTypeFlag.runtime);
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
    private validateDeclarationLocations(statement: Statement, keyword: string, rangeFactory?: () => Range) {
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
        const enumValueKind = (members.find(x => x.value)?.value as LiteralExpression)?.token?.kind ?? TokenKind.IntegerLiteral;
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
            memberValueKind = (member.value?.right as LiteralExpression)?.token?.kind;
            memberValue = member.value?.right;
        } else {
            memberValueKind = (member.value as LiteralExpression)?.token?.kind;
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
            ...this.event.file['_parser'].references.libraryStatements,
            // eslint-disable-next-line @typescript-eslint/dot-notation
            ...this.event.file['_parser'].references.importStatements
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
                validateLoopTypeMatch(node.forToken.kind);
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
                ((isDottedSetStatement(node) || isDottedGetExpression(node)) && node.dot?.kind === TokenKind.QuestionDot) ||
                // a.b?[2] = true
                (isIndexedGetExpression(node) && (node?.questionDotToken?.kind === TokenKind.QuestionDot || node.openingSquare?.kind === TokenKind.QuestionLeftSquare)) ||
                // a?[1] = true
                (isIndexedSetStatement(node) && node.openingSquare?.kind === TokenKind.QuestionLeftSquare)
            ) {
                //try to highlight the entire left-hand-side expression if possible
                let range: Range;
                if (isDottedSetStatement(parent)) {
                    range = util.createBoundingRange(parent.obj, parent.dot, parent.name);
                } else if (isIndexedSetStatement(parent)) {
                    range = util.createBoundingRange(parent.obj, parent.openingSquare, parent.index, parent.closingSquare);
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
