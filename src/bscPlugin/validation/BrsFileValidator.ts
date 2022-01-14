import { EnumMemberStatement, isIntegerType, isLiteralExpression, isLiteralNumber, isStringType } from '../..';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic, OnFileValidateEvent } from '../../interfaces';
import { TokenKind } from '../../lexer/TokenKind';
import type { LiteralExpression } from '../../parser/Expression';

export class BrsFileValidator {
    constructor(
        public event: OnFileValidateEvent<BrsFile>
    ) {
    }

    public process() {
        this.validateEnums();
    }

    public validateEnums() {
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

                /**
                 * Enforce all member values are the same type
                 */
                this.validateEnumValueTypes(diagnostics, member, enumValueKind);

            }

        }
        this.event.file.addDiagnostics(diagnostics);
    }

    private validateEnumValueTypes(diagnostics: BsDiagnostic[], member: EnumMemberStatement, enumValueKind: TokenKind) {
        const memberValueKind = (member.value as LiteralExpression)?.token.kind;

        //is integer enum, has value, that value type is not integer
        if (enumValueKind === TokenKind.IntegerLiteral && memberValueKind && memberValueKind !== enumValueKind) {
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
}
