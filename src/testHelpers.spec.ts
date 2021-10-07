import type { BscFile, BsDiagnostic } from './interfaces';
import * as assert from 'assert';
import chalk from 'chalk';
import type { Diagnostic, Range } from 'vscode-languageserver';
import { createSandbox } from 'sinon';
import { expect } from 'chai';
import type { CodeActionShorthand } from './CodeActionUtil';
import { codeActionUtil } from './CodeActionUtil';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BrsFile } from './files/BrsFile';
import type { Program } from './Program';
import { standardizePath as s } from './util';
import type { SymbolTable } from './SymbolTable';
import type { BscType } from './types/BscType';
import type { CodeWithSourceMap } from 'source-map';
import { getDiagnosticLine } from './diagnosticUtils';

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
export function expectZeroDiagnostics(arg: { getDiagnostics(): Array<Diagnostic> } | { diagnostics: Diagnostic[] } | Diagnostic[]) {
    let diagnostics: BsDiagnostic[];
    if (Array.isArray(arg)) {
        diagnostics = arg as BsDiagnostic[];
    } else if ((arg as any).getDiagnostics) {
        diagnostics = (arg as any).getDiagnostics();
    } else if ((arg as any).diagnostics) {
        diagnostics = (arg as any).diagnostics;
    } else {
        throw new Error('Cannot derive a list of diagnostics from ' + JSON.stringify(arg));
    }
    if (diagnostics.length > 0) {
        let message = `Expected 0 diagnostics, but instead found ${diagnostics.length}:`;
        for (const diagnostic of diagnostics) {
            //escape any newlines
            diagnostic.message = diagnostic.message.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
            message += `\n        • bs${diagnostic.code} "${diagnostic.message}" at ${diagnostic.file?.srcPath ?? ''}#(${diagnostic.range.start.line}:${diagnostic.range.start.character})-(${diagnostic.range.end.line}:${diagnostic.range.end.character})`;
            //print the line containing the error (if we can find it)
            const line = diagnostic.file?.fileContents?.split(/\r?\n/g)?.[diagnostic.range.start.line];
            if (line) {
                message += '\n' + getDiagnosticLine(diagnostic, line, chalk.red);
            }
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

export function expectCodeActions(test: () => any, expected: CodeActionShorthand[]) {
    const sinon = createSandbox();
    const stub = sinon.stub(codeActionUtil, 'createCodeAction');
    try {
        test();
    } finally {
        sinon.restore();
    }

    const args = stub.getCalls().map(x => x.args[0]);
    //delete any `diagnostics` arrays to help with testing performance (since it's circular...causes all sorts of issues)
    for (let arg of args) {
        delete arg.diagnostics;
    }
    expect(args).to.eql(expected);
}

export function getTestTranspile(scopeGetter: () => [Program, string]) {
    return getTestFileAction((file) => file.transpile(), scopeGetter);
}

export function getTestGetTypedef(scopeGetter: () => [Program, string]) {
    return getTestFileAction((file) => {
        return {
            code: (file as BrsFile).getTypedef(),
            map: undefined
        };
    }, scopeGetter);
}

function getTestFileAction(
    action: (file: BscFile) => CodeWithSourceMap,
    scopeGetter: () => [Program, string]
) {
    return function testFileAction(source: string, expected?: string, formatType: 'trim' | 'none' = 'trim', pkgPath = 'source/main.bs', failOnDiagnostic = true) {
        let [program, rootDir] = scopeGetter();
        expected = expected ? expected : source;
        let file = program.setFile<BrsFile>({ src: s`${rootDir}/${pkgPath}`, dest: pkgPath }, source);
        program.validate();
        if (failOnDiagnostic !== false) {
            expectZeroDiagnostics(program);
        }
        let codeWithMap = action(file);

        let sources = [codeWithMap.code, expected];
        for (let i = 0; i < sources.length; i++) {
            if (formatType === 'trim') {
                let lines = sources[i].split('\n');
                //throw out leading newlines
                while (lines[0].length === 0) {
                    lines.splice(0, 1);
                }
                let trimStartIndex = null;
                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                    //if we don't have a starting trim count, compute it
                    if (!trimStartIndex) {
                        trimStartIndex = lines[lineIndex].length - lines[lineIndex].trim().length;
                    }
                    //only trim the expected file (since that's what we passed in from the test)
                    if (lines[lineIndex].length > 0 && i === 1) {
                        lines[lineIndex] = lines[lineIndex].substring(trimStartIndex);
                    }
                }
                //trim trailing newlines
                while (lines[lines.length - 1]?.length === 0) {
                    lines.splice(lines.length - 1);
                }
                sources[i] = lines.join('\n');

            }
        }
        expect(trimMap(sources[0])).to.equal(sources[1]);
        return {
            file: file,
            source: source,
            expected: expected,
            actual: codeWithMap.code,
            map: codeWithMap.map
        };
    };
}

export function expectSymbolTableEquals(symbolTable: SymbolTable, expected: [string, BscType, Range][]) {
    const ownSymbols = symbolTable.getOwnSymbols().sort((a, b) => {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    expect(ownSymbols).to.be.length(expected.length);
    expect(
        ownSymbols.map(x => ({
            ...x,
            type: x.type.toString()
        }))
    ).to.eql(
        expected.map(x => ({
            name: x[0],
            type: x[1].toString(),
            range: x[2]
        }))
    );
}
