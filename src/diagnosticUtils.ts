import type { Chalk } from 'chalk';
import chalk from 'chalk';
import type { BsConfig } from './BsConfig';
import { DiagnosticSeverity } from 'vscode-languageserver';
import type { BsDiagnostic } from '.';
import type { Range } from 'vscode-languageserver';

/**
 * Prepare print diagnostic formatting options
 */
export function getPrintDiagnosticOptions(options: BsConfig) {
    let cwd = options?.cwd ? options.cwd : process.cwd();

    let emitFullPaths = options?.emitFullPaths === true;

    let diagnosticLevel = options?.diagnosticLevel || 'warn';

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
 * Format output of one diagnostic
 */
export function printDiagnostic(
    options: ReturnType<typeof getPrintDiagnosticOptions>,
    severity: DiagnosticSeverity,
    filePath: string,
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
    const relatedInfoList = relatedInformation?.slice(0, 5) ?? [];
    let indent = '    ';
    for (let i = 0; i < relatedInfoList.length; i++) {
        let relatedInfo = relatedInfoList[i];
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
export function getDiagnosticSquigglyText(line: string, startCharacter: number, endCharacter: number) {
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
