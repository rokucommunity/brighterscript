import type { BsDiagnostic } from './interfaces';
import * as assert from 'assert';
import chalk from 'chalk';
import type { CodeDescription, CompletionItem, DiagnosticRelatedInformation, DiagnosticSeverity, DiagnosticTag, Location } from 'vscode-languageserver';
import { createSandbox } from 'sinon';
import { expect } from './chai-config.spec';
import type { CodeActionShorthand } from './CodeActionUtil';
import { codeActionUtil } from './CodeActionUtil';
import type { BrsFile } from './files/BrsFile';
import { Program } from './Program';
import { standardizePath as s } from './util';
import { getDiagnosticLine } from './diagnosticUtils';
import { firstBy } from 'thenby';
import undent from 'undent';
import type { BscFile } from './files/BscFile';
import type { BscType } from './types/BscType';

export const tempDir = s`${__dirname}/../.tmp`;
export const rootDir = s`${tempDir}/rootDir`;
export const stagingDir = s`${tempDir}/stagingDir`;

export const trim = undent;

type DiagnosticCollection = { getDiagnostics(): Array<BsDiagnostic>; getFile?: (path: string, normalize: boolean) => BscFile } | { diagnostics?: BsDiagnostic[] } | BsDiagnostic[];

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
            .thenBy<BsDiagnostic>((a, b) => (a.location?.range?.start?.line ?? 0) - (b.location?.range?.start?.line ?? 0))
            .thenBy<BsDiagnostic>((a, b) => (a.location?.range?.start?.character ?? 0) - (b.location?.range?.start?.character ?? 0))
            .thenBy<BsDiagnostic>((a, b) => (a.location?.range?.end?.line ?? 0) - (b.location?.range?.end?.line ?? 0))
            .thenBy<BsDiagnostic>((a, b) => (a.location?.range?.end?.character ?? 0) - (b.location?.range?.end?.character ?? 0))
    );
}

function cloneObject<TOriginal, TTemplate>(original: TOriginal, template: TTemplate, defaultKeys: Array<keyof TOriginal>) {
    const clone = {} as Partial<TOriginal>;
    let keys = Object.keys(template ?? {}) as Array<keyof TOriginal>;
    //if there were no keys provided, use some sane defaults
    keys = keys.length > 0 ? keys : defaultKeys;

    //copy only compare the specified keys from actualDiagnostic
    for (const key of keys) {
        clone[key] = original[key];
    }
    return clone;
}

interface PartialDiagnostic {
    location?: Partial<Location>;
    severity?: DiagnosticSeverity;
    code?: number | string;
    codeDescription?: Partial<CodeDescription>;
    source?: string;
    message?: string;
    tags?: Partial<DiagnosticTag>[];
    relatedInformation?: Partial<DiagnosticRelatedInformation>[];
    data?: unknown;
    file?: Partial<BscFile>;
    legacyCode?: number | string;
}

/**
 *  Helper function to clone a Diagnostic so it will give partial data that has the same properties as the expected
 */
function cloneDiagnostic(actualDiagnosticInput: BsDiagnostic, expectedDiagnostic: BsDiagnostic) {
    const actualDiagnostic = cloneObject(
        actualDiagnosticInput,
        expectedDiagnostic,
        ['message', 'code', 'severity', 'relatedInformation', 'legacyCode']
    );
    //clone Location if available
    if (expectedDiagnostic?.location) {
        actualDiagnostic.location = actualDiagnosticInput.location
            ? cloneObject(actualDiagnosticInput.location, expectedDiagnostic.location, ['uri', 'range']) as any
            : undefined;
    }
    //deep clone relatedInformation if available
    if (actualDiagnostic.relatedInformation) {
        for (let j = 0; j < actualDiagnostic.relatedInformation.length; j++) {
            actualDiagnostic.relatedInformation[j] = cloneObject(
                actualDiagnostic.relatedInformation[j],
                expectedDiagnostic?.relatedInformation?.[j],
                ['location', 'message']
            ) as any;
        }
    }
    return actualDiagnostic;
}


/**
 * Ensure the DiagnosticCollection exactly contains the data from expected list.
 * @param arg - any object that contains diagnostics (such as `Program`, `Scope`, or even an array of diagnostics)
 * @param expected an array of expected diagnostics. if it's a string, assume that's a diagnostic error message
 */
export function expectDiagnostics(arg: DiagnosticCollection, expected: Array<PartialDiagnostic | string | number>) {
    const actualDiagnostics = sortDiagnostics(
        getDiagnostics(arg)
    );
    const expectedDiagnostics = sortDiagnostics(
        expected.map(x => {
            let result = x;
            if (typeof x === 'string') {
                if (!x.includes(' ') && x.toLowerCase() === x) {
                    // it's all lowercase and there's no spaces, so probably a code
                    result = { code: x };
                } else {
                    result = { message: x };
                }
            } else if (typeof x === 'number') {
                result = { legacyCode: x };
            }
            return result as unknown as BsDiagnostic;
        })
    );

    const actual = [] as BsDiagnostic[];
    for (let i = 0; i < actualDiagnostics.length; i++) {
        const expectedDiagnostic = expectedDiagnostics[i];
        const actualDiagnostic = cloneDiagnostic(actualDiagnostics[i], expectedDiagnostic);
        actual.push(actualDiagnostic as any);
    }
    const sortedActual = sortDiagnostics(actual);
    expect(sortedActual).to.eql(expectedDiagnostics);
}

