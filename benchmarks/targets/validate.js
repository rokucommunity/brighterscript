const fs = require('fs');
const path = require('path');

module.exports = async (suite, name, brighterscript, projectPath) => {
    const ProgramBuilder = brighterscript.ProgramBuilder;
    const builder = new ProgramBuilder();
    //run the first run so we we can focus the test on validate
    await builder.run({
        rootDir: projectPath,
        createPackage: false,
        copyToStaging: false,
        //ignore all diagnostics (they still get collected which is what we're concerned with)
        diagnosticFilters: ['**/*'],
        logLevel: 'error'
    });

    suite.add(name, async (deferred) => {
        const scopes = Object.values(builder.program.scopes);
        //mark all scopes as invalid so they'll re-validate
        for (let scope of scopes) {
            scope.invalidate();
        }
        await builder.program.validate();
        deferred.resolve();
    }, {
        'defer': true
    });
};
