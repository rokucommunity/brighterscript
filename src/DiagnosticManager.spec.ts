import type { BrsFile } from './files/BrsFile';
import type { BsDiagnostic } from './interfaces';
import { Program } from './Program';
import util from './util';


describe('DiagnosticManager', () => {
    let program: Program;
    beforeEach(() => {
        program = new Program({});
    });

    describe('diagnosticIsSuppressed', () => {
        it('does not crash when diagnostic is missing location information', () => {
            const file = program.setFile('source/main.brs', '') as BrsFile;
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test. range must be missing
                location: { uri: util.pathToUri(file?.srcPath), range: undefined }
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

        it('does not crash when diagnostic is missing the entire `.location` object', () => {
            const file = program.setFile('source/main.brs', '') as BrsFile;
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test, `.uri` must be missing
                location: { uri: undefined, range: util.createRange(1, 2, 3, 4) }
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

    describe('clearForFile', () => {
        it('does not crash when filePath is invalid', () => {
            const diagnostic: BsDiagnostic = {
                message: 'crash',
                //important part of the test. `.uri` must be missing
                location: { uri: undefined, range: util.createRange(1, 2, 3, 4) }
            };

            program.diagnostics.register(diagnostic);

            program.diagnostics.clearForFile(undefined);
            program.diagnostics.clearForFile(null);
            program.diagnostics.clearForFile('');
            //the test passes because none of these lines throw an error
        });
    });
});
