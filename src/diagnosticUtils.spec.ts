
import { expect } from 'chai';
import * as diagnosticUtils from './diagnosticUtils';
import { Range, DiagnosticSeverity } from 'vscode-languageserver';
import { util } from './util';
import chalk from 'chalk';

describe('diagnosticUtils', () => {
    let options: ReturnType<typeof diagnosticUtils.getPrintDiagnosticOptions>;
    beforeEach(() => {
        options = diagnosticUtils.getPrintDiagnosticOptions({});
    });

    describe('printDiagnostic', () => {
        it('does not crash when range is undefined', () => {
            //print a diagnostic that doesn't have a range...it should not explode
            diagnosticUtils.printDiagnostic(options, DiagnosticSeverity.Error, './temp/file.brs', [], {
                message: 'Bad thing happened',
                range: null, //important...this needs to be null for the test to pass,
                code: 1234
            } as any);
        });

        it('does not crash when filie path is missing', () => {
            //print a diagnostic that doesn't have a range...it should not explode
            diagnosticUtils.printDiagnostic(options, DiagnosticSeverity.Error, undefined, [], {
                message: 'Bad thing happened',
                range: Range.create(0, 0, 2, 2), //important...this needs to be null for the test to pass,
                code: 1234
            } as any);
        });
    });

    describe('getPrintDiagnosticOptions', () => {
        let options: ReturnType<typeof diagnosticUtils.getPrintDiagnosticOptions>;
        it('prepares cwd value', () => {
            options = diagnosticUtils.getPrintDiagnosticOptions({ cwd: 'cwd' });
            expect(options.cwd).to.equal('cwd');
            // default value
            options = diagnosticUtils.getPrintDiagnosticOptions({});
            expect(options.cwd).to.equal(process.cwd());
        });
        it('prepares emitFullPaths value', () => {
            options = diagnosticUtils.getPrintDiagnosticOptions({ emitFullPaths: true });
            expect(options.emitFullPaths).to.equal(true);
            options = diagnosticUtils.getPrintDiagnosticOptions({ emitFullPaths: false });
            expect(options.emitFullPaths).to.equal(false);
            // default value
            options = diagnosticUtils.getPrintDiagnosticOptions({});
            expect(options.emitFullPaths).to.equal(false);
        });
        it('maps diagnosticLevel to severityLevel', () => {
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'info' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Information);
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'hint' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Hint);
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'warn' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Warning);
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'error' });
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Error);
            // default value
            options = diagnosticUtils.getPrintDiagnosticOptions({});
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Warning);
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'x' } as any);
            expect(options.severityLevel).to.equal(DiagnosticSeverity.Warning);
        });
        it('prepares the include map', () => {
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'info' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Information]: true,
                [DiagnosticSeverity.Hint]: true,
                [DiagnosticSeverity.Warning]: true,
                [DiagnosticSeverity.Error]: true
            });
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'hint' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Hint]: true,
                [DiagnosticSeverity.Warning]: true,
                [DiagnosticSeverity.Error]: true
            });
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'warn' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Warning]: true,
                [DiagnosticSeverity.Error]: true
            });
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'error' });
            expect(options.includeDiagnostic).to.deep.equal({
                [DiagnosticSeverity.Error]: true
            });
        });
    });

    describe('getDiagnosticSquiggly', () => {
        it('works for normal cases', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 4)
            }, 'asdf')).to.equal('~~~~');
        });

        it('highlights whole line if no range', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
            }, ' asdf ')).to.equal('~~~~~~');
        });

        it('returns empty string when no line is found', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, '')).to.equal('');

            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, undefined)).to.equal('');
        });

        it('supports diagnostic not at start of line', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 6)
            }, '  asdf')).to.equal('  ~~~~');
        });

        it('supports diagnostic that does not finish at end of line', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 4)
            }, 'asdf  ')).to.equal('~~~~  ');
        });

        it('supports diagnostic with space on both sides', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 6)
            }, '  asdf  ')).to.equal('  ~~~~  ');
        });

        it('handles diagnostic that starts and stops on the same position', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 2)
            }, 'abcde')).to.equal('~~~~~');
        });

        it('handles single-character diagnostic', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 3)
            }, 'abcde')).to.equal('  ~  ');
        });

        it('handles diagnostics that are longer than the line', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 0, 0, 10)
            }, 'abcde')).to.equal('~~~~~');

            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(0, 2, 0, 10)
            }, 'abcde')).to.equal('  ~~~');
        });

        it('handles Number.MAX_VALUE for end character', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: util.createRange(0, 0, 0, Number.MAX_VALUE)
            }, 'abcde')).to.equal('~~~~~');
        });

        it.skip('handles edge cases', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText(<any>{
                range: Range.create(5, 16, 5, 18)
            }, 'end functionasdf')).to.equal('            ~~~~');
        });
    });

    describe.only('getDiagnosticLine', () => {
        const color = ((text: string) => text) as any;

        function testGetDiagnosticLine(range: Range, squigglyText: string, lineLength = 20) {
            expect(
                diagnosticUtils.getDiagnosticLine({ range: range } as any, '1'.repeat(lineLength), color)
            ).to.eql([
                chalk.bgWhite(' ' + chalk.black((range.start.line + 1).toString()) + ' ') + ' ' + '1'.repeat(lineLength),
                chalk.bgWhite(' ' + chalk.white('_'.repeat((range.start.line + 1).toString().length)) + ' ') + ' ' + squigglyText.padEnd(lineLength, ' ')
            ].join('\n'));
        }

        it('lines up at beginning of line for single-digit line num', () => {
            testGetDiagnosticLine(util.createRange(0, 0, 0, 5), '~~~~~');
        });

        it('lines up in middle of line for single-digit line num', () => {
            testGetDiagnosticLine(util.createRange(0, 5, 0, 10), '     ~~~~~');
        });

        it('lines up at end of line for single-digit line num', () => {
            testGetDiagnosticLine(util.createRange(0, 5, 0, 10), '     ~~~~~', 10);
        });

        it('lines up at beginning of line for double-digit line num', () => {
            testGetDiagnosticLine(util.createRange(15, 0, 15, 5), '~~~~~');
        });

        it('lines up in middle of line for double-digit line num', () => {
            testGetDiagnosticLine(util.createRange(15, 5, 15, 10), '     ~~~~~');
        });

        it('lines up at end of line for double-digit line num', () => {
            testGetDiagnosticLine(util.createRange(15, 5, 15, 10), '     ~~~~~', 10);
        });
    });
});
