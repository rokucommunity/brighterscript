import type { BsConfig, ProgramBuilder } from '../src';
import type { TargetOptions } from './target-runner';

/**
 * Create a ProgramBuilder that doesn't print diagnostics (they still get collected).
 *
 * This used to be done with `diagnosticFilters: ['**\/*']`, but in v1 a string filter is a diagnostic
 * code, not a glob, so it filtered nothing. A `{ files: '**\/*' }` filter would be worse - v1 skips
 * scope validation for completely filtered files, so the validate benchmarks would measure nothing
 */
export function createBuilder(options: TargetOptions): ProgramBuilder {
    const builder = new options.brighterscript.ProgramBuilder();
    (builder as any).printDiagnostics = () => { };
    return builder;
}

/**
 * The standard config for loading the benchmark project without emitting anything
 */
export function getConfig(options: TargetOptions, projectPath = options.projectPath): BsConfig {
    return {
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        noEmit: true,
        logLevel: 'error',
        ...options.additionalConfig
    } as BsConfig & Record<string, any>;
}

/**
 * Get the files that can be transpiled, and a function that transpiles one of them.
 * v1 moved BrsFile transpiling out of the file and into the program (`getTranspiledFileContents`),
 * older versions only have `file.transpile()`
 */
export function getTranspiler(builder: ProgramBuilder) {
    const program = builder.program as any;
    const useProgram = typeof program.getTranspiledFileContents === 'function';
    return {
        canTranspile: (file: any) => useProgram || typeof file.transpile === 'function',
        transpile: (file: any) => {
            if (useProgram) {
                return program.getTranspiledFileContents(file.srcPath);
            }
            return file.transpile();
        }
    };
}
