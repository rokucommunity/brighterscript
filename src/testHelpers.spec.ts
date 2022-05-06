import type { BscFile, BsDiagnostic } from './interfaces';
import * as assert from 'assert';
import chalk from 'chalk';
import type { CompletionItem, Diagnostic } from 'vscode-languageserver';
import { createSandbox } from 'sinon';
import { expect } from 'chai';
import type { CodeActionShorthand } from './CodeActionUtil';
import { codeActionUtil } from './CodeActionUtil';
import type { BrsFile } from './files/BrsFile';
import type { Program } from './Program';
import { standardizePath as s } from './util';
import type { CodeWithSourceMap } from 'source-map';
import { getDiagnosticLine } from './diagnosticUtils';
import { firstBy } from 'thenby';
import undent from 'undent';

export const trim = undent;

type DiagnosticCollection = { getDiagnostics(): Array<Diagnostic> } | { diagnostics: Diagnostic[] } | Diagnostic[];

function getDiagnostics(arg: DiagnosticCollection): BsDiagnostic[] {
    if (Array.isArray(arg)) {
        return arg as BsDiagnostic[];
    } else if ((arg as any).getDiagnostics) {
        return (arg as any).getDiagnostics();
    } else if ((arg as any).diagnostics) {
        return (arg as any).diagnostics;
    } else {
        throw new Error('Cannot derive a list of diagnostics from ' + JSON.stringify(arg));
    }
}

function sortDiagnostics(diagnostics: BsDiagnostic[]) {
    return diagnostics.sort(
        firstBy<BsDiagnostic>('code')
            .thenBy<BsDiagnostic>('message')
            .thenBy<BsDiagnostic>((a, b) => (a.range?.start?.line ?? 0) - (b.range?.start?.line ?? 0))
            .thenBy<BsDiagnostic>((a, b) => (a.range?.start?.character ?? 0) - (b.range?.start?.character ?? 0))
            .thenBy<BsDiagnostic>((a, b) => (a.range?.end?.line ?? 0) - (b.range?.end?.line ?? 0))
            .thenBy<BsDiagnostic>((a, b) => (a.range?.end?.character ?? 0) - (b.range?.end?.character ?? 0))
    );
}

/**
 * Ensure the DiagnosticCollection exactly contains the data from expected list.
 * @param arg - any object that contains diagnostics (such as `Program`, `Scope`, or even an array of diagnostics)
 * @param expected an array of expected diagnostics. if it's a string, assume that's a diagnostic error message
 */
export function expectDiagnostics(arg: DiagnosticCollection, expected: Array<Partial<Diagnostic> | string | number>) {
    const diagnostics = sortDiagnostics(
        getDiagnostics(arg)
    );
    const expectedDiagnostics = sortDiagnostics(
        expected.map(x => {
            let result = x;
            if (typeof x === 'string') {
                result = { message: x };
            } else if (typeof x === 'number') {
                result = { code: x };
            }
            return result as BsDiagnostic;
        })
    );

    const actual = [] as BsDiagnostic[];
    for (let i = 0; i < diagnostics.length; i++) {
        const actualDiagnostic = diagnostics[i];
        const clone = {} as BsDiagnostic;
        let keys = Object.keys(expectedDiagnostics[i] ?? {}) as Array<keyof BsDiagnostic>;
        //if there were no keys provided, use some sane defaults
        keys = keys.length > 0 ? keys : ['message', 'code', 'range', 'severity'];

        //copy only compare the specified keys from actualDiagnostic
        for (const key of keys) {
            clone[key] = actualDiagnostic[key];
        }
        actual.push(clone);
    }

    expect(actual).to.eql(expectedDiagnostics);
}

/**
 * Test that the given object has zero diagnostics. If diagnostics are found, they are printed to the console in a pretty fashion.
 */
export function expectZeroDiagnostics(arg: DiagnosticCollection) {
    const diagnostics = getDiagnostics(arg);
    if (diagnostics.length > 0) {
        let message = `Expected 0 diagnostics, but instead found ${diagnostics.length}:`;
        for (const diagnostic of diagnostics) {
            //escape any newlines
            diagnostic.message = diagnostic.message.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
            message += `\n        • bs${diagnostic.code} "${diagnostic.message}" at ${diagnostic.file?.srcPath ?? ''}#(${diagnostic.range.start.line}:${diagnostic.range.start.character})-(${diagnostic.range.end.line}:${diagnostic.range.end.character})`;
            //print the line containing the error (if we can find it)srcPath
            const line = diagnostic.file?.fileContents?.split(/\r?\n/g)?.[diagnostic.range.start.line];
            if (line) {
                message += '\n' + getDiagnosticLine(diagnostic, line, chalk.red);
            }
        }
        assert.fail(message);
    }
}

