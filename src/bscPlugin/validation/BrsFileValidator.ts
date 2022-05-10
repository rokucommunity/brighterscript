import { isLiteralExpression } from '../..';
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

    private diagnostics: BsDiagnostic[];

    public process() {
        this.diagnostics = [];
        this.validateEnumDeclarations();
        this.validateComponentStatements();
        this.event.file.addDiagnostics(this.diagnostics);
    }

    public validateEnumDeclarations() {
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
                    this.diagnostics.push({
                        ...DiagnosticMessages.duplicateIdentifier(member.name),
                        file: this.event.file,
                        range: member.range
                    });
                } else {
                    memberNames.add(memberNameLower);
                }

                //Enforce all member values are the same type
                this.validateEnumValueTypes(member, enumValueKind);
            }
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
            this.diagnostics.push({
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
                    this.diagnostics.push({
                        file: this.event.file,
                        ...DiagnosticMessages.enumValueMustBeType(
                            enumValueKind.replace(/literal$/i, '').toLowerCase()
                        ),
                        range: (member.value ?? member)?.range
                    });
                }

                //default value missing
            } else {
                this.diagnostics.push({
                    file: this.event.file,
                    ...DiagnosticMessages.enumValueIsRequired(
                        enumValueKind.replace(/literal$/i, '').toLowerCase()
                    ),
                    range: (member.value ?? member)?.range
                });
            }
        }
    }

    private validateComponentStatements() {
        for (const component of this.event.file.parser.references.componentStatements) {
            //members must have an access modifier
            for (const member of component.getMembers()) {
                if (!member.accessModifier) {
                    this.diagnostics.push({
                        ...DiagnosticMessages.accessModifierIsRequired(),
                        range: member.name.range,
                        file: this.event.file
                    });
                }
            }
        }
    }
}
