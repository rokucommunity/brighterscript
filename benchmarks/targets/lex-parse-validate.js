module.exports = (suite, name, brighterscript, projectPath) => {
    const { ProgramBuilder } = brighterscript;

    suite.add(name, (deferred) => {
        const builder = new ProgramBuilder();

        builder.run({
            cwd: projectPath,
            createPackage: false,
            copyToStaging: false,
            //disable diagnostic reporting (they still get collected)
            diagnosticFilters: ['**/*'],
            logLevel: 'error'
        }).then(() => {
            if (Object.keys(builder.program.files).length === 0) {
                throw new Error('No files found in program');
            } else {
                deferred.resolve();
            }
        }).catch((error) => {
            deferred.reject(error);
            console.error(error);
        });
    }, {
        'defer': true
    });
};
