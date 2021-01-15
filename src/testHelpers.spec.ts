import type { BsDiagnostic } from './interfaces';
import * as assert from 'assert';
import type { Diagnostic } from 'vscode-languageserver';

/**
 * Trim leading whitespace for every line (to make test writing cleaner
 */
function trimLeading(text: string) {
    if (!text) {
        return text;
    }
    const lines = text.split(/\r?\n/);
    let minIndent = Number.MAX_SAFE_INTEGER;

    //skip leading empty lines
    while (lines[0]?.trim().length === 0) {
        lines.splice(0, 1);
    }

    for (const line of lines) {
        const trimmedLine = line.trimLeft();
        //skip empty lines
        if (trimmedLine.length === 0) {
            continue;
        }
        const leadingSpaceCount = line.length - trimmedLine.length;
        if (leadingSpaceCount < minIndent) {
            minIndent = leadingSpaceCount;
        }
    }

    //apply the trim to each line
    for (let i = 0; i < lines.length; i++) {
        lines[i] = lines[i].substring(minIndent);
    }
    return lines.join('\n');
}

/**
 * Remove leading white space and remove excess indentation
 */
export function trim(strings: TemplateStringsArray, ...args) {
    let text = '';
    for (let i = 0; i < strings.length; i++) {
        text += strings[i];
        if (args[i]) {
            text += args[i];
        }
    }
    return trimLeading(text);
}

/**
 * Test that the given object has zero diagnostics. If diagnostics are found, they are printed to the console in a pretty fashion.
 */
export function expectZeroDiagnostics(obj: { getDiagnostics(): BsDiagnostic[] } | Diagnostic[]) {
    const diagnostics = Array.isArray(obj) ? obj : obj.getDiagnostics();
    if (diagnostics.length > 0) {
        let message = `Expected 0 diagnostics, but instead found ${diagnostics.length}:`;
        for (const diagnostic of diagnostics) {
            message += `\n        • bs${diagnostic.code} "${diagnostic.message}" at ${(diagnostic as BsDiagnostic).file?.pathAbsolute ?? ''}#(${diagnostic.range.start.line}:${diagnostic.range.start.character})-(${diagnostic.range.end.line}:${diagnostic.range.end.character})`;
        }
        assert.fail(message);
    }
}

/**
 * Remove sourcemap information at the end of the source
 */
export function trimMap(source: string) {
    return source.replace(/('|<!--)\/\/# sourceMappingURL=.*$/m, '');
}
