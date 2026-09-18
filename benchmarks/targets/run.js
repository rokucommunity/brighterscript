module.exports = async (options) => {
    const { suite, fullName, brighterscript, projectPath, suiteOptions, additionalConfig } = options;
    const { ProgramBuilder } = brighterscript;

    let builder;
    suite.add(fullName, (deferred) => {
        builder = new ProgramBuilder();
        builder.run({
            cwd: projectPath,
            createPackage: false,
            copyToStaging: false,
            //disable diagnostic reporting (they still get collected)
            diagnosticFilters: ['**/*'],
            logLevel: 'error',
            ...additionalConfig
        }).finally(() => {
            deferred.resolve();
        });
    }, {
        ...suiteOptions,
        'defer': true
    });
};
