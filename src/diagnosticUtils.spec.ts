
import { expect } from './chai-config.spec';
import * as diagnosticUtils from './diagnosticUtils';
import { Range, DiagnosticSeverity } from 'vscode-languageserver';
import { util } from './util';
import chalk from 'chalk';
import { createSandbox } from 'sinon';
import undent from 'undent';
import type { BsDiagnostic } from './interfaces';
import { stripConsoleColors } from './testHelpers.spec';
const sinon = createSandbox();

describe('diagnosticUtils', () => {
    let options: ReturnType<typeof diagnosticUtils.getPrintDiagnosticOptions>;
    beforeEach(() => {
        sinon.restore();
        options = diagnosticUtils.getPrintDiagnosticOptions({});
    });

    afterEach(() => {
        sinon.restore();
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
                range: Range.create(0, 0, 2, 2),
                code: 1234
            } as any);
        });

        function testPrintDiagnostic(diagnostic: BsDiagnostic, code: string, expected: string) {
            let logOutput = '';
            sinon.stub(console, 'log').callsFake((...args: any[]) => {
                if (logOutput.length > 0) {
                    logOutput += '\n';
                }
                logOutput += stripConsoleColors(args.join(' '));
            });
            //print a diagnostic that doesn't have a range...it should not explode
            diagnosticUtils.printDiagnostic(options, DiagnosticSeverity.Error, undefined, code.split(/\r?\n/g), diagnostic);

            //remove leading and trailing newlines
            logOutput = logOutput.replace(/^[\r\n]*/g, '').replace(/[\r\n]*$/g, '');
            expected = undent(logOutput).replace(/^[\r\n]*/g, '').replace(/[\r\n]*$/g, '');

            expect(logOutput).to.eql(expected);
        }

        it('handles mixed tabs and spaces', () => {
            testPrintDiagnostic(
                {
                    message: 'Bad thing happened',
                    range: Range.create(0, 5, 0, 18),
                    code: 1234
                } as any,
                `\t  \t print "hello"`,
                `
                <unknown file>:1:6 - error BS1234: Bad thing happened
                 1             print "hello"
                 _             ~~~~~~~~~~~~~
            `);
        });

        it('handles only tabs', () => {
            testPrintDiagnostic(
                {
                    message: 'Bad thing happened',
                    range: Range.create(0, 5, 0, 18),
                    code: 1234
                } as any,
                `\tprint "hello"`,
                `
                <unknown file>:1:6 - error BS1234: Bad thing happened
                 1      print "hello"
                 _      ~~~~~~~~~~~~~
            `);
        });

        it('handles only spaces', () => {
            testPrintDiagnostic(
                {
                    message: 'Bad thing happened',
                    range: Range.create(0, 5, 0, 18),
                    code: 1234
                } as any,
                `   print "hello"`,
                `
                <unknown file>:1:6 - error BS1234: Bad thing happened
                 1     print "hello"
                 _     ~~~~~~~~~~~~~
            `);
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
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('asdf', 0, 4)
            ).to.equal('~~~~');
        });

        it('highlights whole line if no range', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText(' asdf ', undefined, undefined)
            ).to.equal('~~~~~~');
        });

        it('returns empty string when no line is found', () => {
            expect(diagnosticUtils.getDiagnosticSquigglyText('', 0, 10)).to.equal('');

            expect(
                diagnosticUtils.getDiagnosticSquigglyText(undefined, 0, 10)
            ).to.equal('');
        });

        it('supports diagnostic not at start of line', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('  asdf', 2, 6)
            ).to.equal('  ~~~~');
        });

        it('supports diagnostic that does not finish at end of line', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('asdf  ', 0, 4)
            ).to.equal('~~~~  ');
        });

        it('supports diagnostic with space on both sides', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('  asdf  ', 2, 6)
            ).to.equal('  ~~~~  ');
        });

        it('handles diagnostic that starts and stops on the same position', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('abcde', 2, 2)
            ).to.equal('~~~~~');
        });

        it('handles single-character diagnostic', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('abcde', 2, 3)
            ).to.equal('  ~  ');
        });

        it('handles diagnostics that are longer than the line', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('abcde', 0, 10)
            ).to.equal('~~~~~');

            expect(
                diagnosticUtils.getDiagnosticSquigglyText('abcde', 2, 10)
            ).to.equal('  ~~~');
        });

        it('handles Number.MAX_VALUE for end character', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('abcde', 0, Number.MAX_VALUE)
            ).to.equal('~~~~~');
        });

        it.skip('handles edge cases', () => {
            expect(
                diagnosticUtils.getDiagnosticSquigglyText('end functionasdf', 16, 18)
            ).to.equal('            ~~~~');
        });
    });

    describe('getDiagnosticLine', () => {
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
