import type { BsConfig } from '../../src';
import type { TargetOptions } from '../target-runner';

/**
 * Benchmarks re-validating a single scope, simulating the common editor/language-server scenario
 * where a developer edits one file and only that file's scope(s) need to be re-validated - as
 * opposed to the `validate` target, which invalidates and re-validates every scope in the
 * project (closer to a full/clean rebuild). This should be a much cheaper, more "steady state"
 * operation, and is a better proxy for editor responsiveness while typing.
 */
module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run so we can focus the test on re-validating a single scope
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        noEmit: true,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error',
        ...options.additionalConfig
    } as BsConfig & Record<string, any>);
    if (Object.keys(builder.program!.files).length === 0) {
        throw new Error('No files found in program');
    }

    const scopes = Object.values(builder.program!['scopes']);
    //pick a single non-global scope to repeatedly invalidate/re-validate, simulating edits
    //to the file(s) in just that one scope/component
    const targetScope = scopes.find((s: any) => s.name?.toLowerCase() !== 'global');
    if (!targetScope) {
        throw new Error('Could not find a non-global scope to benchmark single-scope re-validation against');
    }

    suite.add(fullName, (deferred) => {
        (targetScope as any).invalidate();
        Promise.resolve(
            builder.program!.validate()
        ).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
