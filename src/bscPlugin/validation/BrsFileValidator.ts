import { isIntegerType, isLiteralExpression, isLiteralNumber, isStringType } from '../..';
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
            const enumValueKind = (members.find(x => x.value)?.value as LiteralExpression)?.token?.kind ?? TokenKind.Integer;
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
            }

            /**
             * Enforce all member types are the same
             */

            this.event.file.addDiagnostics(diagnostics);
        }
    }
}
