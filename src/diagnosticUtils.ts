import type { Chalk } from 'chalk';
import chalk from 'chalk';
import type { BsConfig, DiagnosticReporter, NormalizedDiagnosticReporter } from './BsConfig';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { BsDiagnostic } from '.';
import type { Range } from 'vscode-languageserver';

const KNOWN_DIAGNOSTIC_REPORTER_PRESETS = ['detailed', 'github-actions'] as const;

/**
 * The set of placeholder names recognized inside a custom diagnostic reporter template.
 * `buildDiagnosticPlaceholders` is typed against this list, so adding a name here will
 * cause a compile error until the corresponding value is supplied (and vice versa).
 */
export const KNOWN_DIAGNOSTIC_TEMPLATE_PLACEHOLDERS = [
    'file',
    'line',
    'col',
    'endLine',
    'endCol',
    'severity',
    'severityCode',
    'code',
    'message',
    'source'
] as const;

//Built directly from the known-names list so that adding a placeholder is a one-line change.
//Names are simple identifiers (camelCase) so no regex-escaping is needed.
const KNOWN_PLACEHOLDER_REGEX = new RegExp(`\\{(${KNOWN_DIAGNOSTIC_TEMPLATE_PLACEHOLDERS.join('|')})\\}`, 'g');

function findKnownPlaceholders(template: string): string[] {
    return template.match(KNOWN_PLACEHOLDER_REGEX) ?? [];
}

function describeDiagnosticReporterOptions(): string {
    const presets = KNOWN_DIAGNOSTIC_REPORTER_PRESETS.map(x => `"${x}"`).join(', ');
    const placeholders = KNOWN_DIAGNOSTIC_TEMPLATE_PLACEHOLDERS.map(x => `{${x}}`).join(', ');
    return `Expected one of:\n  - preset name: ${presets}\n  - template containing at least one placeholder: ${placeholders}`;
}

/**
 * Prepare print diagnostic formatting options
 */
export function getPrintDiagnosticOptions(options: BsConfig) {
    let cwd = options?.cwd ? options.cwd : process.cwd();

    let emitFullPaths = options?.emitFullPaths === true;

    let diagnosticLevel = options?.diagnosticLevel ?? 'warn';

    let diagnosticSeverityMap = {} as Record<string, DiagnosticSeverity>;
    diagnosticSeverityMap.info = DiagnosticSeverity.Information;
    diagnosticSeverityMap.hint = DiagnosticSeverity.Hint;
    diagnosticSeverityMap.warn = DiagnosticSeverity.Warning;
    diagnosticSeverityMap.error = DiagnosticSeverity.Error;

    let severityLevel = diagnosticSeverityMap[diagnosticLevel] || DiagnosticSeverity.Warning;
    let order = [DiagnosticSeverity.Information, DiagnosticSeverity.Hint, DiagnosticSeverity.Warning, DiagnosticSeverity.Error];
    let includeDiagnostic = order.slice(order.indexOf(severityLevel)).reduce((acc, value) => {
        acc[value] = true;
        return acc;
    }, {});

    let typeColor = {} as Record<string, Chalk>;
    typeColor[DiagnosticSeverity.Information] = chalk.blue;
    typeColor[DiagnosticSeverity.Hint] = chalk.green;
    typeColor[DiagnosticSeverity.Warning] = chalk.yellow;
    typeColor[DiagnosticSeverity.Error] = chalk.red;

    let severityTextMap = {};
    severityTextMap[DiagnosticSeverity.Information] = 'info';
    severityTextMap[DiagnosticSeverity.Hint] = 'hint';
    severityTextMap[DiagnosticSeverity.Warning] = 'warning';
    severityTextMap[DiagnosticSeverity.Error] = 'error';

    return {
        cwd: cwd,
        emitFullPaths: emitFullPaths,
        severityLevel: severityLevel,
        includeDiagnostic: includeDiagnostic,
        typeColor: typeColor,
        severityTextMap: severityTextMap
    };
}

/**
 * Resolve a single `DiagnosticReporter` value into its object form.
 * String shorthand rules:
 *   - if the value contains at least one known `{placeholder}`, it's a custom template
 *   - otherwise it must match one of the known preset names
 * Throws with the full list of supported presets and placeholders when nothing matches,
 * so typos in either bucket surface loudly.
 */
