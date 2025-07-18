module.exports = async (suite, name, brighterscript, projectPath, options) => {
    const { ProgramBuilder } = brighterscript;

    let builder;
    suite.add(name, (deferred) => {
        builder = new ProgramBuilder();
        builder.run({
            cwd: projectPath,
            createPackage: false,
            copyToStaging: false,
            //disable diagnostic reporting (they still get collected)
            diagnosticFilters: ['**/*'],
            logLevel: 'error'
        }).finally(() => {
            deferred.resolve();
        });
    }, {
        ...options,
        'defer': true
    });
};