/**
 * Test if the arg has any diagnostics. This just checks the count, nothing more.
 * @param length if specified, checks the diagnostic count is exactly that amount. If omitted, the collection is just verified as non-empty
 */
export function expectHasDiagnostics(arg: DiagnosticCollection, length: number = null) {
    const diagnostics = getDiagnostics(arg);
    if (length) {
        expect(diagnostics).lengthOf(length);
    } else {
        expect(diagnostics).not.empty;
    }
}

/**
 * Remove sourcemap information at the end of the source
 */
export function trimMap(source: string) {
    return source.replace(/('|<!--)\/\/# sourceMappingURL=.*$/m, '').trimEnd();
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

export function expectInstanceOf<T>(items: any[], constructors: Array<new (...args: any[]) => T>) {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const constructor = constructors[i];
        if (!(item instanceof constructor)) {
            throw new Error(`Expected index ${i} to be instanceof ${constructor.name} but instead found ${item.constructor?.name}`);
        }
    }
}

export function getTestTranspile(scopeGetter: () => [Program, string]) {
    return getTestFileAction((file) => {
        return file.program['_getTranspiledFileContents'](file);
    }, scopeGetter);
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

        let sources = [trimMap(codeWithMap.code), expected];

        for (let i = 0; i < sources.length; i++) {
            if (formatType === 'trim') {
                sources[i] = trim(sources[i]);
            }
        }

        expect(sources[0]).to.equal(sources[1]);
        return {
            file: file,
            source: source,
            expected: expected,
            actual: codeWithMap.code,
            map: codeWithMap.map
        };
    };
}

/**
 * Create a new object based on the keys from another object
 */
function pick<T extends Record<string, any>>(example: T, subject: Record<string, any>): T {
    if (!subject) {
        return subject as T;
    }
    const result = {};
    for (const key of Object.keys(example)) {
        result[key] = subject?.[key];
    }
    return result as T;
}

/**
 * Test a set of completions includes the provided items
 */
export function expectCompletionsIncludes(completions: CompletionItem[], expectedItems: Array<string | Partial<CompletionItem>>) {
    for (const expectedItem of expectedItems) {
        if (typeof expectedItem === 'string') {
            expect(completions.map(x => x.label)).includes(expectedItem);
        } else {
            //match all existing properties of the expectedItem
            let actualItem = pick(
                expectedItem,
                completions.find(x => x.label === expectedItem.label)
            );
            expect(actualItem).to.eql(expectedItem);
        }
    }
}

/**
 * Expect that the completions list does not include the provided items
 */
export function expectCompletionsExcludes(completions: CompletionItem[], expectedItems: Array<string | Partial<CompletionItem>>) {
    for (const expectedItem of expectedItems) {
        if (typeof expectedItem === 'string') {
            expect(completions.map(x => x.label)).not.includes(expectedItem);
        } else {
            //match all existing properties of the expectedItem
            let actualItem = pick(
                expectedItem,
                completions.find(x => x.label === expectedItem.label)
            );
            expect(actualItem).to.not.eql(expectedItem);
        }
    }
}

export function expectThrows(callback: () => any, expectedMessage = undefined, failedTestMessage = 'Expected to throw but did not') {
    let wasExceptionThrown = false;
    try {
        callback();
    } catch (e) {
        wasExceptionThrown = true;
        if (expectedMessage) {
            expect((e as any).message).to.eql(expectedMessage);
        }
    }
    if (wasExceptionThrown === false) {
        throw new Error(failedTestMessage);
    }
}

export function objectToMap<T>(obj: Record<string, T>) {
    const result = new Map<string, T>();
    for (let key in obj) {
        result.set(key, obj[key]);
    }
    return result;
}

export function mapToObject<T>(map: Map<any, T>) {
    const result = {} as Record<string, T>;
    for (let [key, value] of map) {
        result[key] = value;
    }
    return result;
}
