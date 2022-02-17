import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { isBrsFile } from '../../astUtils/reflection';
import { Cache } from '../../Cache';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { BrsFile } from '../../files/BrsFile';
import type { BsDiagnostic, OnScopeValidateEvent } from '../../interfaces';
import type { DottedGetExpression } from '../../parser/Expression';
import type { EnumStatement } from '../../parser/Statement';
import util from '../../util';

export class ScopeValidator {
    constructor(
        private event: OnScopeValidateEvent
    ) {
    }

    public process() {
        this.validateEnumUsage();
        this.detectDuplicateEnums();
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
                const theEnum = enumLookup.get(lowerEnumName)?.item;
                if (theEnum) {
                    const members = membersByEnum.getOrAdd(lowerEnumName, () => theEnum.getMemberValueMap());
                    const value = members?.get(memberName.toLowerCase());
                    if (!value) {
                        diagnostics.push({
                            file: file,
                            ...DiagnosticMessages.unknownEnumValue(memberName, theEnum.fullName),
                            range: expression.tokens.name.range,
                            relatedInformation: [{
                                message: 'Enum declared here',
                                location: Location.create(
                                    URI.file(file.srcPath).toString(),
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

    private detectDuplicateEnums() {
        const diagnostics: BsDiagnostic[] = [];
        const enumLocationsByName = new Cache<string, Array<{ file: BrsFile; statement: EnumStatement }>>();
        this.event.scope.enumerateBrsFiles((file) => {
            for (const enumStatement of file.parser.references.enumStatements) {
                const fullName = enumStatement.fullName;
                const nameLower = fullName?.toLowerCase();
                if (nameLower?.length > 0) {
                    enumLocationsByName.getOrAdd(nameLower, () => []).push({
                        file: file,
                        statement: enumStatement
                    });
                }
            }
        });

        //now that we've collected all enum declarations, flag duplicates
        for (const enumLocations of enumLocationsByName.values()) {
            //sort by srcPath to keep the primary enum location consistent
            enumLocations.sort((a, b) => a.file?.srcPath?.localeCompare(b.file?.srcPath));
            const primaryEnum = enumLocations.shift();
            const fullName = primaryEnum.statement.fullName;
            for (const duplicateEnumInfo of enumLocations) {
                diagnostics.push({
                    ...DiagnosticMessages.duplicateEnumDeclaration(this.event.scope.name, fullName),
                    file: duplicateEnumInfo.file,
                    range: duplicateEnumInfo.statement.tokens.name.range,
                    relatedInformation: [{
                        message: 'Enum declared here',
                        location: Location.create(
                            URI.file(primaryEnum.file.srcPath).toString(),
                            primaryEnum.statement.tokens.name.range
                        )
                    }]
                });
            }
        }
        this.event.scope.addDiagnostics(diagnostics);
    }
}
