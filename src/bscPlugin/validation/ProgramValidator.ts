import { isBrsFile } from '../../astUtils/reflection';
import { DiagnosticMessages } from '../../DiagnosticMessages';
import type { Program } from '../../Program';
import util from '../../util';

export class ProgramValidator {
    constructor(private program: Program) { }

    public process() {
        this.flagScopelessBrsFiles();
    }

    /**
     * Flag any files that are included in 0 scopes.
     */
    private flagScopelessBrsFiles() {
        for (const key in this.program.files) {
            const file = this.program.files[key];

            if (
                //if this isn't a brs file, skip
                !isBrsFile(file) ||
                //if the file is included in at least one scope, skip
                this.program.getFirstScopeForFile(file)
            ) {
                continue;
            }

            this.program.addDiagnostics([{
                ...DiagnosticMessages.fileNotReferencedByAnyOtherFile(),
                file: file,
                range: util.createRange(0, 0, 0, Number.MAX_VALUE)
            }]);
        }
    }
}
