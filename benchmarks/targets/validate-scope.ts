import type { BsConfig } from '../../src';
import type { TargetOptions } from '../target-runner';
import * as path from 'path';

/**
 * Benchmarks re-validating just the scopes affected by a single changed file, simulating the
 * common editor/language-server scenario where a developer edits one file - as opposed to the
 * `validate` target, which invalidates and re-validates every scope in the project (closer to a
 * full/clean rebuild). This should be a much cheaper, more "steady state" operation, and is a
 * better proxy for editor responsiveness while typing.
 *
 * Unlike the other targets, this one does NOT use the (arbitrary, real-world) `--project`; it
 * uses a purpose-built fixture at `benchmarks/fixtures/heavy-types` instead. The changed file
 * needs to actually be interesting to re-validate:
 *   - it's shared by *multiple* component scopes (editing a shared lib/type file is the expensive
 *     case - it forces every scope that includes it to re-validate, not just one), and
 *   - it (and the files that reference it) are heavy with cross-file type references
 *     (ReferenceType), since that's what stresses symbol table lookups and cross-scope
 *     type-compatibility checks the most.
 * A real-world downloaded sample project can't guarantee either property, so this target ships
 * its own small fixture instead.
 */
module.exports = async (options: TargetOptions) => {
    const { suite, fullName, brighterscript, suiteOptions } = options;
    const { ProgramBuilder } = brighterscript;

    const fixtureProjectPath = path.join(__dirname, '..', 'fixtures', 'heavy-types');

    const builder = new ProgramBuilder();
    //run the first run so we can focus the test on re-validating the affected scopes
    await builder.run({
        cwd: fixtureProjectPath,
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

    //the shared lib file is imported by every component in the fixture, so it should belong to
    //multiple scopes - that's the scenario this benchmark is meant to exercise
    const sharedLibSrcPath = path.join(fixtureProjectPath, 'source', 'shared', 'lib.bs');
    const affectedScopes = builder.program!.getScopesForFile(sharedLibSrcPath);
    if (affectedScopes.length < 2) {
        throw new Error(
            `Expected the shared lib fixture file to belong to multiple scopes, but it only belongs to ${affectedScopes.length}. ` +
            'Check that benchmarks/fixtures/heavy-types still has multiple components importing source/shared/lib.bs.'
        );
    }

    suite.add(fullName, (deferred) => {
        for (const scope of affectedScopes) {
            scope.invalidate();
        }
        Promise.resolve(
            builder.program!.validate()
        ).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