function normalizeOneDiagnosticReporter(value: DiagnosticReporter): NormalizedDiagnosticReporter {
    if (typeof value === 'string') {
        if ((KNOWN_DIAGNOSTIC_REPORTER_PRESETS as readonly string[]).includes(value)) {
            return { type: value as 'detailed' | 'github-actions' };
        }
        if (findKnownPlaceholders(value).length > 0) {
            return { type: 'custom', format: value };
        }
        throw new Error(
            `Unknown diagnostic reporter "${value}". ${describeDiagnosticReporterOptions()}`
        );
    }
    if (value.type === 'custom') {
        if (typeof value.format !== 'string' || value.format.length === 0) {
            throw new Error(`Diagnostic reporter type "custom" requires a non-empty "format" string.`);
        }
        if (findKnownPlaceholders(value.format).length === 0) {
            throw new Error(
                `Diagnostic reporter template "${value.format}" does not contain any known placeholders. Supported placeholders: ${KNOWN_DIAGNOSTIC_TEMPLATE_PLACEHOLDERS.map(x => `{${x}}`).join(', ')}`
            );
        }
        return { type: 'custom', format: value.format };
    }
    if (value.type === 'detailed' || value.type === 'github-actions') {
        return { type: value.type };
    }
    throw new Error(`Unknown diagnostic reporter type "${(value as { type: string }).type}".`);
}

/**
 * Resolve a `DiagnosticReporter` value (or array of them) into the array of object-form
 * reporters used by the printer.
 *
 * Behavior:
 *   - missing/null value → default `[{ type: 'detailed' }]`
 *   - explicit empty array → preserved (caller has opted out of all output)
 *   - invalid entry inside a non-empty input → warned via `logger`, skipped
 *   - duplicate entry (same preset type, or same custom-template format string) → warned, skipped
 *   - all entries invalid → warned, falls back to `[{ type: 'detailed' }]`
 *
 * Bad reporters never throw, surfacing a typo shouldn't be able to abort a build.
 */
export function normalizeDiagnosticReporters(
    value: DiagnosticReporter | DiagnosticReporter[] | undefined,
    logger?: { warn(...messages: any[]): void }
): NormalizedDiagnosticReporter[] {
    if (value === undefined || value === null) {
        return [{ type: 'detailed' }];
    }
    const inputs = Array.isArray(value) ? value : [value];
    if (inputs.length === 0) {
        return [];
    }
    const warn = (message: string) => (logger ? logger.warn(message) : console.warn(message));
    //presets are deduped by `type`; custom templates are deduped by their format string. running the
    //same reporter twice would only produce duplicate output, so it's almost always a config mistake.
    const seen = new Set<string>();
    const result: NormalizedDiagnosticReporter[] = [];
    for (const input of inputs) {
        let reporter: NormalizedDiagnosticReporter;
        try {
            reporter = normalizeOneDiagnosticReporter(input);
        } catch (e: any) {
            warn(`Ignoring invalid diagnostic reporter: ${e?.message ?? String(e)}`);
            continue;
        }
        const key = reporter.type === 'custom' ? `custom:${reporter.format}` : reporter.type;
        if (seen.has(key)) {
            const description = reporter.type === 'custom' ? `custom template "${reporter.format}"` : `"${reporter.type}"`;
            warn(`Ignoring duplicate diagnostic reporter: ${description}`);
            continue;
        }
        seen.add(key);
        result.push(reporter);
    }
    if (result.length === 0) {
        warn(`No valid diagnostic reporters configured; falling back to "detailed".`);
        return [{ type: 'detailed' }];
    }
    return result;
}

/**
 * Format output of one diagnostic
 */
export function printDiagnostic(
    options: ReturnType<typeof getPrintDiagnosticOptions>,
    severity: DiagnosticSeverity,
    filePath: string | undefined,
    lines: string[],
    diagnostic: BsDiagnostic,
    relatedInformation?: Array<{ range: Range; filePath: string; message: string }>
) {
    let { includeDiagnostic, severityTextMap, typeColor } = options;

    if (!includeDiagnostic[severity]) {
        return;
    }

    let severityText = severityTextMap[severity];

    console.log('');
    console.log(
        chalk.cyan(filePath ?? '<unknown file>') +
        ':' +
        chalk.yellow(
            diagnostic.range
                ? (diagnostic.range.start.line + 1) + ':' + (diagnostic.range.start.character + 1)
                : 'line?:col?'
        ) +
        ' - ' +
        typeColor[severity](severityText) +
        ' ' +
        chalk.grey('BS' + diagnostic.code) +
        ': ' +
        chalk.white(diagnostic.message)
    );
    console.log('');

    //Get the line referenced by the diagnostic. if we couldn't find a line,
    // default to an empty string so it doesn't crash the error printing below
    let diagnosticLine = lines[diagnostic.range?.start?.line ?? -1] ?? '';
    console.log(
        getDiagnosticLine(diagnostic, diagnosticLine, typeColor[severity])
    );

    //print related information if present (only first few rows)
    const relatedInfoList = relatedInformation ?? [];
    let indent = '    ';
    for (let i = 0; i < relatedInfoList.length; i++) {
        let relatedInfo = relatedInfoList[i];
        //only show the first 5 relatedInfo links
        if (i < 5) {
            console.log('');
            console.log(
                indent,
                chalk.cyan(relatedInfo.filePath ?? '<unknown file>') +
                ':' +
                chalk.yellow(
                    relatedInfo.range
                        ? (relatedInfo.range.start.line + 1) + ':' + (relatedInfo.range.start.character + 1)
                        : 'line?:col?'
                )
            );
            console.log(indent, relatedInfo.message);
        } else {
            console.log('\n', indent, `...and ${relatedInfoList.length - i + 1} more`);
            break;
        }
    }
    console.log('');
}

