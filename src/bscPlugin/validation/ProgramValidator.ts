import { isBrsFile } from '../../astUtils/reflection';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { AfterProgramValidateEvent } from '../../interfaces';
import util from '../../util';

export const ProgramValidatorDiagnosticsTag = 'ProgramValidator';

export class ProgramValidator {
    constructor(
        private event: AfterProgramValidateEvent
    ) { }

    public process() {
        this.flagScopelessBrsFiles();
    }

    /**
     * Flag any files that are included in 0 scopes.
     */
    private flagScopelessBrsFiles() {
        for (const key in this.event.program.files) {
            const file = this.event.program.files[key];

            if (
                //if this isn't a brs file, skip
                !isBrsFile(file) ||
                //if the file is included in at least one scope, skip
                this.event.program.getFirstScopeForFile(file)
            ) {
                continue;
            }

            this.event.program.diagnostics.register({
                ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                location: util.createLocationFromFileRange(file, util.createRange(0, 0, 0, Number.MAX_VALUE))
            }, { tags: [ProgramValidatorDiagnosticsTag] });
        }
    }
}
