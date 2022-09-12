import { isClassStatement, isCommentStatement, isConstStatement, isDottedGetExpression, isEnumStatement, isFunctionStatement, isImportStatement, isInterfaceStatement, isLibraryStatement, isLiteralExpression, isNamespacedVariableNameExpression, isNamespaceStatement } from '../../astUtils/reflection';
import { WalkMode } from '../../astUtils/visitors';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { AstNode, OnFileValidateEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { LiteralExpression } from '../../parser/Expression';
import type { EnumMemberStatement, EnumStatement } from '../../parser/Statement';

export class BrsFileValidator {
    constructor(
        public event: OnFileValidateEvent<BrsFile>
    ) {
    }

    public process() {
        this.walk();
        this.flagTopLevelStatements();
    }

    /**
     * Set the parent node on a given AstNode. This handles some edge cases where not every expression is iterated normally,
     * so it will also reach into nested objects to set their parent values as well
     */
    private setParent(node1: AstNode, parent: AstNode) {
        const pairs = [[node1, parent]];
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
        }
    }

    /**
     * Walk the full AST
     */
    private walk() {
        this.event.file.ast.walk((node, parent) => {
            // link every child with its parent
            this.setParent(node, parent);

            //do some file-based validations
            if (isEnumStatement(node)) {
                this.validateEnumDeclaration(node);
            }
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
        const memberValueKind = (member.value as LiteralExpression)?.token?.kind;

        if (
            //is integer enum, has value, that value type is not integer
            (enumValueKind === TokenKind.IntegerLiteral && memberValueKind && memberValueKind !== enumValueKind) ||
            //has value, that value is not a literal
            (member.value && !isLiteralExpression(member.value))
        ) {
            this.event.file.addDiagnostic({
                ...DiagnosticMessages.enumValueMustBeType(
                    enumValueKind.replace(/literal$/i, '').toLowerCase()
                ),
                range: (member.value ?? member)?.range
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
                        range: (member.value ?? member)?.range
                    });
                }

                //default value missing
            } else {
                this.event.file.addDiagnostic({
                    file: this.event.file,
                    ...DiagnosticMessages.enumValueIsRequired(
                        enumValueKind.replace(/literal$/i, '').toLowerCase()
                    ),
                    range: (member.value ?? member)?.range
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
}
