import type { BrsFile } from './files/BrsFile';
import type { BsDiagnostic } from './interfaces';
import { Program } from './Program';
import util from './util';


describe('DiagnosticManager', () => {
    describe('diagnosticIsSuppressed', () => {
        it('does not crash when diagnostic is missing location information', () => {
            const program = new Program({});
            const file = program.setFile('source/main.brs', '') as BrsFile;
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test. range must be missing
                location: { uri: util.getFileUri(file), range: undefined }
            };

            file.commentFlags.push({
                affectedRange: util.createRange(1, 2, 3, 4),
                codes: [1, 2, 3],
                file: file,
                range: util.createRange(1, 2, 3, 4)
            });
            program.diagnostics.register(diagnostic);

            program.diagnostics.isDiagnosticSuppressed(diagnostic);

            //test passes if there's no crash
        });
    });
});
