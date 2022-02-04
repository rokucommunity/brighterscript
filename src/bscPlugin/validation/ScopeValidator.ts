import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { isBrsFile } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BsDiagnostic, OnScopeValidateEvent } from '../../interfaces';
import type { DottedGetExpression } from '../../parser/Expression';
import util from '../../util';

export class ScopeValidator {
    constructor(
        private event: OnScopeValidateEvent
    ) {
    }

    public process() {
        this.validateEnumUsage();
    }


    /**
     * Find all expressions and validate the ones that look like enums
     */
    public validateEnumUsage() {
        const diagnostics = [] as BsDiagnostic[];

        const membersByEnum = new Cache<string, Map<string, string>>();
        //if there are any enums defined in this scope
        const enumLookup = this.event.scope.getEnumMap();

        //skip enum validation if there are no enums defined in this scope
        if (enumLookup.size === 0) {
            return;
        }

        this.event.scope.enumerateOwnFiles((file) => {
            //skip non-brs files
            if (!isBrsFile(file)) {
                return;
            }

            for (const expression of file.parser.references.expressions as Set<DottedGetExpression>) {
                const parts = util.getAllDottedGetParts(expression);
                //skip expressions that aren't fully dotted gets
                if (!parts) {
                    continue;
                }
                //get the name of the enum member
                const memberName = parts.pop();
                //get the name of the enum (including leading namespace if applicable)
                const enumName = parts.join('.');
                const lowerEnumName = enumName.toLowerCase();
                const theEnum = enumLookup.get(lowerEnumName).item;
                if (theEnum) {
                    const members = membersByEnum.getOrAdd(lowerEnumName, () => theEnum.getMemberValueMap());
                    const value = members?.get(memberName.toLowerCase());
                    if (!value) {
                        diagnostics.push({
                            file: file,
                            ...DiagnosticMessages.unknownEnumValue(memberName, theEnum.fullName),
                            range: expression.name.range,
                            relatedInformation: [{
                                message: 'Enum declared here',
                                location: Location.create(
                                    URI.file(file.pathAbsolute).toString(),
                                    theEnum.tokens.name.range
                                )
                            }]
                        });
                    }
                }
            }
        });
        this.event.scope.addDiagnostics(diagnostics);
    }
}
