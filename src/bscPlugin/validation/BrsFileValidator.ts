import { interpolatedRange } from '../../astUtils/creators';
import { isBody, isClassStatement, isCommentStatement, isConstStatement, isDottedGetExpression, isEnumStatement, isForEachStatement, isForStatement, isFunctionStatement, isImportStatement, isInterfaceStatement, isLibraryStatement, isLiteralExpression, isNamespacedVariableNameExpression, isNamespaceStatement, isUnaryExpression, isWhileStatement } from '../../astUtils/reflection';
import { createVisitor, WalkMode } from '../../astUtils/visitors';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { OnFileValidateEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { AstNode, Expression } from '../../parser/AstNode';
import type { LiteralExpression } from '../../parser/Expression';
import { ParseMode } from '../../parser/Parser';
import type { ContinueStatement, EnumMemberStatement, EnumStatement, ForEachStatement, ForStatement, ImportStatement, LibraryStatement, NamespaceStatement, WhileStatement } from '../../parser/Statement';
import { SymbolTable } from '../../SymbolTable';
import { DynamicType } from '../../types/DynamicType';
import util from '../../util';

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
     * Set the parent node on a given AstNode. This handles some edge cases where not every expression is iterated normally,
     * so it will also reach into nested objects to set their parent values as well
     */
    private setParent(node: AstNode, parent: AstNode) {
        const pairs = [[node, parent]];
        while (pairs.length > 0) {
            const [childNode, parentNode] = pairs.pop();
            //skip this entry if there's already a parent
            if (childNode?.parent) {
                continue;
            }
            if (isDottedGetExpression(childNode)) {
                if (!childNode.obj.parent) {
                    pairs.push([childNode.obj, childNode]);
                }
            } else if (isNamespaceStatement(childNode)) {
                //namespace names shouldn't be walked, but it needs its parent assigned
                pairs.push([childNode.nameExpression, childNode]);
            } else if (isClassStatement(childNode)) {
                //class extends names don't get walked, but it needs its parent
                if (childNode.parentClassName) {
                    pairs.push([childNode.parentClassName, childNode]);
                }
            } else if (isInterfaceStatement(childNode)) {
                //class extends names don't get walked, but it needs its parent
                if (childNode.parentInterfaceName) {
                    pairs.push([childNode.parentInterfaceName, childNode]);
                }
            } else if (isNamespacedVariableNameExpression(childNode)) {
                pairs.push([childNode.expression, childNode]);
            }
            childNode.parent = parentNode;
            //if the node has a symbol table, link it to its parent's symbol table
            if (childNode.symbolTable) {
                const parentSymbolTable = parentNode.getSymbolTable();
                if (parentSymbolTable) {
                    childNode.symbolTable.pushParent(parentSymbolTable);
                }
            }
        }
    }

    /**
     * Walk the full AST
     */
    private walk() {
        const visitor = createVisitor({
            MethodStatement: (node) => {
                //add the `super` symbol to class methods
                node.func.body.symbolTable.addSymbol('super', undefined, DynamicType.instance);
            },
            EnumStatement: (node) => {
                this.validateEnumDeclaration(node);

                //register this enum declaration
                node.parent.getSymbolTable()?.addSymbol(node.tokens.name.text, node.tokens.name.range, DynamicType.instance);
            },
            ClassStatement: (node) => {
                //register this class
                node.parent.getSymbolTable()?.addSymbol(node.name.text, node.name.range, DynamicType.instance);
            },
            AssignmentStatement: (node) => {
                //register this variable
                node.parent.getSymbolTable()?.addSymbol(node.name.text, node.name.range, DynamicType.instance);
            },
            FunctionParameterExpression: (node) => {
                node.getSymbolTable()?.addSymbol(node.name.text, node.name.range, node.type);
                //define a symbolTable for each FunctionParameterExpression that contains `m`. TODO, add previous parameter names to this list
                node.symbolTable = new SymbolTable(node.getSymbolTable());
                node.symbolTable.addSymbol('m', interpolatedRange, DynamicType.instance);
            },
            ForEachStatement: (node) => {
                //register the for loop variable
                node.parent.getSymbolTable()?.addSymbol(node.item.text, node.item.range, DynamicType.instance);
            },
            NamespaceStatement: (node) => {
                this.validateNamespaceStatement(node);

                node.parent.getSymbolTable().addSymbol(
                    node.name.split('.')[0],
                    node.nameExpression.range,
                    DynamicType.instance
                );
            },
            FunctionStatement: (node) => {
                if (node.name?.text) {
                    node.parent.getSymbolTable().addSymbol(
                        node.name.text,
                        node.name.range,
                        DynamicType.instance
                    );
                }

                const namespace = node.findAncestor(isNamespaceStatement);
                //this function is declared inside a namespace
                if (namespace) {
                    //add the transpiled name for namespaced functions to the root symbol table
                    const transpiledNamespaceFunctionName = node.getName(ParseMode.BrightScript);
                    const funcType = node.func.getFunctionType();
                    funcType.setName(transpiledNamespaceFunctionName);

                    this.event.file.parser.ast.symbolTable.addSymbol(
                        transpiledNamespaceFunctionName,
                        node.name.range,
                        funcType
                    );
                }
            },
            FunctionExpression: (node) => {
                if (!node.body.symbolTable.hasSymbol('m')) {
                    node.body.symbolTable.addSymbol('m', undefined, DynamicType.instance);
                }
            },
            ConstStatement: (node) => {
                node.parent.getSymbolTable().addSymbol(node.tokens.name.text, node.tokens.name.range, DynamicType.instance);
            },
            CatchStatement: (node) => {
                node.parent.getSymbolTable().addSymbol(node.exceptionVariable.text, node.exceptionVariable.range, DynamicType.instance);
            },
            DimStatement: (node) => {
                if (node.identifier) {
                    node.parent.getSymbolTable().addSymbol(node.identifier.text, node.identifier.range, DynamicType.instance);
                }
            },
            ContinueStatement: (node) => {
                this.validateContinueStatement(node);
            }
        });

        this.event.file.ast.walk((node, parent) => {
            // link every child with its parent
            this.setParent(node, parent);
            visitor(node, parent);
        }, {
            walkMode: WalkMode.visitAllRecursive
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

    private validateNamespaceStatement(stmt: NamespaceStatement) {
        let parentNode = stmt.parent;

        while (parentNode) {
            if (!isNamespaceStatement(parentNode) && !isBody(parentNode)) {
                this.event.file.addDiagnostic({
                    ...DiagnosticMessages.keywordMustBeDeclaredAtNamespaceLevel('namespace'),
                    range: stmt.range
                });
                break;
            }

            parentNode = parentNode.parent;
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
        const validateLoopTypeMatch = (loopType: TokenKind) => {
            //coerce ForEach to For
            loopType = loopType === TokenKind.ForEach ? TokenKind.For : loopType;

            if (loopType?.toLowerCase() !== statement.tokens.loopType.text?.toLowerCase()) {
                this.event.file.addDiagnostic({
                    range: statement.tokens.loopType.range,
                    ...DiagnosticMessages.expectedToken(loopType)
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
}