export function getDiagnosticLine(diagnostic: BsDiagnostic, diagnosticLine: string, colorFunction: Chalk) {
    let result = '';

    //only print the line information if we have some
    if (diagnostic.range && diagnosticLine) {
        const lineNumberText = chalk.bgWhite(' ' + chalk.black((diagnostic.range.start.line + 1).toString()) + ' ') + ' ';
        const blankLineNumberText = chalk.bgWhite(' ' + chalk.white(' '.repeat((diagnostic.range.start.line + 1).toString().length)) + ' ') + ' ';

        //remove tabs in favor of spaces to make diagnostic printing more consistent
        let leadingText = diagnosticLine.slice(0, diagnostic.range.start.character);
        let leadingTextNormalized = leadingText.replace(/\t/g, '    ');
        let actualText = diagnosticLine.slice(diagnostic.range.start.character, diagnostic.range.end.character);
        let actualTextNormalized = actualText.replace(/\t/g, '    ');
        let startIndex = leadingTextNormalized.length;
        let endIndex = leadingTextNormalized.length + actualTextNormalized.length;

        let diagnosticLineNormalized = diagnosticLine.replace(/\t/g, '    ');

        const squigglyText = getDiagnosticSquigglyText(diagnosticLineNormalized, startIndex, endIndex);
        result +=
            lineNumberText + diagnosticLineNormalized + '\n' +
            blankLineNumberText + colorFunction(squigglyText);
    }
    return result;
}

/**
 * Given a diagnostic, compute the range for the squiggly
 */
export function getDiagnosticSquigglyText(line: string | undefined, startCharacter: number | undefined, endCharacter: number | undefined) {
    let squiggle: string;
    //fill the entire line
    if (
        //there is no range
        typeof startCharacter !== 'number' || typeof endCharacter !== 'number' ||
        //there is no line
        !line ||
        //both positions point to same location
        startCharacter === endCharacter ||
        //the diagnostic starts after the end of the line
        startCharacter >= line.length
    ) {
        squiggle = ''.padStart(line?.length ?? 0, '~');
    } else {

        let endIndex = Math.max(endCharacter, line.length);
        endIndex = endIndex > 0 ? endIndex : 0;
        if (line?.length < endIndex) {
            endIndex = line.length;
        }

        let leadingWhitespaceLength = startCharacter;
        let squiggleLength: number;
        if (endCharacter === Number.MAX_VALUE) {
            squiggleLength = line.length - leadingWhitespaceLength;
        } else {
            squiggleLength = endCharacter - startCharacter;
        }
        let trailingWhitespaceLength = endIndex - endCharacter;

        //opening whitespace
        squiggle =
            ''.padStart(leadingWhitespaceLength, ' ') +
            //squiggle
            ''.padStart(squiggleLength, '~') +
            //trailing whitespace
            ''.padStart(trailingWhitespaceLength, ' ');

        //trim the end of the squiggle so it doesn't go longer than the end of the line
        if (squiggle.length > endIndex) {
            squiggle = squiggle.slice(0, endIndex);
        }
    }
    return squiggle;
}

/**
 * Build the placeholder values used by the custom-template reporter.
 * The return type is keyed off `KNOWN_DIAGNOSTIC_TEMPLATE_PLACEHOLDERS`, so
 * the compiler enforces that the two stay in sync.
 * Positions are 1-based to match editor/CI conventions; missing ranges fall back to 1.
 */
