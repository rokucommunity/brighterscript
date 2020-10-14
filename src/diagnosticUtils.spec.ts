
import { expect } from 'chai';
import * as util from './diagnosticUtils';
import { Range, DiagnosticSeverity } from 'vscode-languageserver';

describe('diagnosticUtils', () => {
    let options: ReturnType<typeof util.getPrintDiagnosticOptions>;
    beforeEach(() => {
        options = util.getPrintDiagnosticOptions({});
    });

    describe('printDiagnostic', () => {
        it('does not crash when range is undefined', () => {
            //print a diagnostic that doesn't have a range...it should not explode
            util.printDiagnostic(options, DiagnosticSeverity.Error, './temp/file.brs', [], {
                message: 'Bad thing happened',
                range: null, //important...this needs to be null for the test to pass,
                code: 1234
            } as any);
        });

        it('does not crash when filie path is missing', () => {
            //print a diagnostic that doesn't have a range...it should not explode
            util.printDiagnostic(options, DiagnosticSeverity.Error, undefined, [], {
                message: 'Bad thing happened',
                range: Range.create(0, 0, 2, 2), //important...this needs to be null for the test to pass,
                code: 1234
            } as any);
        });
    });

    describe('getPrintDiagnosticOptions', () => {
        let options: ReturnType<typeof util.getPrintDiagnosticOptions>;
        it('prepares cwd value', () => {
            options = util.getPrintDiagnosticOptions({ cwd: 'cwd' });
            expect(options.cwd).to.equal('cwd');
            // default value
            options = util.getPrintDiagnosticOptions({});
            expect(options.cwd).to.equal(process.cwd());
        });
        it('prepares emitFullPaths value', () => {
            options = util.getPrintDiagnosticOptions({ emitFullPaths: true });
            expect(options.emitFullPaths).to.equal(true);
            options = util.getPrintDiagnosticOptions({ emitFullPaths: false });
            expect(options.emitFullPaths).to.equal(false);
            // default value
            options = util.getPrintDiagnosticOptions({});
            expect(options.emitFullPaths).to.equal(false);
        });
        it('maps diagnosticLevel to severityLevel', () => {
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'info' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Information);
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'hint' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Hint);
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'warn' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Warning);
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'error' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Error);
            // default value
            options = util.getPrintDiagnosticOptions({});
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Warning);
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'x' } as any);
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Warning);
        });
        it('prepares the include map', () => {
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'info' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Information]: true,
                [DiagnosticSeverity.Hint]: true,
                [DiagnosticSeverity.Warning]: true,
                [DiagnosticSeverity.Error]: true
            });
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'hint' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Hint]: true,
                [DiagnosticSeverity.Warning]: true,
                [DiagnosticSeverity.Error]: true
            });
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'warn' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Warning]: true,
                [DiagnosticSeverity.Error]: true
            });
            options = util.getPrintDiagnosticOptions({ diagnosticLevel: 'error' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Error]: true
            });
        });
    });

    describe('getDiagnosticSquiggly', () => {
        it('works for normal cases', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 4)
            }, 'asdf')).to.equal('~~~~');
        });

        it('highlights whole line if no range', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
            }, ' asdf ')).to.equal('~~~~~~');
        });

        it('returns empty string when no line is found', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, '')).to.equal('');

            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, undefined)).to.equal('');
        });

        it('supports diagnostic not at start of line', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 6)
            }, '  asdf')).to.equal('  ~~~~');
        });

        it('supports diagnostic that does not finish at end of line', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 4)
            }, 'asdf  ')).to.equal('~~~~  ');
        });

        it('supports diagnostic with space on both sides', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 6)
            }, '  asdf  ')).to.equal('  ~~~~  ');
        });

        it('handles diagnostic that starts and stops on the same position', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 2)
            }, 'abcde')).to.equal('~~~~~');
        });

        it('handles single-character diagnostic', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 3)
            }, 'abcde')).to.equal('  ~  ');
        });

        it('handles diagnostics that are longer than the line', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, 'abcde')).to.equal('~~~~~');

            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 10)
            }, 'abcde')).to.equal('  ~~~');
        });

        it('handles Number.MAX_VALUE for end character', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, Number.MAX_VALUE)
            }, 'abcde')).to.equal('~~~~~');
        });

        it.skip('handles edge cases', () => {
            expect(util.getDiagnosticSquigglyText(<any>{
                range: Range.create(5, 16, 5, 18)
            }, 'end functionasdf')).to.equal('            ~~~~');
        });
    });
});