/**
 * Ensure the DiagnosticCollection includes data from expected list (note - order does not matter).
 * @param arg - any object that contains diagnostics (such as `Program`, `Scope`, or even an array of diagnostics)
 * @param expected an array of expected diagnostics. if it's a string, assume that's a diagnostic error message
 */
export function expectDiagnosticsIncludes(arg: DiagnosticCollection, expected: PartialDiagnostic | string | number | Array<PartialDiagnostic | string | number>) {
    let actualExpected = Array.isArray(expected) ? expected : [expected];
    const actualDiagnostics = getDiagnostics(arg);
    const expectedDiagnostics =
        actualExpected.map(x => {
            let result = x;
            if (typeof x === 'string') {
                if (!x.includes(' ') && x.toLowerCase() === x) {
                    // it's all lowercase and there's no spaces, so probably a code
                    result = { code: x };
                } else {
                    result = { message: x };
                }
            } else if (typeof x === 'number') {
                result = { legacyCode: x };
            }
            return result as unknown as BsDiagnostic;
        });


    const foundDiagnostics: PartialDiagnostic | string | number | Array<PartialDiagnostic | string | number> = [];
    for (const expectedDiagnostic of expectedDiagnostics) {
        actualDiagnostics.find((actualDiag) => {
            const actualDiagnosticClone = cloneDiagnostic(actualDiag, expectedDiagnostic);
            if (JSON.stringify(actualDiagnosticClone) === JSON.stringify(expectedDiagnostic)) {
                foundDiagnostics.push(actualDiagnosticClone);
                return true;
            }
            return false;
        });
    }
    expect(foundDiagnostics).to.eql(expectedDiagnostics);
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
            message += `\n        • bs${diagnostic.code} "${diagnostic.message}" at ${diagnostic.location?.uri ?? ''}#(${diagnostic.location?.range?.start.line}:${diagnostic.location?.range?.start.character})-(${diagnostic.location?.range?.end.line}:${diagnostic.location?.range?.end.character})`;
            //print the line containing the error (if we can find it)srcPath
            if (arg instanceof Program) {
                const file = arg.getFile(diagnostic.location.uri);

                const line = (file as BrsFile)?.fileContents?.split(/\r?\n/g)?.[diagnostic.location.range?.start.line];
                if (line) {
                    message += '\n' + getDiagnosticLine(diagnostic, line, chalk.red);
                }
            }
        }
        assert.fail(message);
    }
}

/**
 * Test if the arg has any diagnostics. This just checks the count, nothing more.
 * @param diagnosticsCollection a collection of diagnostics
 * @param length if specified, checks the diagnostic count is exactly that amount. If omitted, the collection is just verified as non-empty
 */
export function expectHasDiagnostics(diagnosticsCollection: DiagnosticCollection, length: number | null = null) {
    const diagnostics = getDiagnostics(diagnosticsCollection);
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

export function getTestTranspile(scopeGetter: () => [program: Program, rootDir: string]) {
    return getTestFileAction((file) => {
        return (file as BrsFile).program.getTranspiledFileContents(file.srcPath);
    }, scopeGetter);
}

export function getTestGetTypedef(scopeGetter: () => [program: Program, rootDir: string]) {
    return getTestFileAction(async (file) => {
        const program = (file as BrsFile).program;
        program.options.emitDefinitions = true;
        const result = await program.getTranspiledFileContents(file.srcPath);
        return {
            code: result.typedef,
            map: undefined
        };
    }, scopeGetter);
}

function getTestFileAction(
    action: (file: BscFile) => Promise<{ code: string; map?: string }>,
    scopeGetter: () => [program: Program, rootDir: string]
) {
    return async function testFileAction<TFile extends BscFile = BscFile>(sourceOrFile: string | TFile, expected?: string, formatType: 'trim' | 'none' = 'trim', destPath = 'source/main.bs', failOnDiagnostic = true) {
        let [program, rootDir] = scopeGetter();
        let file: TFile;
        if (typeof sourceOrFile === 'string') {
            expected = expected ? expected : sourceOrFile;
            file = program.setFile<TFile>({ src: s`${rootDir}/${destPath}`, dest: destPath }, sourceOrFile);
        } else {
            file = sourceOrFile;
            if (!expected) {
                throw new Error('`expected` is required when passing a file');
            }
        }
        program.validate();
        if (failOnDiagnostic !== false) {
            expectZeroDiagnostics(program);
        }
        let codeWithMap = await action(file);

        let sources = [trimMap(codeWithMap.code), expected];

        for (let i = 0; i < sources.length; i++) {
            if (formatType === 'trim') {
                sources[i] = trim(sources[i]);
            }
        }

        expect(sources[0]).to.equal(sources[1]);
        return {
            file: file,
            source: sourceOrFile,
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
                completions.find(x => x.label === expectedItem.label)!
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
                completions.find(x => x.label === expectedItem.label)!
            );
            expect(actualItem).to.not.eql(expectedItem);
        }
    }
}

export function expectThrows(callback: () => any, expectedMessage: string | undefined = undefined, failedTestMessage = 'Expected to throw but did not') {
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

/**
 * Test that a type is what was expected
 */
export function expectTypeToBe(someType: BscType, expectedTypeClass: any) {
    expect(someType?.constructor?.name).to.eq(expectedTypeClass.name);
}

export function stripConsoleColors(inputString) {
    // Regular expression to match ANSI escape codes for colors
    // eslint-disable-next-line no-control-regex
    const colorPattern = /\u001b\[(?:\d*;){0,5}\d*m/g;

    // Remove all occurrences of ANSI escape codes
    return inputString.replace(colorPattern, '');
}
