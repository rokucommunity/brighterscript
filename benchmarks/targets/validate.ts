import type { TargetOptions } from '../target-runner';

module.exports = async (options: TargetOptions) => {
    const { suite, name, version, fullName, brighterscript, projectPath, suiteOptions } = options;
    const { ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run so we we can focus the test on validate
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        enableTypeValidation: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    } as any);
    if (Object.keys(builder.program.files).length === 0) {
        throw new Error('No files found in program');
    }

    suite.add(fullName, (deferred) => {
        const scopes = Object.values(builder.program['scopes']);
        //mark all scopes as invalid so they'll re-validate
        for (let scope of scopes) {
            scope.invalidate();
        }
        Promise.resolve(
            builder.program.validate()
        ).finally(() => deferred.resolve());
    }, {
        ...suiteOptions,
        'defer': true
    });
};