function buildDiagnosticPlaceholders(
    severity: DiagnosticSeverity,
    severityText: string,
    filePath: string | undefined,
    diagnostic: BsDiagnostic
): Record<DiagnosticPlaceholderName, string> {
    const range = diagnostic.range;
    const line = range ? range.start.line + 1 : 1;
    const col = range ? range.start.character + 1 : 1;
    const endLine = range ? range.end.line + 1 : line;
    const endCol = range ? range.end.character + 1 : col;
    return {
        file: filePath ?? '',
        line: String(line),
        col: String(col),
        endLine: String(endLine),
        endCol: String(endCol),
        severity: severityText,
        severityCode: String(severity),
        code: diagnostic.code === undefined ? '' : String(diagnostic.code),
        message: diagnostic.message ?? '',
        source: diagnostic.source ?? ''
    };
}

/**
 * Substitute `{name}` placeholders in `template` using the given values.
 * Only known placeholder names are matched; anything else (typos like `{filename}`
 * or unrelated braces in user text) passes through unchanged.
 */
export function applyDiagnosticTemplate(template: string, values: Record<string, string>): string {
    return template.replace(KNOWN_PLACEHOLDER_REGEX, (_match, name: string) => values[name]);
}

/**
 * Escape a value for use inside a GitHub Actions workflow command.
 * The message portion (after `::`) needs `%`, `\r`, and `\n` escaped;
 * parameter values additionally need `,` and `:` escaped.
 * @see https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions
 */
function escapeGithubActionsData(value: string): string {
    return value
        .replace(/%/g, '%25')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A');
}

function escapeGithubActionsProperty(value: string): string {
    return escapeGithubActionsData(value)
        .replace(/:/g, '%3A')
        .replace(/,/g, '%2C');
}

const GITHUB_ACTIONS_SEVERITY_COMMAND: Record<number, string> = {
    [DiagnosticSeverity.Error]: 'error',
    [DiagnosticSeverity.Warning]: 'warning',
    [DiagnosticSeverity.Information]: 'notice',
    [DiagnosticSeverity.Hint]: 'notice'
};

/**
 * Print one diagnostic in GitHub Actions workflow command format so the
 * runner surfaces it as a PR annotation.
 */
export function printDiagnosticGithubActions(ctx: DiagnosticPrintContext): void {
    const { options, severity, filePath, diagnostic } = ctx;
    if (!options.includeDiagnostic[severity]) {
        return;
    }
    const command = GITHUB_ACTIONS_SEVERITY_COMMAND[severity] ?? 'error';
    const range = diagnostic.range;
    const line = range ? range.start.line + 1 : 1;
    const col = range ? range.start.character + 1 : 1;
    const endLine = range ? range.end.line + 1 : line;
    const endCol = range ? range.end.character + 1 : col;
    const codeText = diagnostic.code === undefined ? '' : `BS${diagnostic.code}`;

    const params: string[] = [];
    if (filePath) {
        params.push(`file=${escapeGithubActionsProperty(filePath)}`);
    }
    params.push(`line=${line}`);
    params.push(`col=${col}`);
    params.push(`endLine=${endLine}`);
    params.push(`endColumn=${endCol}`);
    if (codeText) {
        params.push(`title=${escapeGithubActionsProperty(codeText)}`);
    }

    const message = escapeGithubActionsData(diagnostic.message ?? '');
    console.log(`::${command} ${params.join(',')}::${message}`);
}

/**
 * Build a reporter that renders each diagnostic via the given user-supplied template.
 * See `BsConfig.diagnosticReporters` for the placeholder list.
 */
export function createCustomDiagnosticReporter(template: string): DiagnosticReporterFn {
    return (ctx) => {
        const { options, severity, filePath, diagnostic } = ctx;
        if (!options.includeDiagnostic[severity]) {
            return;
        }
        const severityText = options.severityTextMap[severity] ?? '';
        const placeholders = buildDiagnosticPlaceholders(severity, severityText, filePath, diagnostic);
        console.log(applyDiagnosticTemplate(template, placeholders));
    };
}

type DiagnosticPlaceholderName = typeof KNOWN_DIAGNOSTIC_TEMPLATE_PLACEHOLDERS[number];

/**
 * Context passed to the object-shaped diagnostic reporters
 * (`printDiagnosticGithubActions`, custom-template reporters).
 * The detailed reporter has its own positional signature for backward compatibility.
 */
export interface DiagnosticPrintContext {
    options: ReturnType<typeof getPrintDiagnosticOptions>;
    severity: DiagnosticSeverity;
    filePath: string | undefined;
    diagnostic: BsDiagnostic;
}

export type DiagnosticReporterFn = (ctx: DiagnosticPrintContext) => void;
