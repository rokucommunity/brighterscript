import type { BsConfig } from '../../src';
import type { TargetOptions } from '../target-runner';

/**
 * Benchmarks a full project re-validate, simulating something like a clean rebuild (as opposed
 * to the `validate-scope` target, which benchmarks a much cheaper single-changed-file/scope
 * re-validate).
 *
 * This must actually change every file's content via `program.setFile()` rather than just calling
 * `scope.invalidate()` directly. Program.validate() only walks
 * `getFilesRequiringChangedSymbol()`/`unValidateAllSegments()` and re-runs `Scope.validate()` for
 * files/scopes whose content actually changed (tracked via `file.isValidated` and diffed provided
 * symbols) - manually invalidating a scope object doesn't mark any file dirty, so on the 2nd+
 * iteration `Scope.shouldValidate()` bails out immediately and `Scope.validate()` never even gets
 * called, silently turning this into a no-op benchmark. Re-`setFile()`-ing every file (even with
 * its own unchanged content) forces a real full re-parse and re-validate every sample.
 */
module.exports = async (options: TargetOptions) => {
    const { suite, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder, isBrsFile, isXmlFile } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run so we we can focus the test on validate
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

    //only brs/bs/xml files have re-settable source text (e.g. AssetFile - manifest, images - does not).
    //capture the actual content strings up front (not file object references!) - setFile() disposes
    //and replaces file objects each time it's called, which clears `fileContents` on the old object
    //for memory, so re-reading `.fileContents` from a stale reference on the 2nd+ sample would crash
    const fileContentsBySrcPath = new Map<string, string>(
        Object.values(builder.program!.files)
            .filter((x: any) => isBrsFile(x) || isXmlFile(x))
            .map((x: any) => [x.srcPath, x.fileContents])
    );

    suite.add(fullName, (deferred) => {
        for (const [srcPath, contents] of fileContentsBySrcPath) {
            //re-supply each file's own current content - the point isn't to change what the code
            //does, it's to force a genuine full re-parse/re-validate of everything, every sample
            builder.program!.setFile(srcPath, contents);
        }
        Promise.resolve(
            builder.program!.validate()
        ).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
