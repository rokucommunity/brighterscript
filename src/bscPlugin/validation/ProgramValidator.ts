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

            //if the file is included in at least one scope, we're all good
            const scope = this.program.getFirstScopeForFile(file);
            if (scope) {
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
