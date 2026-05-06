
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

    function makeCtx(
        severity: DiagnosticSeverity,
        filePath: string | undefined,
        diagnostic: BsDiagnostic
    ): diagnosticUtils.DiagnosticPrintContext {
        return {
            options: options,
            severity: severity,
            filePath: filePath,
            diagnostic: diagnostic
        };
    }

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

    describe('normalizeDiagnosticReporters', () => {
        function makeLogger() {
            const warnings: string[] = [];
            return {
                warnings: warnings,
                logger: { warn: (...messages: any[]) => warnings.push(messages.join(' ')) }
            };
        }

        it('returns [detailed] when value is missing', () => {
            expect(diagnosticUtils.normalizeDiagnosticReporters(undefined)).to.eql([{ type: 'detailed' }]);
            expect(diagnosticUtils.normalizeDiagnosticReporters(null as any)).to.eql([{ type: 'detailed' }]);
        });

        it('resolves preset string shorthands', () => {
            expect(diagnosticUtils.normalizeDiagnosticReporters('detailed')).to.eql([{ type: 'detailed' }]);
            expect(diagnosticUtils.normalizeDiagnosticReporters('github-actions')).to.eql([{ type: 'github-actions' }]);
        });

        it('treats a string with at least one known placeholder as a custom template', () => {
            expect(diagnosticUtils.normalizeDiagnosticReporters('{file}:{line}: {message}')).to.eql([{
                type: 'custom',
                format: '{file}:{line}: {message}'
            }]);
        });

        it('passes through explicit object form', () => {
            expect(diagnosticUtils.normalizeDiagnosticReporters({ type: 'detailed' })).to.eql([{ type: 'detailed' }]);
            expect(diagnosticUtils.normalizeDiagnosticReporters({ type: 'github-actions' })).to.eql([{ type: 'github-actions' }]);
            expect(diagnosticUtils.normalizeDiagnosticReporters({ type: 'custom', format: '{file}' })).to.eql([{
                type: 'custom',
                format: '{file}'
            }]);
        });

        it('normalizes each entry of an array, in order', () => {
            expect(diagnosticUtils.normalizeDiagnosticReporters(['detailed', 'github-actions', '{file}: {message}'])).to.eql([
                { type: 'detailed' },
                { type: 'github-actions' },
                { type: 'custom', format: '{file}: {message}' }
            ]);
        });

        it('preserves an empty array (caller has opted out of all output)', () => {
            expect(diagnosticUtils.normalizeDiagnosticReporters([])).to.eql([]);
        });

        it('warns and skips invalid entries while keeping valid ones', () => {
            const { logger, warnings } = makeLogger();
            expect(diagnosticUtils.normalizeDiagnosticReporters(['detailed', 'github_actions', '{file}: {message}'], logger))
                .to.eql([
                    { type: 'detailed' },
                    { type: 'custom', format: '{file}: {message}' }
                ]);
            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.match(/Ignoring invalid diagnostic reporter/);
            expect(warnings[0]).to.match(/Unknown diagnostic reporter/);
        });

        it('falls back to [detailed] (and warns) when every entry is invalid', () => {
            const { logger, warnings } = makeLogger();
            expect(diagnosticUtils.normalizeDiagnosticReporters(['github_actions', 'frindly{'], logger))
                .to.eql([{ type: 'detailed' }]);
            //one warning per bad entry, plus the fallback warning
            expect(warnings).to.have.length(3);
            expect(warnings[0]).to.match(/Ignoring invalid diagnostic reporter/);
            expect(warnings[1]).to.match(/Ignoring invalid diagnostic reporter/);
            expect(warnings[2]).to.match(/falling back to "detailed"/);
        });

        it('falls back to [detailed] (and warns) when a single invalid value is given', () => {
            const { logger, warnings } = makeLogger();
            expect(diagnosticUtils.normalizeDiagnosticReporters('github_actions', logger))
                .to.eql([{ type: 'detailed' }]);
            expect(warnings).to.have.length(2);
        });

        it('warning for invalid preset includes the full supported-options list', () => {
            const { logger, warnings } = makeLogger();
            diagnosticUtils.normalizeDiagnosticReporters('github_actions', logger);
            expect(warnings.join('\n')).to.match(/"detailed"/);
            expect(warnings.join('\n')).to.match(/\{file\}/);
        });

        it('warns when a custom object is missing or has empty format', () => {
            const { logger, warnings } = makeLogger();
            diagnosticUtils.normalizeDiagnosticReporters([{ type: 'custom', format: '' } as any, { type: 'custom' } as any], logger);
            expect(warnings.filter(w => w.includes('non-empty'))).to.have.length(2);
        });

        it('warns when a custom object has no known placeholders', () => {
            const { logger, warnings } = makeLogger();
            diagnosticUtils.normalizeDiagnosticReporters({ type: 'custom', format: 'no placeholders here' } as any, logger);
            expect(warnings.some(w => w.includes('does not contain any known placeholders'))).to.be.true;
        });

        it('warns on unknown object type', () => {
            const { logger, warnings } = makeLogger();
            diagnosticUtils.normalizeDiagnosticReporters({ type: 'bogus' } as any, logger);
            expect(warnings.some(w => w.includes('Unknown diagnostic reporter type'))).to.be.true;
        });

        it('falls back silently to console.warn when no logger is provided', () => {
            //we just want to confirm it doesn't throw and still returns the fallback
            const stub = sinon.stub(console, 'warn').callsFake(() => { });
            expect(diagnosticUtils.normalizeDiagnosticReporters('totally-bogus')).to.eql([{ type: 'detailed' }]);
            expect(stub.called).to.be.true;
        });
    });

    describe('applyDiagnosticTemplate', () => {
        it('substitutes known placeholders', () => {
            expect(diagnosticUtils.applyDiagnosticTemplate('{file}:{line}:{col} {message}', {
                file: 'src/main.bs',
                line: '10',
                col: '5',
                message: 'Bad thing'
            })).to.equal('src/main.bs:10:5 Bad thing');
        });

        it('passes unknown placeholders through unchanged so typos surface', () => {
            expect(diagnosticUtils.applyDiagnosticTemplate('{file} {nope}', { file: 'a.bs' })).to.equal('a.bs {nope}');
        });

        it('does not match braces with non-identifier contents', () => {
            expect(diagnosticUtils.applyDiagnosticTemplate('{} {1file} {file-path}', { file: 'a.bs' })).to.equal('{} {1file} {file-path}');
        });
    });

    describe('printDiagnosticGithubActions', () => {
        function capture(severity: DiagnosticSeverity, filePath: string | undefined, diagnostic: BsDiagnostic): string {
            //restore any prior stub from a previous capture() in the same test
            sinon.restore();
            let captured = '';
            sinon.stub(console, 'log').callsFake((line: string) => {
                captured += line;
            });
            diagnosticUtils.printDiagnosticGithubActions(makeCtx(severity, filePath, diagnostic));
            return captured;
        }

        it('emits the canonical workflow command for an error', () => {
            const out = capture(DiagnosticSeverity.Error, 'src/source/main.bs', {
                message: 'Cannot find name',
                range: Range.create(9, 4, 9, 11),
                code: 1001
            } as any);
            expect(out).to.equal('::error file=src/source/main.bs,line=10,col=5,endLine=10,endColumn=12,title=BS1001::Cannot find name');
        });

        it('maps Warning -> ::warning and Information/Hint -> ::notice', () => {
            //info/hint are below the default 'warn' threshold, so opt them in for this test
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'info' });
            const range = Range.create(0, 0, 0, 1);
            expect(capture(DiagnosticSeverity.Warning, 'a.bs', { message: 'w', range: range, code: 1 } as any))
                .to.match(/^::warning /);
            expect(capture(DiagnosticSeverity.Information, 'a.bs', { message: 'i', range: range, code: 1 } as any))
                .to.match(/^::notice /);
            expect(capture(DiagnosticSeverity.Hint, 'a.bs', { message: 'h', range: range, code: 1 } as any))
                .to.match(/^::notice /);
        });

        it('escapes property values (commas, colons, percents) and message data (newlines)', () => {
            const out = capture(DiagnosticSeverity.Error, 'C:\\path,with,commas\\file.bs', {
                message: 'line one\nline two\rwith % literal',
                range: Range.create(0, 0, 0, 1),
                code: 99
            } as any);
            expect(out).to.equal(
                '::error file=C%3A\\path%2Cwith%2Ccommas\\file.bs,line=1,col=1,endLine=1,endColumn=2,title=BS99::line one%0Aline two%0Dwith %25 literal'
            );
        });

        it('omits file= when filePath is missing and omits title= when code is missing', () => {
            const out = capture(DiagnosticSeverity.Error, undefined, {
                message: 'no file no code',
                range: Range.create(2, 3, 2, 4)
            } as any);
            expect(out).to.equal('::error line=3,col=4,endLine=3,endColumn=5::no file no code');
        });

        it('falls back to 1:1 when range is missing', () => {
            const out = capture(DiagnosticSeverity.Error, 'a.bs', {
                message: 'no range',
                range: undefined,
                code: 1
            } as any);
            expect(out).to.equal('::error file=a.bs,line=1,col=1,endLine=1,endColumn=1,title=BS1::no range');
        });

        it('respects diagnosticLevel filter', () => {
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'error' });
            let logged = 0;
            sinon.stub(console, 'log').callsFake(() => {
                logged++;
            });
            diagnosticUtils.printDiagnosticGithubActions(makeCtx(DiagnosticSeverity.Warning, 'a.bs', {
                message: 'filtered',
                range: Range.create(0, 0, 0, 1),
                code: 1
            } as any));
            expect(logged).to.equal(0);
        });
    });

    describe('createCustomDiagnosticReporter', () => {
        function capture(template: string, severity: DiagnosticSeverity, filePath: string | undefined, diagnostic: BsDiagnostic): string {
            //restore any prior stub from a previous capture() in the same test
            sinon.restore();
            let captured = '';
            sinon.stub(console, 'log').callsFake((line: string) => {
                captured += line;
            });
            diagnosticUtils.createCustomDiagnosticReporter(template)(makeCtx(severity, filePath, diagnostic));
            return captured;
        }

        it('substitutes the standard placeholders with 1-based positions', () => {
            const out = capture(
                '{file}:{line}:{col}-{endLine}:{endCol} {severity} {code}: {message} ({source})',
                DiagnosticSeverity.Warning,
                'src/main.bs',
                {
                    message: 'maybe bad',
                    range: Range.create(4, 0, 4, 6),
                    code: 42,
                    source: 'brs'
                } as any
            );
            expect(out).to.equal('src/main.bs:5:1-5:7 warning 42: maybe bad (brs)');
        });

        it('emits empty strings for missing optional fields', () => {
            const out = capture(
                '[{file}][{code}][{source}] {message}',
                DiagnosticSeverity.Error,
                undefined,
                { message: 'oops', range: Range.create(0, 0, 0, 1) } as any
            );
            expect(out).to.equal('[][][] oops');
        });

        it('respects diagnosticLevel filter', () => {
            options = diagnosticUtils.getPrintDiagnosticOptions({ diagnosticLevel: 'error' });
            let logged = 0;
            sinon.stub(console, 'log').callsFake(() => {
                logged++;
            });
            diagnosticUtils.createCustomDiagnosticReporter('{message}')(
                makeCtx(DiagnosticSeverity.Warning, 'a.bs', { message: 'filtered', range: Range.create(0, 0, 0, 1), code: 1 } as any)
            );
            expect(logged).to.equal(0);
        });
    });


    describe('getDiagnosticLine', () => {
        const color = ((text: string) => text) as any;

        function testGetDiagnosticLine(range: Range, squigglyText: string, lineLength = 20) {
            expect(
                diagnosticUtils.getDiagnosticLine({ range: range } as any, '1'.repeat(lineLength), color)
            ).to.eql([
                chalk.bgWhite(' ' + chalk.black((range.start.line + 1).toString()) + ' ') + ' ' + '1'.repeat(lineLength),
                chalk.bgWhite(' ' + chalk.white(' '.repeat((range.start.line + 1).toString().length)) + ' ') + ' ' + squigglyText.padEnd(lineLength, ' ')
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
