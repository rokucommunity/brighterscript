import { isClassStatement, isCommentStatement, isConstStatement, isEnumStatement, isFunctionStatement, isImportStatement, isInterfaceStatement, isLibraryStatement, isLiteralExpression, isNamespaceStatement } from '../../astUtils/reflection';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic, OnFileValidateEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { LiteralExpression } from '../../parser/Expression';
import type { EnumMemberStatement } from '../../parser/Statement';

export class BrsFileValidator {
    constructor(
        public event: OnFileValidateEvent<BrsFile>
    ) {
    }

    public process() {
        this.validateEnumDeclarations();
        this.flagTopLevelStatements();
    }

    private validateEnumDeclarations() {
        const diagnostics = [] as BsDiagnostic[];
        for (const stmt of this.event.file.parser.references.enumStatements) {
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
                    diagnostics.push({
                        ...DiagnosticMessages.duplicateIdentifier(member.name),
                        file: this.event.file,
                        range: member.range
                    });
                } else {
                    memberNames.add(memberNameLower);
                }

                //Enforce all member values are the same type
                this.validateEnumValueTypes(diagnostics, member, enumValueKind);

            }

        }
        this.event.file.addDiagnostics(diagnostics);
    }

    private validateEnumValueTypes(diagnostics: BsDiagnostic[], member: EnumMemberStatement, enumValueKind: TokenKind) {
        const memberValueKind = (member.value as LiteralExpression)?.token?.kind;

        if (
            //is integer enum, has value, that value type is not integer
            (enumValueKind === TokenKind.IntegerLiteral && memberValueKind && memberValueKind !== enumValueKind) ||
            //has value, that value is not a literal
            (member.value && !isLiteralExpression(member.value))
        ) {
            diagnostics.push({
                file: this.event.file,
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
                    diagnostics.push({
                        file: this.event.file,
                        ...DiagnosticMessages.enumValueMustBeType(
                            enumValueKind.replace(/literal$/i, '').toLowerCase()
                        ),
                        range: (member.value ?? member)?.range
                    });
                }

                //default value missing
            } else {
                diagnostics.push({
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
                        range: statement.range,
                        file: this.event.file
                    });
                }
            }
        }
    }
}
