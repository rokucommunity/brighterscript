import chalk from 'chalk';
import { BsConfig } from './BsConfig';
import { DiagnosticSeverity } from 'vscode-languageserver';
import { BsDiagnostic } from '.';

/**
 * Prepare print diagnostic formatting options
 */
export function getPrintDiagnosticOptions(options: BsConfig) {
    let cwd = options?.cwd ? options.cwd : process.cwd();

    let emitFullPaths = options?.emitFullPaths === true;

    let diagnosticLevel = options?.diagnosticLevel || 'warn';

    let diagnosticSeverityMap = {};
    diagnosticSeverityMap['info'] = DiagnosticSeverity.Information;
    diagnosticSeverityMap['hint'] = DiagnosticSeverity.Hint;
    diagnosticSeverityMap['warn'] = DiagnosticSeverity.Warning;
    diagnosticSeverityMap['error'] = DiagnosticSeverity.Error;

    let severityLevel = diagnosticSeverityMap[diagnosticLevel] || DiagnosticSeverity.Warning;
    let order = [DiagnosticSeverity.Information, DiagnosticSeverity.Hint, DiagnosticSeverity.Warning, DiagnosticSeverity.Error];
    let includeDiagnostic = order.slice(order.indexOf(severityLevel)).reduce((acc, value) => {
        acc[value] = true;
        return acc;
    }, {});

    let typeColor = {} as any;
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
 * Format output of one diagnostic
 */
export function printDiagnostic(
    options: ReturnType<typeof getPrintDiagnosticOptions>,
    severity: DiagnosticSeverity,
    filePath: string,
    lines: string[],
    diagnostic: BsDiagnostic
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

    let squigglyText = getDiagnosticSquigglyText(diagnostic, diagnosticLine);

    //only print the line information if we have some
    if (diagnostic.range && diagnosticLine) {
        let lineNumberText = chalk.bgWhite(' ' + chalk.black((diagnostic.range.start.line + 1).toString()) + ' ') + ' ';
        let blankLineNumberText = chalk.bgWhite(' ' + chalk.bgWhite((diagnostic.range.start.line + 1).toString()) + ' ') + ' ';
        console.log(lineNumberText + diagnosticLine);
        console.log(blankLineNumberText + typeColor[severity](squigglyText));
    }
    console.log('');
}

/**
 * Given a diagnostic, compute the range for the squiggly
 */
export function getDiagnosticSquigglyText(diagnostic: BsDiagnostic, line: string) {
    let squiggle: string;
    //fill the entire line
    if (
        //there is no range
        !diagnostic.range ||
        //there is no line
        !line ||
        //both positions point to same location
        diagnostic.range.start.character === diagnostic.range.end.character ||
        //the diagnostic starts after the end of the line
        diagnostic.range.start.character >= line.length
    ) {
        squiggle = ''.padStart(line?.length ?? 0, '~');
    } else {

        let endIndex = Math.max(diagnostic.range?.end.character, line.length);
        endIndex = endIndex > 0 ? endIndex : 0;
        if (line?.length < endIndex) {
            endIndex = line.length;
        }

        let leadingWhitespaceLength = diagnostic.range.start.character;
        let squiggleLength: number;
        if (diagnostic.range.end.character === Number.MAX_VALUE) {
            squiggleLength = line.length - leadingWhitespaceLength;
        } else {
            squiggleLength = diagnostic.range.end.character - diagnostic.range.start.character;
        }
        let trailingWhitespaceLength = endIndex - diagnostic.range.end.character;

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
