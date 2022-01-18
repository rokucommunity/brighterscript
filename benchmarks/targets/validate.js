module.exports = async (suite, name, brighterscript, projectPath, options) => {
    const { ProgramBuilder } = brighterscript;

    const builder = new ProgramBuilder();
    //run the first run so we we can focus the test on validate
    await builder.run({
        cwd: projectPath,
        createPackage: false,
        copyToStaging: false,
        //disable diagnostic reporting (they still get collected)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });
    if (Object.keys(builder.program.files).length === 0) {
        throw new Error('No files found in program');
    }

    suite.add(name, (deferred) => {
        const scopes = Object.values(builder.program.scopes);
        //mark all scopes as invalid so they'll re-validate
        for (let scope of scopes) {
            scope.invalidate();
        }
        let promise = builder.program.validate();
        if (promise) {
            promise.then(() => deferred.resolve());
        } else {
            deferred.resolve();
        }
    }, {
        ...options,
        'defer': true
    });
};
