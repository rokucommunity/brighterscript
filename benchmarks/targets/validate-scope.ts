import type { BsConfig } from '../../src';
import type { TargetOptions } from '../target-runner';
import * as path from 'path';

/**
 * Benchmarks re-validating just the scopes/files affected by a single changed type, simulating
 * the common editor/language-server scenario where a developer edits one file - as opposed to the
 * `validate` target, which invalidates and re-validates every scope in the project (closer to a
 * full/clean rebuild). This should be a much cheaper, more "steady state" operation, and is a
 * better proxy for editor responsiveness while typing.
 *
 * Critically, this doesn't just call `scope.invalidate()` directly - that bypasses the real
 * changed-symbol pipeline entirely (Program.validate() only walks `getFilesRequiringChangedSymbol`
 * and un-validates AST segments for files whose *content* actually changed), so it would end up
 * benchmarking a much cheaper no-op scope refresh instead of a real edit. Instead, each sample
 * calls `program.setFile()` with a genuinely different version of a shared type (toggling one
 * field's type back and forth between two real classes), so the normal changed-symbol/segment
 * invalidation logic actually has real work to do.
 *
 * Unlike the other targets, this one does NOT use the (arbitrary, real-world) `--project`; it
 * uses a purpose-built fixture at `benchmarks/fixtures/heavy-types` instead. The changed type
 * needs to actually be interesting to re-validate:
 *   - it's used by *multiple* files/scopes (editing a widely-used shared type is the expensive
 *     case - it forces every segment/scope that references it to re-validate, not just one), and
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
    //run the first run so we can focus the test on re-validating after a real change
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

    const sharedLibFile = builder.program!.getFile(sharedLibSrcPath) as { fileContents: string };
    const originalContents = sharedLibFile.fileContents;

    //`shared.Class0.field1` is directly referenced by several other classes/interfaces in this
    //file, plus at least one component's local class - toggling its type between two other real
    //classes (both valid, so we're not just generating diagnostics-only churn) forces a genuine
    //changed-symbol event every single sample, rather than a no-op re-parse of identical content
    const marker = '        public field1 as Class1\n';
    if (!originalContents.includes(marker)) {
        throw new Error(
            'Could not find the expected `Class0.field1 as Class1` field to toggle in benchmarks/fixtures/heavy-types/source/shared/lib.bs. ' +
            'The fixture file may have changed - update this target to match.'
        );
    }
    const toggledContents = originalContents.replace(marker, '        public field1 as Class6\n');
    const contentVariants = [originalContents, toggledContents];
    let iteration = 0;

    suite.add(fullName, (deferred) => {
        builder.program!.setFile(sharedLibSrcPath, contentVariants[iteration % 2]);
        iteration++;
        Promise.resolve(
            builder.program!.validate()
        ).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
